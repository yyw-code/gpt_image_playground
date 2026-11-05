import type { TaskRecord } from '../types'

/** 将已保存成功图片和明确失败编号还原为有序位置，兼容没有失败信息的旧记录。 */
export function getTaskOutputSlots(task: Pick<TaskRecord, 'params' | 'outputImages' | 'outputErrors'>) {
  const errors = new Map(task.outputErrors?.map((item) => [item.requestIndex, item.error]))
  const count = errors.size ? Math.max(task.params.n, task.outputImages.length + errors.size) : task.outputImages.length
  let outputImageIndex = 0
  return Array.from({ length: count }, (_, requestIndex) => {
    const error = errors.get(requestIndex) ?? ''
    if (error) return { requestIndex, outputImageIndex: -1, imageId: '', error }
    const imageId = task.outputImages[outputImageIndex] ?? ''
    return { requestIndex, outputImageIndex: outputImageIndex++, imageId, error: '' }
  })
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
