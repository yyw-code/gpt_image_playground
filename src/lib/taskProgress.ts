import type { TaskRecord } from '../types'

/** 显示当前图片的排队位置或生成编号；等待时不把排队时间显示为执行耗时。 */
export function getTaskGenerationLabel(task: TaskRecord) {
  const progress = task.generationProgress
  if (!progress) return '生成中...'
  return progress.state === 'queued'
    ? `第 ${progress.requestIndex + 1} 张排队中（等待序号 ${progress.queuePosition}）`
    : `正在生成第 ${progress.requestIndex + 1} / ${task.params.n} 张`
}
