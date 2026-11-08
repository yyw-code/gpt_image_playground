import { describe, expect, it } from 'vitest'
import type { ImageRegenerationDraft, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getImageCommentMention, getSelectedImageMentionLabel, replaceImageMentionsForApi } from './promptImageMentions'
import { buildImageRegenerationJob, getImageRegenerationTargets, getImageVersions, getVisibleVersionTasks } from './imageRegeneration'

/** 构造含成功、失败位置的批次，验证源图按请求槽位而非图片哈希定位。 */
function source(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { id: 'source', prompt: '原提示词', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageIds: ['reference'], outputImages: ['same', 'same'], outputErrors: [{ requestIndex: 1, error: '失败' }], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, ...patch }
}

/** 返回单源图编辑草稿，默认每张仅生成一个候选。 */
function draft(patch: Partial<ImageRegenerationDraft> = {}): ImageRegenerationDraft {
  return { targets: getImageRegenerationTargets([source()]), mode: 'edit', prompt: '改成蓝色', promptMode: 'replace', count: 1, ...patch }
}

describe('图片重新生成计划', () => {
  it('保留相同图片哈希在不同请求位置的独立选择', () => {
    expect(getImageRegenerationTargets([source()])).toEqual([{ taskId: 'source', requestIndex: 0, imageId: 'same' }, { taskId: 'source', requestIndex: 2, imageId: 'same' }])
  })

  it('单张编辑只以当前输出图为输入，数量不继承原批次 n', () => {
    const job = buildImageRegenerationJob(source(), draft().targets[0], draft())
    expect(job).toMatchObject({ prompt: '改成蓝色', inputImageIds: ['same'], params: { n: 1 }, maskImageId: null })
    expect(source().params.n).toBe(3)
  })

  it('按原输入重跑时保留参考图、提示词和遮罩', () => {
    const task = source({ maskImageId: 'mask', maskTargetImageId: 'reference' })
    const job = buildImageRegenerationJob(task, draft().targets[0], draft({ mode: 'rerun', promptMode: 'original', prompt: '' }))
    expect(job).toMatchObject({ prompt: '原提示词', inputImageIds: ['reference'], maskImageId: 'mask', maskTargetImageId: 'reference' })
  })

  it('位置评论只绑定编辑源图，不携带原参考图评论', () => {
    const task = source({ prompt: `原要求 ${getImageCommentMention(0, [{ x: .1, y: .2, text: '旧评论' }])} ${getSelectedImageMentionLabel(0)}` })
    const job = buildImageRegenerationJob(task, draft().targets[0], draft({ targets: [draft().targets[0]], promptMode: 'append', annotation: { image: { id: 'annotated', dataUrl: 'data:image/png;base64,test' }, comments: [{ x: .7, y: .4, text: '修改杯把' }] } }))
    expect(job.inputImageIds).toEqual(['annotated'])
    const prompt = replaceImageMentionsForApi(job.prompt, 1)
    expect(prompt).toContain('修改杯把')
    expect(prompt).not.toContain('旧评论')
    expect(prompt).toContain('X=70%')
  })

  it.each([0, -1, 1.5, 11])('拒绝非法每图数量 %s', (count) => {
    expect(() => buildImageRegenerationJob(source(), draft().targets[0], draft({ count }))).toThrow('数量')
  })

  it('拒绝批量携带标注，按原输入重跑同样不能夹带标注', () => {
    const annotation = { image: { id: 'annotated', dataUrl: 'data:image/png;base64,test' }, comments: [] }
    expect(() => buildImageRegenerationJob(source(), draft().targets[0], draft({ annotation }))).toThrow('单张')
    expect(() => buildImageRegenerationJob(source(), draft().targets[0], draft({ targets: [draft().targets[0]], mode: 'rerun', annotation }))).toThrow('单张')
  })

  it('来源槽位或图片被改变时拒绝提交，不误生成另一张', () => {
    expect(() => buildImageRegenerationJob(source(), { taskId: 'source', requestIndex: 1, imageId: 'same' }, draft())).toThrow('来源')
    expect(() => buildImageRegenerationJob(source(), { taskId: 'other', requestIndex: 0, imageId: 'same' }, draft())).toThrow('来源')
  })

  it('空提示词拒绝，单图标注可作为修改要求', () => {
    expect(() => buildImageRegenerationJob(source(), draft().targets[0], draft({ prompt: '' }))).toThrow('提示词')
    expect(buildImageRegenerationJob(source(), draft().targets[0], draft({ targets: [draft().targets[0]], prompt: '', annotation: { image: { id: 'a', dataUrl: 'data:image/png;base64,test' }, comments: [] } })).prompt).toContain('标注')
  })

  it('版本沿来源关系聚合，来源删除后新版本独立展示，循环关系不丢记录', () => {
    const original = source()
    const v2 = source({ id: 'v2', createdAt: 3, outputImages: ['new'], outputErrors: undefined, params: { ...DEFAULT_PARAMS }, regeneration: { ...draft().targets[0], mode: 'edit', groupId: 'group' } })
    expect(getVisibleVersionTasks([v2, original])).toEqual([original])
    expect(getVisibleVersionTasks([v2])).toEqual([v2])
    expect(getImageVersions([original, v2], original.id, 0).map((v) => v.task.id)).toEqual(['source', 'v2'])
    expect(getImageVersions([original, v2], original.id, 2).map((v) => v.task.id)).toEqual(['source'])
    const cycle = { ...original, regeneration: { taskId: 'v2', requestIndex: 0, imageId: 'new', mode: 'edit' as const, groupId: 'group' } }
    expect(getVisibleVersionTasks([cycle, v2])).toHaveLength(2)
  })
})


it('图外标注请求包含原图区域和移除留白说明，不改动目标比例', () => {
  const annotation = { image: { id: 'a', dataUrl: 'data:image/png;base64,test' }, comments: [{ x: .9, y: .1, text: '图外要求' }], layout: { width: 1200, height: 1800, imageBounds: { x: 100, y: 100, width: 900, height: 1500 } } }
  const params = { ...DEFAULT_PARAMS, imageAspectRatio: '9:16' }
  const job = buildImageRegenerationJob(source(), draft().targets[0], draft({ targets: [draft().targets[0]], prompt: '', params, annotation }))
  expect(job.prompt).toContain('图内和图外')
  expect(job.prompt).toContain('最终画布比例遵循本次生成参数')
  expect(replaceImageMentionsForApi(job.prompt)).toContain('图外要求')
  expect(job.inputImageIds).toEqual(['a'])
  expect(job.params.imageAspectRatio).toBe('9:16')
})

it.each([
  { prompt: '', expected: '原提示词' },
  { prompt: '  改成蓝色  ', expected: '原提示词\n\n改成蓝色' },
])('简化重生成沿用原提示词并追加可选要求：$prompt', ({ prompt, expected }) => {
  const task = source({ inputImageIds: ['old-reference'], maskImageId: 'old-mask', maskTargetImageId: 'old-reference' })
  const job = buildImageRegenerationJob(task, draft().targets[0], draft({ mode: 'rerun', promptMode: 'append', prompt }))
  expect(job.prompt).toBe(expected)
  expect(job.inputImageIds).toEqual(['old-reference'])
  expect(job.maskImageId).toBe('old-mask')
})
