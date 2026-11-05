import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getParamDisplay } from './paramDisplay'

/** 创建历史任务快照，验证展示仅使用任务自身信息，不依赖当前配置。 */
function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task', prompt: 'image', params: { ...DEFAULT_PARAMS },
    inputImageIds: [], outputImages: [], status: 'done', error: null,
    createdAt: 1, finishedAt: 2, elapsed: 1,
    ...patch,
  }
}

describe('actual image parameter display', () => {
  it('treats omitted complexity as automatic rather than an undefined requested value', () => {
    expect(getParamDisplay(task({ actualParams: { complexity: 'high' } }), 'complexity')).toMatchObject({ requestedValue: 'auto', displayValue: 'high', isMismatch: false, isAutoResolved: true })
  })
  it('shows Grok original JPEG as automatically resolved rather than a PNG mismatch', () => {
    expect(getParamDisplay(task({ apiProvider: 'grok', actualParams: { output_format: 'jpeg' } }), 'output_format')).toEqual({
      requestedValue: 'auto', displayValue: 'jpeg', isMismatch: false, isAutoResolved: true,
    })
  })

  it('does not claim a Grok output format when the task has no actual format', () => {
    expect(getParamDisplay(task({ apiProvider: 'grok' }), 'output_format')).toMatchObject({
      requestedValue: 'auto', displayValue: 'auto', isMismatch: false, isAutoResolved: false,
    })
  })

  it('preserves explicit OpenAI format and quantity mismatches', () => {
    const record = task({ apiProvider: 'openai', params: { ...DEFAULT_PARAMS, n: 2 }, actualParams: { output_format: 'jpeg', n: 1 } })
    expect(getParamDisplay(record, 'output_format')).toMatchObject({ requestedValue: 'png', displayValue: 'jpeg', isMismatch: true })
    expect(getParamDisplay(record, 'n')).toMatchObject({ requestedValue: '2', displayValue: '1', isMismatch: true })
  })
})
