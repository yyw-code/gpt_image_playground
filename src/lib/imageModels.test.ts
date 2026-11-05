import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { getImageParameterCapabilities, getImageRequestParameters } from './imageModels'

describe('image parameter capabilities', () => {
  it.each([
    ['gpt-image-1.5', 'fixed', false],
    ['gpt-image-1.5-2025-12-16', 'fixed', false],
    ['gpt-image-2', 'custom', false],
    ['gpt-image-2-2026-04-21', 'custom', false],
    ['gpt-image-2.5-sunburst', 'custom', true],
    ['gpt-image-2.5-flare-2026-09-08', 'custom', true],
    ['gpt-image-2.6-sunburst', 'custom', true],
    ['gpt-image-2.6-flare', 'custom', true],
    ['gpt-image-2.6-sunburst-2026-11-04', 'auto', false],
    ['vendor-gpt-image-2.6-flare', 'auto', false],
    ['vendor-gpt-image-2.5', 'auto', false],
    ['', 'auto', false],
  ])('uses the confirmed capabilities of %s', (model, sizeMode, extendedQuality) => {
    const capabilities = getImageParameterCapabilities(createDefaultOpenAIProfile({ model }))
    expect(capabilities.sizeMode).toBe(sizeMode)
    expect(capabilities.qualities.includes('max')).toBe(extendedQuality)
    expect(capabilities.nativeOutput).toBe(sizeMode !== 'auto')
  })

  it('uses the Responses image tool model rather than the text model', () => {
    const profile = createDefaultOpenAIProfile({ apiMode: 'responses', model: 'gpt-6', imageGenerationModel: 'gpt-image-1.5' })
    expect(getImageParameterCapabilities(profile).sizeMode).toBe('fixed')
    expect(getImageParameterCapabilities({ ...profile, imageGenerationModel: '' }).sizeMode).toBe('auto')
  })

  it('omits native controls for Codex and unconfirmed aliases', () => {
    const params = { ...DEFAULT_PARAMS, size: '3840x2160', quality: 'max' as const, output_format: 'webp' as const, output_compression: 75, moderation: 'low' as const }
    expect(getImageRequestParameters(params, createDefaultOpenAIProfile({ codexCli: true }))).toEqual({})
    expect(getImageRequestParameters(params, createDefaultOpenAIProfile({ model: 'vendor-image' }))).toEqual({})
  })

  it('limits fixed sizes and stale quality even when the sender bypasses the UI', () => {
    expect(getImageRequestParameters({ ...DEFAULT_PARAMS, size: '3840x2160', quality: 'max' }, createDefaultOpenAIProfile({ model: 'gpt-image-1.5' }))).toMatchObject({ size: 'auto', quality: 'high' })
  })

  it('does not reinterpret third-party provider aliases as unknown OpenAI models', () => {
    const profile = createDefaultOpenAIProfile({ provider: 'custom-provider', model: 'vendor/gpt-image-2.5-custom' })
    expect(getImageParameterCapabilities(profile).qualities).toContain('max')
    expect(getImageParameterCapabilities(profile).sizeMode).toBe('custom')
  })

  it('sends complexity only to confirmed 2.6 Images models with an explicit legal value', () => {
    const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-sunburst' })
    for (const complexity of ['low', 'medium', 'high'] as const) {
      expect(getImageRequestParameters({ ...DEFAULT_PARAMS, complexity }, profile)).toMatchObject({ complexity })
    }
    expect(getImageRequestParameters(DEFAULT_PARAMS, profile)).not.toHaveProperty('complexity')
    for (const other of [
      { ...profile, codexCli: true },
      { ...profile, apiMode: 'responses' as const, imageGenerationModel: profile.model },
      { ...profile, model: 'gpt-image-2.5-sunburst' },
      { ...profile, provider: 'grok' },
      { ...profile, provider: 'custom-provider' },
    ]) expect(getImageRequestParameters({ ...DEFAULT_PARAMS, complexity: 'low' }, other)).not.toHaveProperty('complexity')
  })
})
