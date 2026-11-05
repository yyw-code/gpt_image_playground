import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getChangedParams, getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('keeps valid 2.6 complexity and clears it from state after changing the model', () => {
    const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2.6-flare', codexCli: false })
    const current = { ...DEFAULT_PARAMS, complexity: 'low' as const }
    expect(normalizeParamsForSettings(current, normalizeSettings({ profiles: [profile] })).complexity).toBe('low')
    const next = normalizeParamsForSettings(current, normalizeSettings({ profiles: [{ ...profile, model: 'gpt-image-2.5-flare' }] }))
    expect(next).not.toHaveProperty('complexity')
    expect(getChangedParams(current, next)).toHaveProperty('complexity', undefined)
    expect(getChangedParams({ ...current, complexity: undefined }, next)).toEqual({})
  })
  it.each([0, -2, NaN, Infinity, 1.9, 20])('normalizes output count %s to a finite integer', (n) => {
    const normalized = normalizeParamsForSettings({ ...DEFAULT_PARAMS, n }, DEFAULT_SETTINGS)
    expect(normalized.n).toBe(n === 20 ? 10 : 1)
  })

  it('clears controls unsupported by an unknown OpenAI alias', () => {
    const settings = normalizeSettings({ profiles: [createDefaultOpenAIProfile({ model: 'vendor-image', codexCli: false })] })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '3840x2160', quality: 'max', output_format: 'webp', output_compression: 80, transparent_output: true }, settings)).toMatchObject({ size: 'auto', quality: 'auto', output_format: 'png', output_compression: null, transparent_output: false })
  })

  it('keeps Grok 2.0 quality and ratios but clears them when switching models', () => {
    const profile = createDefaultOpenAIProfile({ provider: 'grok', model: 'grok-imagine-image-2.0' })
    const settings = normalizeSettings({ profiles: [profile] })
    const params = { ...DEFAULT_PARAMS, quality: 'medium' as const, aspect_ratio: '21:9' }
    expect(normalizeParamsForSettings(params, settings)).toMatchObject({ quality: 'medium', aspect_ratio: '21:9' })
    const older = normalizeSettings({ profiles: [{ ...profile, model: 'grok-imagine-image' }] })
    expect(normalizeParamsForSettings(params, older)).toMatchObject({ quality: 'auto', aspect_ratio: '1:1' })
    expect(normalizeParamsForSettings({ ...params, quality: 'high' }, settings).quality).toBe('auto')
  })
  it('limits OpenAI output count to 10', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: false })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('limits fal.ai output count to 4', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(4)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, settings).n).toBe(4)
  })

  it('keeps OpenAI streaming output count so the request can disable streaming', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key', streamImages: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(4)
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size).toBe('auto')
  })

  it('limits Codex CLI custom sizes to 1K while preserving auto', () => {
    const profile = createDefaultOpenAIProfile({ apiKey: 'test-key', codexCli: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [profile],
      activeProfileId: profile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, settings).size).toBe('1024x1024')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('auto')
  })

  it('applies Codex CLI parameter limits to custom providers', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [{
        id: 'custom-provider',
        name: 'Custom Provider',
        submit: { path: 'images/generations' },
      }],
      profiles: [{
        ...createDefaultOpenAIProfile(),
        provider: 'custom-provider',
        codexCli: true,
      }],
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048', quality: 'high' }, settings)).toMatchObject({
      size: '1024x1024',
      quality: DEFAULT_PARAMS.quality,
    })
  })

  it.each(['api', 'local'] as const)('clears hidden custom Codex controls while preserving only %s background behavior', (transparentBackgroundMethod) => {
    const profile = createDefaultOpenAIProfile({ provider: 'custom-codex', codexCli: true, transparentBackgroundMethod })
    const settings = normalizeSettings({
      profiles: [profile],
      customProviders: [{ id: 'custom-codex', name: 'Custom Codex', submit: { path: 'images/generations', body: { background: '$params.background' } } }],
    })
    const params = { ...DEFAULT_PARAMS, size: '1280x720', quality: 'max' as const, output_format: 'webp' as const, output_compression: 80, moderation: 'low' as const, transparent_output: true }
    expect(normalizeParamsForSettings(params, settings)).toMatchObject({
      size: '1280x720', quality: 'auto', output_format: 'png', output_compression: null,
      moderation: 'auto', transparent_output: transparentBackgroundMethod === 'local',
    })
    expect(params).toMatchObject({ output_format: 'webp', output_compression: 80, transparent_output: true })
  })

  it('does not apply Codex CLI parameter limits to fal.ai', () => {
    const profile = createDefaultFalProfile({ codexCli: true })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      codexCli: true,
      profiles: [profile],
      activeProfileId: profile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048' }, settings).size).toBe('2048x2048')
  })

  it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] as const)('keeps 2.5 quality levels for %s', (model) => {
    const profile = createDefaultOpenAIProfile({ model, codexCli: false })
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile] })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'xhigh' }, settings).quality).toBe('xhigh')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max' }, settings).quality).toBe('max')
  })

  it.each(['openai/gpt-image-2.5/sunburst', 'openai/gpt-image-2.5/flare'] as const)('keeps fal.ai 2.5 quality levels for %s', (model) => {
    const profile = createDefaultFalProfile({ model })
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'xhigh' }, settings).quality).toBe('xhigh')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max' }, settings).quality).toBe('max')
  })

  it.each(['vendor/gpt-image-2.5-custom', 'my-gpt-image-2.5-proxy'])('keeps 2.5 quality levels for a custom provider model %s', (model) => {
    const profile = { ...createDefaultOpenAIProfile({ model, codexCli: false }), provider: 'custom-provider' }
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      customProviders: [{ id: 'custom-provider', name: 'Custom Provider', submit: { path: 'images/generations' } }],
      profiles: [profile],
      activeProfileId: profile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'xhigh' }, settings).quality).toBe('xhigh')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max' }, settings).quality).toBe('max')
  })

  it('falls back to high when an older image model receives a 2.5 quality level', () => {
    const profile = createDefaultOpenAIProfile({ model: 'gpt-image-2', codexCli: false })
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile] })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max' }, settings).quality).toBe('high')
  })
})
