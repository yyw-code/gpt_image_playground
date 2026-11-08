import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getParamDisplay, getImageParameterCheck, getTaskImageActualParams } from './paramDisplay'

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
  it('兼容模式保留参考尺寸的精确对照，不用它声称原生参数验证失败', () => {
    const record = task({ imageParameterMode: 'composition', params: { ...DEFAULT_PARAMS, size: '1920x816' }, actualParams: { size: '1914x822' } })
    expect(getParamDisplay(record, 'size')).toMatchObject({ requestedValue: '1920x816', displayValue: '1914x822', isMismatch: true })
    expect(getImageParameterCheck(record).mismatches).toEqual([])
  })

  it.each([undefined, '', 'auto'])('缺少有效尺寸回显 %s 不展示黄色差异', (size) => {
    const record = task({ params: { ...DEFAULT_PARAMS, size: '1536x1024' }, actualParams: { size } })
    expect(getParamDisplay(record, 'size').isMismatch).toBe(false)
    expect(getImageParameterCheck(record).unverified.map((item) => item.key)).toContain('size')
  })

  it('Grok 参数旁的比例使用实际宽高，不能用接口照抄比例掩盖不符', () => {
    const record = task({ apiProvider: 'grok', params: { ...DEFAULT_PARAMS, aspect_ratio: '16:9' }, actualParams: { size: '1024x1024', aspect_ratio: '16:9' } })
    expect(getParamDisplay(record, 'aspect_ratio')).toMatchObject({ requestedValue: '16:9', displayValue: '1:1', isMismatch: true })
  })

  it.each(['composition', 'default'] as const)('does not compare hidden native draft fields in %s mode', (imageParameterMode) => {
    const record = task({ imageParameterMode, params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', output_format: 'webp' }, actualParams: { size: '1024x1024', quality: 'low', output_format: 'png' } })
    expect(getImageParameterCheck(record)).toEqual({ checked: 0, mismatches: [], unverified: [] })
    expect(getParamDisplay(record, 'output_format')).toMatchObject({ requestedValue: 'auto', displayValue: 'png', isMismatch: false, isAutoResolved: true })
    expect(getParamDisplay(record, 'quality')).toMatchObject({ requestedValue: 'auto', displayValue: 'low', isMismatch: false })
  })
  it('reports exact pixel, quality and format differences without changing generation success', () => {
    const record = task({ params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', output_format: 'webp' }, actualParams: { size: '768x512', quality: 'low', output_format: 'png' } })
    expect(getImageParameterCheck(record).mismatches.map((item) => item.key)).toEqual(['size', 'quality', 'output_format'])
    expect(record.status).toBe('done')
  })

  it('does not treat absent or automatic response values as verified', () => {
    const record = task({ params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high' }, actualParams: { size: '', quality: 'auto' } })
    const check = getImageParameterCheck(record)
    expect(check.mismatches).toEqual([])
    expect(check.unverified.map((item) => item.key)).toEqual(['size', 'quality', 'output_format'])
    expect(check.checked).toBe(0)
  })

  it('compares only specified parameters and keeps quality verification at response level', () => {
    const record = task({ params: { ...DEFAULT_PARAMS, size: 'auto', quality: 'auto', output_format: 'png' }, actualParams: { size: '1024x1024', quality: 'low', output_format: 'png' } })
    expect(getImageParameterCheck(record)).toMatchObject({ checked: 1, mismatches: [], unverified: [] })
  })

  it('does not apply another batch image metadata to an image with no response fields', () => {
    const record = task({ outputImages: ['first', 'second'], actualParams: { quality: 'high' }, actualParamsByImage: { first: { quality: 'high' } } })
    expect(getTaskImageActualParams(record, 'first')).toEqual({ quality: 'high' })
    expect(getTaskImageActualParams(record, 'second')).toEqual({})
    expect(getTaskImageActualParams({ ...record, outputImages: ['first'], actualParamsByImage: undefined }, 'first')).toEqual({ quality: 'high' })
  })

  it('keeps Grok geometry and original format out of GPT pixel and format checks', () => {
    const record = task({ apiProvider: 'grok', apiModel: 'grok-imagine-image', params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high' }, actualParams: { size: '1024x1024', output_format: 'jpeg' } })
    expect(getImageParameterCheck(record)).toMatchObject({ checked: 0, mismatches: [], unverified: [] })
  })

  it.each([
    ['1024x1024', true], ['1672x941', false], ['1920x1080', false],
  ])('checks Grok requested ratio against actual pixels %s', (size, mismatch) => {
    const record = task({ apiProvider: 'grok', apiModel: 'grok-imagine-image-2.0', imageParameterMode: 'native',
      params: { ...DEFAULT_PARAMS, aspect_ratio: '16:9', quality: 'medium' }, actualParams: { size, quality: 'medium' } })
    const check = getImageParameterCheck(record)
    expect(check.checked).toBe(2)
    expect(check.mismatches.map((item) => item.key)).toEqual(mismatch ? ['aspect_ratio'] : [])
    expect(check.unverified).toEqual([])
  })

  it.each([undefined, '', 'auto', '0x1024', 'bad'])('does not verify Grok ratio without valid dimensions (%s)', (size) => {
    const record = task({ apiProvider: 'grok', params: { ...DEFAULT_PARAMS, aspect_ratio: '16:9' }, actualParams: { size, aspect_ratio: '16:9' } })
    expect(getImageParameterCheck(record).unverified.map((item) => item.key)).toEqual(['aspect_ratio'])
    expect(getImageParameterCheck(record).mismatches).toEqual([])
  })

  it('leaves automatic Grok geometry unconstrained and missing resolution unverified', () => {
    const record = task({ apiProvider: 'grok', params: { ...DEFAULT_PARAMS, aspect_ratio: 'auto', resolution: '2k' }, actualParams: { size: '1024x1024' } })
    expect(getImageParameterCheck(record).unverified.map((item) => item.key)).toEqual(['resolution'])
    expect(getImageParameterCheck(record).mismatches).toEqual([])
    expect(getImageParameterCheck(record, { resolution: '1k' }).mismatches.map((item) => item.key)).toEqual(['resolution'])
  })

  it('reports missing compression separately and verifies explicit complexity', () => {
    const record = task({ params: { ...DEFAULT_PARAMS, output_format: 'webp', output_compression: 80, complexity: 'low' }, actualParams: { output_format: 'webp', complexity: 'high' } })
    const check = getImageParameterCheck(record)
    expect(check.mismatches.map((item) => item.key)).toContain('complexity')
    expect(check.unverified.map((item) => item.key)).toContain('output_compression')
  })

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
