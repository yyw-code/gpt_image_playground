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
})
