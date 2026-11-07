// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, imageDataUrl: 'data:image/png;base64,aW1hZ2U=' }))
vi.mock('../store', () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
  reuseConfig: vi.fn(), editOutputs: vi.fn(), removeTask: vi.fn(), retryTask: vi.fn(),
  showCodexCliPrompt: vi.fn(), getCodexCliPromptKey: () => 'test-profile',
}))
vi.mock('../lib/imageCache', () => ({
  getCachedImage: () => mocks.imageDataUrl,
  ensureImageCached: vi.fn(async () => mocks.imageDataUrl),
}))

vi.mock('../lib/downloadImages', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/downloadImages')>(),
  downloadImageIds: vi.fn(async () => ({ successCount: 1, failCount: 0 })),
  downloadImageEntriesAsZip: vi.fn(async () => ({ successCount: 2, failCount: 0 })),
}))

import DetailModal from './DetailModal'
import { retryTask } from '../store'
import { downloadImageIds, downloadImageEntriesAsZip, getImageZipEntries } from '../lib/downloadImages'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null
let task: TaskRecord

beforeEach(() => {
  mocks.imageDataUrl = 'data:image/png;base64,aW1hZ2U='
  vi.mocked(downloadImageIds).mockClear()
  vi.mocked(downloadImageEntriesAsZip).mockClear()
  vi.mocked(retryTask).mockClear()
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
  it('按任务快照说明兼容模式，不把隐藏格式与质量当成参数失败', async () => {
    task.imageParameterMode = 'composition'
    task.params.output_format = 'webp'
    task.params.quality = 'high'
    task.actualParams = { output_format: 'png', quality: 'low' }
    const { container } = await renderDetail()
    expect(container.textContent).toContain('此任务使用构图兼容模式')
    expect(container.querySelector('[aria-label="当前图片参数核对"]')).toBeNull()
  })
  it('文件头优先于 MIME 和接口格式回显，避免把 PNG 当作 WebP 验证通过', async () => {
    mocks.imageDataUrl = 'data:image/webp;base64,iVBORw0KGgo='
    task.params.output_format = 'webp'
    task.actualParams = { output_format: 'webp' }
    const { container } = await renderDetail()
    expect(container.querySelector('[aria-label="当前图片参数核对"]')?.textContent).toContain('格式：设置 webp，返回 png')
    expect(task.actualParams.output_format).toBe('webp')
  })

  it('直接展示 high/low 和 WebP/PNG 差异，仍允许下载且不自动重试', async () => {
    task.params.quality = 'high'
    task.params.output_format = 'webp'
    task.actualParams = { quality: 'low', output_format: 'png', size: '1440x2560' }
    const { container } = await renderDetail()
    const notice = container.querySelector('[aria-label="当前图片参数核对"]')!
    expect(notice.textContent).toContain('已生成，参数与设置不符')
    expect(notice.textContent).toContain('质量回显：设置 high，返回 low')
    expect(notice.textContent).toContain('格式：设置 webp，返回 png')
    expect(container.querySelector('img[data-image-id="output"]')).not.toBeNull()
    expect(retryTask).not.toHaveBeenCalled()
  })

  it('缺少当前图片参数时显示未验证，不借用整批首张回显', async () => {
    task.outputImages = ['output', 'second']
    task.actualParams = { quality: 'low', output_format: 'jpeg' }
    const { container } = await renderDetail()
    const notice = container.querySelector('[aria-label="当前图片参数核对"]')!
    expect(notice.textContent).toContain('部分参数未验证')
    expect(notice.textContent).not.toContain('返回 low')
    expect(notice.textContent).not.toContain('返回 jpeg')
  })

  it('同宽高比的错误像素仍标记参数不符', async () => {
    const { container, image } = await renderDetail()
    loadImage(image, 720, 1280)
    expect(container.querySelector('[aria-label="当前图片参数核对"]')?.textContent).toContain('尺寸：设置 1440x2560，返回 720x1280')
  })

  it.each(['done', 'running', 'error'] as const)('部分失败 %s 保留原图，按原槽位重试且运行时禁用重复提交', async (status) => {
    task.params.n = 3
    task.outputErrors = [{ requestIndex: 1, error: 'busy' }, { requestIndex: 2, error: 'busy' }]
    task.status = status
    task.generationProgress = status === 'running' ? { state: 'queued', requestIndex: 1, queuePosition: 2 } : undefined
    const { container } = await renderDetail()
    if (status === 'running') expect(container.textContent).toContain('第 2 张排队中')
    const retryAll = [...container.querySelectorAll('button')].find((button) => button.textContent === '补齐未完成的 2 张')!
    expect(retryAll.disabled).toBe(status === 'running')
    act(() => retryAll.click())
    expect(retryTask).toHaveBeenCalledTimes(status === 'running' ? 0 : 1)
    expect(mocks.state.setDetailTaskId).not.toHaveBeenCalled()
    vi.mocked(retryTask).mockClear()
    act(() => container.querySelector('path[d="M9 5l7 7-7 7"]')!.closest('button')!.click())
    const retryOne = [...container.querySelectorAll('button')].find((button) => button.textContent === '重试这张')!
    expect(retryOne.disabled).toBe(status === 'running')
    act(() => retryOne.click())
    if (status === 'running') expect(retryTask).not.toHaveBeenCalled()
    else expect(retryTask).toHaveBeenCalledExactlyOnceWith(task, 1)
  })

  it.each([false, true])('中断后 2/10 图片可单张下载和下载全部成功图片，ZIP=%s', async (zip) => {
    task.status = 'error'
    task.error = '请求中断'
    task.params.n = 10
    task.outputImages = ['output', 'second']
    task.outputErrors = Array.from({ length: 8 }, (_, index) => ({ requestIndex: index + 2, error: '尚未完成' }))
    task.imageRequests = Array.from({ length: 10 }, (_, index) => ({ state: index < 2 ? 'saved' : index === 2 ? 'unknown' : 'queued', queuedAt: 1 }))
    mocks.state.settings = { ...DEFAULT_SETTINGS, zipDownloadRoutes: zip ? ['task-detail-all'] : [] }
    const { container } = await renderDetail()
    expect(container.textContent).toContain('已成功 2/10 张 · 未完成 8 张')
    expect(container.querySelectorAll('[aria-label="逐张生成结果"] button[aria-pressed]')).toHaveLength(10)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="下载图片"]')!.click())
    expect(downloadImageIds).toHaveBeenCalledWith(['output'], 'task-task')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="第 3 张：结果未知"]')!.click())
    expect(container.textContent).toContain('第 3 张结果未知')
    expect(container.querySelector('[aria-label="下载图片"]')).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="下载全部成功图片"]')!.click())
    if (zip) expect(downloadImageEntriesAsZip).toHaveBeenCalledWith(getImageZipEntries(['output', 'second'], 'task-task'), 'task-task')
    else expect(downloadImageIds).toHaveBeenLastCalledWith(['output', 'second'], 'task-task')
    vi.mocked(downloadImageEntriesAsZip).mockClear()
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === '打包下载成功图片（ZIP）')!.click())
    expect(downloadImageEntriesAsZip).toHaveBeenCalledExactlyOnceWith(getImageZipEntries(['output', 'second'], 'task-task'), 'task-task')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="第 4 张：未发送"]')!.click())
    expect(container.textContent).toContain('第 4 张未发送')
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '重试这张')!.click())
    expect(retryTask).toHaveBeenCalledWith(task, 3)
  })

  it('旧全失败记录也展示所有位置并允许选择一张重试', async () => {
    task.status = 'error'
    task.error = '请求拒绝'
    task.params.n = 3
    task.outputImages = []
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<DetailModal />))
    expect(container.querySelectorAll('[aria-label="逐张生成结果"] button[aria-pressed]')).toHaveLength(3)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="第 2 张：生成失败"]')!.click())
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '重试这张')!.click())
    expect(retryTask).toHaveBeenCalledWith(task, 1)
    expect(container.querySelector('[aria-label="下载全部成功图片"]')).toBeNull()
  })

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
    expect(container.querySelector('[aria-label="图片比例核对"]')).toBeNull()
  })

  it('解码尺寸优先于 API 回显，并明确提示横竖比例不符', async () => {
    const { container, image } = await renderDetail()
    loadImage(image, 1672, 941)
    const sizeCard = [...container.querySelectorAll('span')].find((span) => span.textContent === '尺寸')?.parentElement
    expect(sizeCard?.textContent).toContain('1440x2560')
    expect(sizeCard?.textContent).toContain('1672x941')
    expect(container.querySelector('[aria-label="图片比例核对"]')?.textContent).toBe('返回原图的比例与请求不符：请求 1440x2560，实际 1672×941。')
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
    expect(container.querySelector('[aria-label="图片比例核对"]')).toBeNull()
  })

  it('Grok 不使用 GPT 的遗留 size 来判断比例', async () => {
    task.apiProvider = 'grok'
    task.params.aspect_ratio = '16:9'
    const { container, image } = await renderDetail()
    loadImage(image, 1672, 941)
    expect(container.querySelector('[aria-label="图片比例核对"]')).toBeNull()
    expect(container.textContent).toContain('16:9')
  })

  it('Grok 实际方图不能因质量相同而显示参数一致', async () => {
    task.apiProvider = 'grok'
    task.apiModel = 'grok-imagine-image-2.0'
    task.imageParameterMode = 'native'
    task.params = { ...DEFAULT_PARAMS, aspect_ratio: '16:9', quality: 'medium' }
    task.actualParams = { quality: 'medium', size: '1920x1080' }
    const { container, image } = await renderDetail()
    loadImage(image, 1024, 1024)
    const notice = container.querySelector('[aria-label="当前图片参数核对"]')!
    expect(notice.textContent).toContain('已生成，参数与设置不符')
    expect(notice.textContent).toContain('比例：设置 16:9，返回 1:1')
    expect(retryTask).not.toHaveBeenCalled()
  })

  it('按当前槽位显示排队、接口传输和本地保存时间，旧任务不伪造耗时', async () => {
    task.imageRequests = [{ state: 'saved', queuedAt: 1000, startedAt: 3000, receivedAt: 25000, savedAt: 25500 }]
    const { container } = await renderDetail()
    expect(container.querySelector('[aria-label="本张图片耗时"]')?.textContent).toBe('排队 2.0 秒接口等待与传输 22.0 秒本地处理与保存 0.5 秒')
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
