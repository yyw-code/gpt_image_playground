// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../store', () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  reuseConfig: vi.fn(), editOutputs: vi.fn(), removeTask: vi.fn(), retryTask: vi.fn(),
  showCodexCliPrompt: vi.fn(), getCodexCliPromptKey: () => 'test-profile',
}))
vi.mock('../lib/imageCache', () => ({
  getCachedImage: () => 'data:image/png;base64,aW1hZ2U=',
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,aW1hZ2U='),
}))

import DetailModal from './DetailModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null
let task: TaskRecord

beforeEach(() => {
  task = {
    id: 'task', prompt: 'Draw a cat.', params: { ...DEFAULT_PARAMS, size: '1440x2560' },
    inputImageIds: [], maskTargetImageId: null, maskImageId: null, outputImages: ['output'],
    status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1,
    apiProvider: 'openai', actualParams: { size: '1440x2560', quality: 'medium' },
  }
  mocks.state = {
    tasks: [task], detailTaskId: task.id, settings: DEFAULT_SETTINGS,
    dismissedCodexCliPrompts: [], streamPreviews: {}, streamPreviewSlots: {},
    setDetailTaskId: vi.fn(), setLightboxImageId: vi.fn(), setConfirmDialog: vi.fn(),
    showToast: vi.fn(), openFavoritePicker: vi.fn(),
  }
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/** 挂载真实详情，并通过图片 load 事件模拟浏览器解码原图，验证尺寸显示优先级。 */
async function renderDetail() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<DetailModal />))
  const image = container.querySelector<HTMLImageElement>('img[data-image-id="output"]')!
  expect(image).not.toBeNull()
  return { container, image }
}

/** 触发原图解码完成，不下载图片或访问真实生成接口。 */
function loadImage(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } })
  act(() => image.dispatchEvent(new Event('load')))
}

describe('详情原图尺寸与比例', () => {
  it.each([false, true])('同一多图任务可切换查看全部结果，部分失败=%s', async (partialFailure) => {
    task.params.n = 3
    task.outputImages = partialFailure ? ['output', 'output-3'] : ['output', 'output-2', 'output-3']
    task.actualParams = { n: partialFailure ? 2 : 3 }
    task.outputErrors = partialFailure ? [{ requestIndex: 1, error: 'Generation failed' }] : undefined
    const { container } = await renderDetail()
    const quantity = [...container.querySelectorAll('span')].find((span) => span.textContent === '生成张数')?.parentElement
    expect(quantity?.textContent).toContain(partialFailure ? '3|2' : '3')
    expect(container.textContent).toContain('1 / 3')

    act(() => container.querySelector('path[d="M9 5l7 7-7 7"]')!.closest('button')!.click())
    expect(container.textContent).toContain('2 / 3')
    if (partialFailure) {
      expect(container.textContent).toContain('第 2 张生成失败')
      expect(container.textContent).toContain('Generation failed')
    } else expect(container.querySelector('img[data-image-id="output-2"]')).not.toBeNull()

    act(() => container.querySelector('path[d="M9 5l7 7-7 7"]')!.closest('button')!.click())
    expect(container.textContent).toContain('3 / 3')
    expect(container.querySelector('img[data-image-id="output-3"]')).not.toBeNull()
  })

  it('展示 2.6 请求与实际复杂度的差异', async () => {
    task.apiModel = 'gpt-image-2.6-flare'
    task.params.complexity = 'low'
    task.actualParams = { complexity: 'medium' }
    const { container } = await renderDetail()
    const card = [...container.querySelectorAll('span')].find((span) => span.textContent === '构图复杂度')?.parentElement
    expect(card?.textContent).toContain('low|medium')
  })
  it('没有请求复杂度和接口回显时不显示复杂度', async () => {
    const { container } = await renderDetail()
    expect(container.textContent).not.toContain('构图复杂度')
  })
  it('原图尚未解码时正常打开，未知尺寸不提前提示比例错误', async () => {
    const { container } = await renderDetail()
    expect(container.textContent).toContain('参数配置')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('解码尺寸优先于 API 回显，并明确提示横竖比例不符', async () => {
    const { container, image } = await renderDetail()
    loadImage(image, 1672, 941)
    const sizeCard = [...container.querySelectorAll('span')].find((span) => span.textContent === '尺寸')?.parentElement
    expect(sizeCard?.textContent).toContain('1440x2560')
    expect(sizeCard?.textContent).toContain('1672x941')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('返回原图的比例与请求不符：请求 1440x2560，实际 1672×941。')
    expect(task.actualParams?.size).toBe('1440x2560')
    expect(task.params.size).toBe('1440x2560')
  })

  it('比例吻合但像素不同仍显示实际尺寸，不误报规整误差', async () => {
    task.params.size = '2016x864'
    task.actualParams = { size: '2016x864' }
    const { container, image } = await renderDetail()
    loadImage(image, 1915, 821)
    const sizeCard = [...container.querySelectorAll('span')].find((span) => span.textContent === '尺寸')?.parentElement
    expect(sizeCard?.textContent).toContain('1915x821')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('Grok 不使用 GPT 的遗留 size 来判断比例', async () => {
    task.apiProvider = 'grok'
    task.params.aspect_ratio = '16:9'
    const { container, image } = await renderDetail()
    loadImage(image, 1672, 941)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('16:9')
  })

  it('Grok 2.0 展示质量回显、实际格式及未满额张数，原始 JPEG 不标成 PNG 不匹配', async () => {
    task.apiProvider = 'grok'
    task.apiModel = 'grok-imagine-image-2.0'
    task.params = { ...DEFAULT_PARAMS, quality: 'medium', resolution: '2k', aspect_ratio: '21:9', n: 2 }
    task.actualParams = { quality: 'low', output_format: 'jpeg', n: 1 }
    const { container } = await renderDetail()
    const card = (label: string) => [...container.querySelectorAll('span')].find((span) => span.textContent === label)?.parentElement
    expect(card('分辨率档位')?.textContent).toContain('2K')
    expect(card('比例')?.textContent).toContain('21:9')
    expect(card('质量')?.textContent).toContain('medium|low')
    expect(card('格式')?.textContent).toContain('auto|jpeg')
    expect(card('格式')?.textContent).not.toContain('png')
    expect(card('生成张数')?.textContent).toContain('2|1')
  })
})
