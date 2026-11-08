import type { ImageComment, SketchAnnotationLayout } from '../types'
import { getElementBounds, type SketchBounds, type SketchElement } from './sketch'

/** 初始视口优先展示底图，长边约占八成；图外仍可绘制，未使用留白不写入导出图片。 */
export function getSketchWorkspace(size: { width: number; height: number }, hasImage: boolean): SketchBounds {
  const margin = hasImage ? Math.round(Math.max(size.width, size.height) * .1) : 0
  return { x: margin ? -margin : 0, y: margin ? -margin : 0, width: size.width + margin * 2, height: size.height + margin * 2 }
}

/** 合并原底图、文字笔迹与图外评论的完整范围，保留线宽和抗锯齿边缘。 */
export function getSketchExportBounds(size: { width: number; height: number }, elements: SketchElement[], ctx: CanvasRenderingContext2D, comments: ImageComment[]): SketchBounds {
  const bounds = elements.map((el) => getElementBounds(el, ctx))
  // 已在底图内的评论不增加留白，避免重开缩放后边缘评论触发反复扩边。
  for (const comment of comments) {
    if (comment.x >= 0 && comment.x <= 1 && comment.y >= 0 && comment.y <= 1) continue
    bounds.push({ x: comment.x * size.width, y: comment.y * size.height, width: 0, height: 0 })
  }
  const left = Math.floor(Math.min(0, ...bounds.map((b) => b.x - 8)))
  const top = Math.floor(Math.min(0, ...bounds.map((b) => b.y - 8)))
  const right = Math.ceil(Math.max(size.width, ...bounds.map((b) => b.x + b.width + 8)))
  const bottom = Math.ceil(Math.max(size.height, ...bounds.map((b) => b.y + b.height + 8)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 扩展导出范围后重算评论归一化坐标，确保提示词位置与实际上传图片一致。 */
export function remapSketchComments(comments: ImageComment[], size: { width: number; height: number }, bounds: SketchBounds): ImageComment[] {
  return comments.map((comment) => ({ ...comment, x: (comment.x * size.width - bounds.x) / bounds.width, y: (comment.y * size.height - bounds.y) / bounds.height }))
}

/** 校验本地持久化的标注区域，只恢复有限数值及图片范围内的矩形，兼容无元数据的旧草稿。 */
export function normalizeSketchLayout(raw: unknown): SketchAnnotationLayout | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as SketchAnnotationLayout
  const b = value.imageBounds
  if (!b || ![value.width, value.height, b.x, b.y, b.width, b.height].every(Number.isFinite)
    || value.width <= 0 || value.height <= 0 || b.width <= 0 || b.height <= 0
    || b.x < 0 || b.y < 0 || b.x + b.width > value.width || b.y + b.height > value.height) return undefined
  return { width: value.width, height: value.height, imageBounds: { x: b.x, y: b.y, width: b.width, height: b.height } }
}

/** 根据原图区域生成编辑说明；拒绝非法历史元数据，输出比例继续由现有参数控制。 */
export function getSketchAnnotationInstruction(raw?: SketchAnnotationLayout): string {
  const layout = normalizeSketchLayout(raw)
  if (!layout) return ''
  const b = layout.imageBounds
  const percent = (value: number, total: number) => `${(value / total * 100).toFixed(2)}%`
  return `标注参考图中，待修改原图位于左 ${percent(b.x, layout.width)}、上 ${percent(b.y, layout.height)}、宽 ${percent(b.width, layout.width)}、高 ${percent(b.height, layout.height)} 的矩形区域。图内和图外的文字、笔迹、箭头及位置评论均为修改说明；请执行这些说明，并从最终成图中移除标注、箭头和图外留白。只输出修改后的原图内容，最终画布比例遵循本次生成参数。`
}
