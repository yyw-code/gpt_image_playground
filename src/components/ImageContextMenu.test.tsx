// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
  openImageRegeneration: vi.fn(), addImageFromUrl: vi.fn(),
}))
vi.mock('../lib/clipboard', () => ({ canCopyImageToClipboard: () => true, copyImageSourceToClipboard: vi.fn(), getClipboardFailureMessage: vi.fn() }))
vi.mock('../lib/imageCache', () => ({ ensureImageCached: vi.fn(async () => 'data:image/png;base64,test') }))
import ImageContextMenu from './ImageContextMenu'
import { addImageFromUrl, openImageRegeneration } from '../store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  mocks.state = { tasks: [{ id: 'source', params: { ...DEFAULT_PARAMS, n: 2 }, outputImages: ['same', 'same'], status: 'done' }], inputImages: [], setDetailTaskId: vi.fn(), setLightboxImageId: vi.fn(), setMaskEditorImageId: vi.fn(), showToast: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })

/** 在不同图片区域打开真实菜单后选择编辑，检查上下文而非哈希决定入口。 */
async function editImage(output: boolean) {
  await act(async () => root.render(<ImageContextMenu />))
  const image = document.createElement('img')
  image.src = 'data:image/png;base64,test'
  image.dataset.imageId = 'same'
  if (output) { image.dataset.sourceTaskId = 'source'; image.dataset.requestIndex = '1' }
  document.body.append(image)
  await act(async () => image.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '编辑')!.click())
}

it('重复哈希输出图按第二个请求槽位进入修改面板', async () => {
  await editImage(true)
  expect(openImageRegeneration).toHaveBeenCalledWith([{ taskId: 'source', requestIndex: 1, imageId: 'same' }])
  expect(addImageFromUrl).not.toHaveBeenCalled()
})

it('参考图与输出图哈希相同时仍保留原参考图编辑行为', async () => {
  await editImage(false)
  expect(openImageRegeneration).not.toHaveBeenCalled()
  expect(addImageFromUrl).toHaveBeenCalled()
})
