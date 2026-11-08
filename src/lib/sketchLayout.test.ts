import { describe, expect, it, vi } from 'vitest'
import { getSketchExportBounds, getSketchWorkspace, remapSketchComments, getSketchAnnotationInstruction } from './sketchLayout'
import type { SketchElement } from './sketch'

const ctx = { save: vi.fn(), restore: vi.fn(), measureText: (text: string) => ({ width: text.length * 30 }) } as unknown as CanvasRenderingContext2D
const image = { width: 900, height: 1500 }

describe('图外标注几何', () => {
  it('底图四周提供作画空间，空白画板保持原范围', () => {
    const workspace = getSketchWorkspace(image, true)
    expect(workspace.x).toBeLessThan(0)
    expect(workspace.y).toBeLessThan(0)
    expect(workspace.width).toBeGreaterThan(image.width)
    // 初始适配时原图占长边至少八成，不再为未使用的图外空间缩成小图。
    expect(image.height / workspace.height).toBeGreaterThanOrEqual(.8)
    expect(getSketchWorkspace(image, false)).toEqual({ x: 0, y: 0, ...image })
  })

  it('完整导出跨原图右边界的文字与四边箭头，不拉伸原图', () => {
    const elements: SketchElement[] = [
      { id: 'text', type: 'text', x: 850, y: -100, text: '这是一条图外说明', fontSize: 40, width: 4, color: '#000' },
      { id: 'arrow', type: 'shape', shape: 'arrow', start: { x: -300, y: 1700 }, end: { x: 50, y: 1400 }, width: 12, color: '#000' },
    ]
    const bounds = getSketchExportBounds(image, elements, ctx, [])
    expect(bounds.x).toBeLessThan(-300)
    expect(bounds.y).toBeLessThan(-100)
    expect(bounds.x + bounds.width).toBeGreaterThan(1090)
    expect(bounds.y + bounds.height).toBeGreaterThan(1700)
    const comments = remapSketchComments([{ x: -.2, y: 1.1, text: '外部评论' }], image, bounds)
    expect(comments[0].x).toBeGreaterThan(0)
    expect(comments[0].y).toBeLessThan(1)
    expect(comments[0].x * bounds.width + bounds.x).toBeCloseTo(-180)
  })

  it('评论独立撑开导出范围，空标注不增加画布尺寸，重新保存不重复留白', () => {
    expect(getSketchExportBounds(image, [], ctx, [{ x: .999, y: .001, text: '边缘评论' }])).toEqual({ x: 0, y: 0, ...image })
    expect(getSketchExportBounds(image, [], ctx, [])).toEqual({ x: 0, y: 0, ...image })
    const bounds = getSketchExportBounds(image, [], ctx, [{ x: 1.4, y: -.1, text: '移到这里' }])
    expect(bounds.x + bounds.width).toBeGreaterThan(1260)
    expect(bounds.y).toBeLessThan(-150)
    expect(getSketchExportBounds(bounds, [], ctx, [])).toEqual({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  })

  it('请求说明明确原图位置及移除图外留白，非法历史元数据不能产生无效坐标', () => {
    expect(getSketchAnnotationInstruction({ width: 1200, height: 1800, imageBounds: { x: 100, y: 100, width: 900, height: 1500 } })).toContain('图外')
    expect(getSketchAnnotationInstruction({ width: 0, height: 1800, imageBounds: { x: 100, y: 100, width: 900, height: 1500 } })).toBe('')
  })
})
