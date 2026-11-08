import type { ImageRegenerationDraft, ImageRegenerationTarget, TaskRecord } from '../types'
import { getImageCommentMention } from './promptImageMentions'
import { getSketchAnnotationInstruction } from './sketchLayout'
import { getTaskOutputSlots } from './taskOutputRetry'

/** 列出任务中的成功图片，保留请求编号及重复哈希；失败位置继续走原补图流程。 */
export function getImageRegenerationTargets(tasks: TaskRecord[]): ImageRegenerationTarget[] {
  return tasks.flatMap((task) => getTaskOutputSlots(task).filter((slot) => slot.imageId).map((slot) => ({ taskId: task.id, requestIndex: slot.requestIndex, imageId: slot.imageId })))
}

/** 生成单个源图的请求内容；图片修改不继承旧参考图评论，原输入重跑保留原遮罩和引用。 */
export function buildImageRegenerationJob(task: TaskRecord, target: ImageRegenerationTarget, draft: ImageRegenerationDraft) {
  if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 10) throw new Error('每张源图生成数量须为 1–10 的整数')
  if (!draft.targets.length) throw new Error('请选择来源图片')
  const slot = getTaskOutputSlots(task).find((item) => item.requestIndex === target.requestIndex)
  if (target.taskId !== task.id || !slot?.imageId || slot.imageId !== target.imageId) throw new Error('来源图片已改变或不存在，请重新选择')
  if (draft.annotation && (draft.targets.length !== 1 || draft.mode !== 'edit')) throw new Error('画板标注仅适用于单张源图修改')
  // 原提示词的胶囊坐标指向旧参考图，不能被解释成当前输出图的位置标注。
  const original = draft.mode === 'edit'
    ? task.prompt.replace(/\u2063@图\d+ 评论\u2065[^\u2064]*\u2064/g, '').replace(/\u2063@图\d+\u2064/g, '参考图片')
    : task.prompt
  const prompt = draft.promptMode === 'original' ? original : draft.promptMode === 'append' ? `${original}\n\n${draft.prompt.trim()}`.trim() : draft.prompt.trim()
  const annotatedPrompt = draft.annotation
    ? `${prompt || '请根据图片上的标注修改图像，保留未要求修改的内容。'}${getSketchAnnotationInstruction(draft.annotation.layout) ? `\n${getSketchAnnotationInstruction(draft.annotation.layout)}` : ''}${draft.annotation.comments.length ? `\n${getImageCommentMention(0, draft.annotation.comments)}` : ''}`
    : prompt
  if (!annotatedPrompt.trim()) throw new Error('请输入提示词或修改要求')
  return {
    prompt: annotatedPrompt,
    params: { ...(draft.params ?? task.params), n: draft.count },
    inputImageIds: draft.mode === 'edit' ? [draft.annotation?.image.id ?? target.imageId] : [...task.inputImageIds],
    maskTargetImageId: draft.mode === 'rerun' ? task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null) : null,
    maskImageId: draft.mode === 'rerun' ? task.maskImageId ?? null : null,
  }
}

/** 校验历史或导入的来源关系；不信任外部字段类型，非法记录按普通任务独立显示。 */
export function getImageRegenerationOrigin(task: TaskRecord) {
  const origin = task.regeneration
  return origin && typeof origin.taskId === 'string' && origin.taskId !== task.id && typeof origin.imageId === 'string'
    && Number.isInteger(origin.requestIndex) && origin.requestIndex >= 0 && ['edit', 'rerun'].includes(origin.mode)
    && typeof origin.groupId === 'string' ? origin : undefined
}

/** 沿来源关系定位原始图片；来源删除时停在当前记录，循环关系不参与聚合。 */
function getVersionRoot(tasks: TaskRecord[], taskId: string, requestIndex: number) {
  const visited = new Set<string>()
  let task = tasks.find((item) => item.id === taskId)
  let index = requestIndex
  while (task) {
    if (visited.has(task.id)) return null
    visited.add(task.id)
    const origin = getImageRegenerationOrigin(task)
    if (!origin) return `${task.id}:${index}`
    const parent = tasks.find((item) => item.id === origin.taskId)
    if (!parent) return `${task.id}:${index}`
    index = origin.requestIndex
    task = parent
  }
  return null
}

/** 同一个原始图片的各版本及候选按创建顺序返回，失败／运行记录也保留用于查看和补图。 */
export function getImageVersions(tasks: TaskRecord[], taskId: string, requestIndex: number) {
  const root = getVersionRoot(tasks, taskId, requestIndex)
  if (!root) return []
  return [...tasks].sort((a, b) => a.createdAt - b.createdAt).flatMap((task) => {
    const slots = getTaskOutputSlots(task)
    const candidates = slots.length ? slots : [{ requestIndex: 0, imageId: '', error: task.error || '', outputImageIndex: -1 }]
    return candidates.filter((slot) => getVersionRoot(tasks, task.id, slot.requestIndex) === root).map((slot) => ({ task, slot }))
  })
}

/** 来源任务在当前筛选结果中时收起衍生卡片；来源被删除、筛选排除或形成循环则独立保留。 */
export function getVisibleVersionTasks(tasks: TaskRecord[]) {
  const ids = new Set(tasks.map((task) => task.id))
  return tasks.filter((task) => {
    const origin = getImageRegenerationOrigin(task)
    if (!origin || !ids.has(origin.taskId)) return true
    return !getVersionRoot(tasks, task.id, 0)
  })
}
