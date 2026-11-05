import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getTaskOutputSlots, mergeRetriedTaskOutputs } from './taskOutputRetry'

describe('失败位置补图', () => {
  const original: TaskRecord = {
    id: 'task', prompt: 'cat', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageIds: [],
    outputImages: ['second'], outputErrors: [{ requestIndex: 0, error: 'busy' }, { requestIndex: 2, error: 'busy' }],
    actualParamsByImage: { second: { size: '1024x1024' } }, transparentOriginalImages: ['second-original'],
    status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1,
  }

  it('仅补选中的失败位置，保留其他成功图片和失败位置', () => {
    const patch = mergeRetriedTaskOutputs(original, [2], { outputImages: ['third'], actualParamsByImage: { third: { quality: 'low' } } })
    expect(patch.outputImages).toEqual(['second', 'third'])
    expect(patch.outputErrors).toEqual([{ requestIndex: 0, error: 'busy' }])
    expect(patch.actualParamsByImage).toEqual({ second: { size: '1024x1024' }, third: { quality: 'low' } })
    expect(getTaskOutputSlots({ ...original, ...patch }).map((slot) => slot.imageId)).toEqual(['', 'second', 'third'])
  })

  it('混合成功失败按原编号合并，再次补图后恢复顺序', () => {
    const patch = mergeRetriedTaskOutputs(original, [0, 2], { outputImages: ['third'], outputErrors: [{ requestIndex: 0, error: '429' }] })
    const done = mergeRetriedTaskOutputs({ ...original, ...patch }, [0], { outputImages: ['first'] })
    expect(done.outputImages).toEqual(['first', 'second', 'third'])
    expect(done.outputErrors).toBeUndefined()
    expect(done.transparentOriginalImages).toEqual(['first', 'second-original', 'third'])
    expect(done.actualParams.n).toBe(3)
  })

  it('封面补图后汇总参数跟随第一张图片，缺失返回保留为失败且不覆盖原图', () => {
    const patch = mergeRetriedTaskOutputs(original, [0, 2], { outputImages: ['first'], actualParamsByImage: { first: { quality: 'low' } } })
    expect(patch.outputImages).toEqual(['first', 'second'])
    expect(patch.actualParams).toEqual({ quality: 'low', n: 2 })
    expect(patch.outputErrors).toEqual([{ requestIndex: 2, error: '接口未返回图片，请手动重试' }])
    expect(patch.transparentOriginalImages).toEqual(['first', 'second-original'])
  })
})
