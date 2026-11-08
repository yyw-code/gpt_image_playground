import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { getImageRatioSize, getRequestedImageAspectRatio, normalizeImageAspectRatio, formatImageRatio } from './size'
import { getImageRequestParameters, usesImageAspectRatio } from './imageModels'
import { getImageSubmissionError, normalizeParamsForSettings } from './paramCompatibility'
import { getImageParameterCheck, getParamDisplay } from './paramDisplay'

const mode = vi.hoisted(() => ({ IS_SITE_MODE: true }))
vi.mock('./siteMode', () => mode)
afterEach(() => { mode.IS_SITE_MODE = true })

describe('独立的目标画布比例', () => {
  it.each(['16:9', '9:16', '21:9', '2.39:1', '1:1', 'auto'])('保留明确选择的 %s，不反推规整像素', (ratio) => {
    expect(getRequestedImageAspectRatio({ ...DEFAULT_PARAMS, size: '1280x544', imageAspectRatio: ratio })).toBe(ratio)
  })

  it.each(['0:1', '-1:2', 'Infinity:1', '4:1', '1:4', '', 'bad', '1e2:1'])('拒绝非法或超范围比例 %s', (ratio) => {
    expect(normalizeImageAspectRatio(ratio)).toBeUndefined()
  })

  it('旧预设恢复目标比例，自定义像素保持原比例，auto 不沿用残留值', () => {
    expect(getRequestedImageAspectRatio({ ...DEFAULT_PARAMS, size: '3840x1600' })).toBe('21:9')
    expect(getRequestedImageAspectRatio({ ...DEFAULT_PARAMS, size: '1152x960' })).toBe('6:5')
    expect(getImageRatioSize({ ...DEFAULT_PARAMS, imageAspectRatio: 'auto', size: '3840x2160' })).toBe('auto')
  })

  it.each([['1:1', '1024x1024'], ['16:9', '1536x864'], ['9:16', '864x1536']])('使用实测过的 %s 请求尺寸 %s', (ratio, size) => {
    expect(getImageRatioSize({ ...DEFAULT_PARAMS, imageAspectRatio: ratio })).toBe(size)
  })

  it.each([false, true])('站点 CLI=%s 时均保留独立比例，旧 4K 草稿转为小画布建议', (codexCli) => {
    const profile = createDefaultOpenAIProfile({ codexCli })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const draft = { ...DEFAULT_PARAMS, size: '3840x2160' }
    expect(usesImageAspectRatio(profile)).toBe(true)
    const normalized = normalizeParamsForSettings(draft, settings)
    expect(normalized).toMatchObject({ imageAspectRatio: '16:9', size: '1536x864' })
    expect(draft.size).toBe('3840x2160')
    expect(getImageRequestParameters(draft, profile)).toMatchObject(codexCli ? {} : { size: '1536x864' })
    expect(getImageSubmissionError({ ...normalized, imageAspectRatio: '4:1' }, settings)).toContain('比例')
  })

  it('本站模式的外站原生配置不继承本站像素限制', () => {
    const profile = createDefaultOpenAIProfile({ baseUrl: 'https://external.example/v1', codexCli: false })
    expect(usesImageAspectRatio(profile)).toBe(false)
    expect(getImageRequestParameters({ ...DEFAULT_PARAMS, size: '2048x2048' }, profile).size).toBe('2048x2048')
    expect(usesImageAspectRatio({ ...profile, codexCli: true })).toBe(true)
  })

  it('外部原生通道和 Grok 不接管 ChatGPT 目标比例', () => {
    mode.IS_SITE_MODE = false
    const profile = createDefaultOpenAIProfile({ codexCli: false })
    expect(usesImageAspectRatio(profile)).toBe(false)
    expect(getImageRequestParameters({ ...DEFAULT_PARAMS, size: '3840x2160' }, profile).size).toBe('3840x2160')
    mode.IS_SITE_MODE = true
    expect(usesImageAspectRatio({ ...profile, provider: 'grok', codexCli: true })).toBe(false)
  })
})

describe('按原图校验比例', () => {
  /** 构造只核对画布比例的任务，确保质量等隐藏参数不干扰断言。 */
  const task = (size?: string): TaskRecord => ({
    id: 'ratio', prompt: 'cup', params: { ...DEFAULT_PARAMS, size: '1536x864', imageAspectRatio: '16:9' },
    imageParameterMode: 'composition', outputImages: ['image'], inputImageIds: [], status: 'done', createdAt: 1,
    error: null, finishedAt: 2, elapsed: 1,
    actualParams: size ? { size } : {},
  })

  it('实测的半像素差不误报，错误画幅在比例项显示差异', () => {
    expect(getImageParameterCheck(task('1672x941')).mismatches).toEqual([])
    expect(getImageParameterCheck(task('1672x941')).checked).toBe(1)
    expect(getImageParameterCheck(task('1536x1024')).mismatches.map((item) => item.key)).toEqual(['imageAspectRatio'])
    expect(getParamDisplay(task('1536x1024'), 'imageAspectRatio')).toMatchObject({ requestedValue: '16:9', displayValue: '3:2', isMismatch: true })
    expect(getImageParameterCheck(task()).unverified.map((item) => item.key)).toEqual(['imageAspectRatio'])
  })

  it('明确的矩形不能显示为约等于方形', () => {
    expect(formatImageRatio(1170, 1000)).not.toBe('≈1:1')
    expect(formatImageRatio(1254, 1254)).toBe('1:1')
  })
})
