import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { getImageParameterCapabilities, getImageRequestParameters } from './imageModels'
import { getImageSubmissionError, normalizeParamsForSettings } from './paramCompatibility'
import { setSiteConnection } from './siteProfiles'

const mode = vi.hoisted(() => ({ IS_SITE_MODE: true }))
vi.mock('./siteMode', () => mode)

const profile = createDefaultOpenAIProfile({ baseUrl: 'https://site.example/v1', codexCli: false })
afterEach(() => { setSiteConnection(); mode.IS_SITE_MODE = true })

describe('本站参数按实际通道限制', () => {
  it.each(['images', 'responses'] as const)('%s 只开放已确认格式和自动质量，不沿用官方模型全部能力', (apiMode) => {
    setSiteConnection(profile)
    const selected = { ...profile, apiMode, imageGenerationModel: profile.model }
    const capabilities = getImageParameterCapabilities(selected)
    expect(capabilities.formats).toEqual(['png'])
    expect(capabilities.qualities).toEqual(['auto'])
    expect(capabilities.compression).toBe(false)
    expect(capabilities.transparency).toBe(false)
    expect(capabilities.moderation).toBe(false)
    expect(capabilities.formatReasons.webp).toContain(apiMode === 'images' ? '实际返回 PNG' : '组合尚未验证')
    expect(getImageRequestParameters(DEFAULT_PARAMS, selected)).toMatchObject({ output_format: 'png', quality: 'auto' })
  })

  it.each([false, true])('CLI=%s 保留旧格式和质量草稿，提交明确拦截，不静默转 PNG', (codexCli) => {
    setSiteConnection(profile)
    const settings = normalizeSettings({ profiles: [{ ...profile, codexCli }] })
    const params = { ...DEFAULT_PARAMS, output_format: 'webp' as const, quality: 'high' as const, output_compression: 80, transparent_output: true }
    expect(normalizeParamsForSettings(params, settings)).toMatchObject(params)
    expect(getImageSubmissionError(params, settings)).not.toBeNull()
    expect(getImageSubmissionError({ ...DEFAULT_PARAMS, output_format: 'webp' }, settings)).toContain('格式')
    expect(getImageSubmissionError({ ...DEFAULT_PARAMS, output_compression: 80 }, settings)).toContain('压缩率')
    expect(getImageSubmissionError({ ...DEFAULT_PARAMS, transparent_output: true }, settings)).toContain('透明背景')
    expect(getImageSubmissionError(DEFAULT_PARAMS, settings)).toBeNull()
  })

  it('未支持的参数不能绕过 UI 进入本站请求构造', () => {
    setSiteConnection(profile)
    expect(() => getImageRequestParameters({ ...DEFAULT_PARAMS, output_format: 'webp' }, profile)).toThrow('格式')
  })

  it('本站限制不影响外站、非站点模式或其他供应商，切回支持通道后恢复能力', () => {
    setSiteConnection(profile)
    for (const selected of [{ ...profile, baseUrl: 'https://api.openai.com/v1' }, { ...profile, provider: 'custom' }]) {
      expect(getImageParameterCapabilities(selected).formats).toEqual(['png', 'jpeg', 'webp'])
      expect(getImageParameterCapabilities(selected).qualities).toContain('high')
    }
    mode.IS_SITE_MODE = false
    expect(getImageParameterCapabilities(profile).formats).toContain('webp')
    expect(getImageRequestParameters({ ...DEFAULT_PARAMS, output_format: 'webp', output_compression: 80 }, profile)).toMatchObject({ output_format: 'webp', output_compression: 80 })
  })
})


it('本站仅对实测 Responses 模型组合开放 JPEG/WebP，CLI 或流式仍禁用', () => {
  setSiteConnection(profile)
  const verified = { ...profile, apiMode: 'responses' as const, model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.5-sunburst', streamImages: false }
  expect(getImageParameterCapabilities(verified).formats).toEqual(['png', 'jpeg', 'webp'])
  for (const patch of [{ codexCli: true }, { streamImages: true }, { model: 'other-text' }, { imageGenerationModel: 'gpt-image-2.6-sunburst' }]) {
    expect(getImageParameterCapabilities({ ...verified, ...patch }).formats).not.toContain('webp')
  }
  expect(getImageRequestParameters({ ...DEFAULT_PARAMS, output_format: 'webp' }, verified)).toMatchObject({ output_format: 'webp' })
})
