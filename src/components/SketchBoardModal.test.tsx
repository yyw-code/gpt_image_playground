// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, confirm: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() }))
vi.mock('../store', () => ({ useStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }))
vi.mock('../lib/canvasImage', () => ({ loadImage: vi.fn(async () => ({ naturalWidth: 900, naturalHeight: 1500 })), canvasToBlob: vi.fn(async () => new Blob(['test'])) }))
vi.mock('../lib/dataUrl', () => ({ blobToDataUrl: vi.fn(async () => 'data:image/png;base64,exported') }))
vi.mock('../hooks/useEditorViewport', () => ({ useEditorViewport: () => ({ frameWidth: 1998, transform: { scale: 1, x: 0, y: 0 }, pointerDown: vi.fn(), pointerMove: () => false, pointerUp: vi.fn(), isPinching: () => false, getVisibleCenter: () => ({ x: 500, y: 500 }) }) }))
import SketchBoardModal from './SketchBoardModal'
import { canvasToBlob } from '../lib/canvasImage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

/** 模拟画布渲染原语，真实运行指针、文字提交、导出及评论坐标链路，不访问生成 API。 */
beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 30 }), drawImage: mocks.drawImage, fillText: mocks.fillText }, { get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn(), set: () => true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLCanvasElement) { return { left: 0, top: 0, width: this.width, height: this.height } as DOMRect })
  Element.prototype.setPointerCapture = vi.fn()
  mocks.state = { sketchBoard: { baseImageSrc: 'original', onConfirm: mocks.confirm, comments: [] }, inputImages: [], params: DEFAULT_PARAMS, setSketchBoard: vi.fn(), setConfirmDialog: vi.fn(), showToast: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })

/** 通过浏览器同类事件在画板中输入文字，支持原图之外的坐标。 */
async function addOutsideText() {
  await act(async () => root.render(<SketchBoardModal />))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="文字"]')!.click())
  const canvas = container.querySelector('canvas')!
  await act(async () => canvas.parentElement!.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { button: 0, pointerId: 1, clientX: 1500, clientY: 500, pointerType: 'mouse' })))
  const textarea = container.querySelector('textarea')!
  expect(textarea).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '图外说明完整保留')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => textarea.blur())
}

it('原图外能输入文字，保存完整范围和原图区域，撤销重做仍可用', async () => {
  await addOutsideText()
  expect(mocks.fillText).toHaveBeenCalledWith('图外说明完整保留', expect.any(Number), expect.any(Number))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="重做"]')!.click())
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('完成'))!.click())
  expect(mocks.confirm).toHaveBeenCalledWith('data:image/png;base64,exported', [], expect.objectContaining({ width: expect.any(Number), imageBounds: { x: 0, y: expect.any(Number), width: 922, height: 1536 } }))
  const layout = mocks.confirm.mock.calls[0][2]
  expect(layout.width).toBeGreaterThan(922)
  const canvas = vi.mocked(canvasToBlob).mock.calls[0][0]
  expect(canvas.width).toBe(layout.width)
  // 底图仍按原尺寸绘制，没有随着导出宽度拉伸。
  expect(mocks.drawImage.mock.calls.some((args) => args.length === 5 && args[3] === 922 && args[4] === 1536)).toBe(true)
})

it('只有图外评论也导出扩展画布，并把负坐标改成新参考图内的坐标', async () => {
  mocks.state.sketchBoard = { baseImageSrc: 'original', onConfirm: mocks.confirm, comments: [{ x: -.3, y: .5, text: '图外评论' }] }
  await act(async () => root.render(<SketchBoardModal />))
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('完成'))!.click())
  expect(mocks.confirm.mock.calls[0][0]).toBe('data:image/png;base64,exported')
  expect(mocks.confirm.mock.calls[0][1][0].x).toBeGreaterThan(0)
  expect(mocks.confirm.mock.calls[0][2].imageBounds.x).toBeGreaterThan(0)
})

it('重新打开已有标注不重复扩大图片，直接保存沿用原图和区域元数据', async () => {
  const layout = { width: 900, height: 1500, imageBounds: { x: 100, y: 50, width: 700, height: 1400 } }
  mocks.state.sketchBoard = { baseImageSrc: 'marked', onConfirm: mocks.confirm, layout, comments: [{ x: .1, y: .1, text: '原评论' }] }
  await act(async () => root.render(<SketchBoardModal />))
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('完成'))!.click())
  expect(mocks.confirm).toHaveBeenCalledWith('marked', [{ x: .1, y: .1, text: '原评论' }], layout)
  expect(canvasToBlob).not.toHaveBeenCalled()
})

it('打开时背景铺满整个作画区域，图外落笔不会出现跟随笔迹扩大的底纸边框', async () => {
  await act(async () => root.render(<SketchBoardModal />))
  const area = container.querySelector<HTMLElement>('[aria-label="画板作画区域"]')!
  expect(area).not.toBeNull()
  expect(area.style.background).toBe('rgb(255, 255, 255)')
  expect(area.className).toContain('flex-1')
  const canvas = area.querySelector('canvas')!
  expect(canvas.parentElement!.className).not.toMatch(/ring-|shadow-|rounded-/)
  const background = area.style.background
  await addOutsideText()
  expect(area.style.background).toBe(background)
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('完成'))!.click())
  expect(mocks.confirm.mock.calls[0][2].width).toBeGreaterThan(922)
})
