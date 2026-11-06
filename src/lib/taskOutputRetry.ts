import type { TaskRecord } from '../types'

type OutputTask = Pick<TaskRecord, 'params' | 'outputImages' | 'outputErrors'> & Partial<Pick<TaskRecord, 'status' | 'error' | 'imageRequests'>>

/** 按原编号还原图片位置；中断旧记录缺少逐图错误时补齐空位，不把整批错误覆盖到成功图片。 */
export function getTaskOutputSlots(task: OutputTask) {
  const errors = new Map(task.outputErrors?.map((item) => [item.requestIndex, item.error]))
  const count = errors.size || task.status === 'error' || task.imageRequests?.length
    ? Math.max(task.params.n, task.outputImages.length + errors.size)
    : task.outputImages.length
  let outputImageIndex = 0
  return Array.from({ length: count }, (_, requestIndex) => {
    const error = errors.get(requestIndex) ?? ''
    if (error) return { requestIndex, outputImageIndex: -1, imageId: '', error }
    const imageId = task.outputImages[outputImageIndex] ?? ''
    return { requestIndex, outputImageIndex: imageId ? outputImageIndex++ : -1, imageId, error: imageId ? '' : task.error || '尚未完成' }
  })
}

/** 优先根据已保存图片和逐图请求状态展示结果，避免把未发送、未知结果统称失败。 */
export function getTaskOutputSlotLabel(task: OutputTask, slot: ReturnType<typeof getTaskOutputSlots>[number]) {
  if (slot.imageId) return '已成功'
  const state = task.imageRequests?.[slot.requestIndex]?.state
  if (state === 'unknown') return '结果未知'
  if (state === 'queued') return '未发送'
  if (state === 'running') return task.status === 'running' ? '生成中' : '结果未知'
  if (state === 'saving') return task.status === 'running' ? '保存中' : '结果未知'
  if (state === 'failed') return '生成失败'
  if (task.error === '请求中断') return '未完成'
  return slot.error ? '生成失败' : '未完成'
}

/** 将补图结果写回原失败位置，保留其他图片、原图与逐图参数；缺图继续作为失败展示。 */
export function mergeRetriedTaskOutputs(task: TaskRecord, indices: number[], generated: Pick<TaskRecord, 'outputImages' | 'outputErrors' | 'actualParamsByImage' | 'revisedPromptByImage' | 'transparentOriginalImages' | 'rawImageUrls'>) {
  const slots = getTaskOutputSlots(task)
  const failed = new Map(generated.outputErrors?.map((item) => [item.requestIndex, item.error]))
  let imageIndex = 0
  for (const [localIndex, requestIndex] of indices.entries()) {
    const error = failed.get(localIndex)
    const imageId = error ? '' : generated.outputImages[imageIndex] ?? ''
    slots[requestIndex] = { requestIndex, outputImageIndex: imageId ? imageIndex++ : -1, imageId, error: error || (imageId ? '' : '接口未返回图片，请手动重试') }
  }
  const outputImages = slots.flatMap((slot) => slot.imageId ? [slot.imageId] : [])
  const outputErrors = slots.flatMap((slot) => slot.error ? [{ requestIndex: slot.requestIndex, error: slot.error }] : [])
  const actualParamsByImage = { ...task.actualParamsByImage, ...generated.actualParamsByImage }
  const originalByImage = new Map([
    ...task.outputImages.map((id, index) => [id, task.transparentOriginalImages?.[index]] as const),
    ...generated.outputImages.map((id, index) => [id, generated.transparentOriginalImages?.[index]] as const),
  ])
  const urlByImage = new Map([
    ...task.outputImages.map((id, index) => [id, task.rawImageUrls?.[index]] as const),
    ...generated.outputImages.map((id, index) => [id, generated.rawImageUrls?.[index]] as const),
  ])
  return {
    outputImages,
    outputErrors: outputErrors.length ? outputErrors : undefined,
    actualParams: { ...(actualParamsByImage[outputImages[0]] ?? task.actualParams), n: outputImages.length },
    actualParamsByImage,
    revisedPromptByImage: { ...task.revisedPromptByImage, ...generated.revisedPromptByImage },
    transparentOriginalImages: task.transparentOriginalImages || generated.transparentOriginalImages ? outputImages.map((id) => originalByImage.get(id) ?? id) : undefined,
    rawImageUrls: task.rawImageUrls || generated.rawImageUrls ? outputImages.map((id) => urlByImage.get(id) ?? '') : undefined,
  }
}
