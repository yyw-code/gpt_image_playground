import { afterEach, describe, expect, it, vi } from 'vitest'
import grokPresetJson from '../../gpt-image-config.grok.example.json?raw'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'
import { createDefaultOpenAIProfile, getActiveApiProfile, getAgentImageApiProfile, importCustomProviderSettingsFromJson, getApiProviderLabel, getCustomProviderDefinition, mergePresetImportedSettings, normalizeSettings, switchApiProfileProvider } from './apiProfiles'
import { GROK_IMAGE_MODELS, normalizeGrokImageResult } from './grokImage'
import { normalizeParamsForSettings } from './paramCompatibility'

const PNG = 'iVBORw0KGgoAAAANSUhEUg=='
const JPEG = '/9j/4AAQSkZJRg=='

/** 创建不含真实凭据的 Grok 测试配置；所有请求均由 fetch mock 接管。 */
function settings() {
  return normalizeSettings({
    profiles: [{ id: 'grok-test', provider: 'grok', name: 'Grok', baseUrl: 'https://relay.example/v1', apiKey: 'test-grok-key', model: 'grok-imagine-image' }],
    activeProfileId: 'grok-test',
  })
}

describe('Grok image integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the built-in provider and forces safe Images settings on imported profiles', () => {
    const value = normalizeSettings({ profiles: [{ ...settings().profiles[0], apiMode: 'responses', codexCli: true, streamImages: true, transparentBackgroundMethod: 'api' }] })
    expect(value.profiles[0]).toMatchObject({ provider: 'grok', apiMode: 'images', codexCli: false, streamImages: false, transparentBackgroundMethod: 'local' })
    expect(getApiProviderLabel(value, 'grok')).toBe('Grok（Sub2API）')
    expect(getCustomProviderDefinition(value, 'grok')?.editSubmit?.path).toBe('images/edits')
  })

  it.each(['restore', 'import', 'deployment', 'preset'])('preserves a legacy custom grok protocol during %s', (mode) => {
    const legacy = {
      customProviders: [{ id: 'grok', name: 'Legacy Grok', submit: { path: 'custom/image', query: { version: 'legacy' }, body: { prompt: '$prompt', legacy: true } } }],
      profiles: [{ id: 'legacy-profile', name: 'Legacy', provider: 'grok', baseUrl: 'https://relay.example/v1', apiKey: 'test-key', model: 'legacy-model', providerDrafts: { grok: { model: 'legacy-draft', responseFormatB64Json: false } } }],
      providerOrder: ['grok', 'openai'],
      activeProfileId: 'legacy-profile',
    }
    const value = mode === 'restore'
      ? normalizeSettings(legacy)
      : mode === 'preset'
        ? mergePresetImportedSettings({}, legacy).settings
        : normalizeSettings(importCustomProviderSettingsFromJson(JSON.stringify(legacy), [], { deploymentConfig: mode === 'deployment' }))
    const profile = value.profiles.find((item) => item.id === 'legacy-profile')!
    const customId = value.customProviders[0].id
    expect(customId).not.toBe('grok')
    expect(profile).toMatchObject({ id: 'legacy-profile', provider: customId, model: 'legacy-model', apiKey: 'test-key' })
    expect(profile.providerDrafts?.[customId]).toMatchObject({ model: 'legacy-draft', responseFormatB64Json: undefined })
    expect(profile.providerDrafts?.grok).toBeUndefined()
    expect(getCustomProviderDefinition(value, profile.provider)?.submit).toMatchObject({ path: 'custom/image', query: { version: 'legacy' }, body: { prompt: '$prompt', legacy: true } })
    if (mode === 'restore') expect(value.providerOrder?.[0]).toBe(customId)
    expect(normalizeSettings(value)).toEqual(value)
    expect(legacy.profiles[0].provider).toBe('grok')
    expect(legacy.customProviders[0].id).toBe('grok')
  })

  it('migrates a standalone legacy Grok deployment manifest', () => {
    const imported = importCustomProviderSettingsFromJson(JSON.stringify({ id: 'grok', name: 'Legacy', submit: { path: 'legacy/image' } }), [], { deploymentConfig: true })
    expect(imported.customProviders[0]).toMatchObject({ legacyProviderId: 'grok', submit: { path: 'legacy/image' } })
    expect(imported.customProviders[0].id).not.toBe('grok')
  })

  it('does not overwrite an existing custom provider while migrating a legacy grok ID', () => {
    const value = normalizeSettings({
      customProviders: [
        { id: 'grok', name: 'Legacy Grok', submit: { path: 'legacy/image' } },
        { id: 'custom-legacy-grok', name: 'Existing', submit: { path: 'existing/image' } },
      ],
      profiles: [{ id: 'legacy', provider: 'grok', model: 'legacy-model' }],
    })
    expect(new Set(value.customProviders.map((provider) => provider.id)).size).toBe(2)
    expect(getCustomProviderDefinition(value, value.profiles[0].provider)?.submit.path).toBe('legacy/image')
    expect(getCustomProviderDefinition(value, 'custom-legacy-grok')?.submit.path).toBe('existing/image')
  })

  it('switches to all three image models without inheriting another group key', () => {
    const value = switchApiProfileProvider(createDefaultOpenAIProfile({ apiKey: 'other-group-key', baseUrl: 'https://relay.example/v1' }), 'grok')
    expect(value.provider).toBe('grok')
    expect(value.apiKey).toBe('')
    expect(value.baseUrl).toBe('https://relay.example/v1')
    expect(value.model.split(', ')).toEqual(['grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality'])
  })

  it('imports the preset with separate GPT, Grok and Agent profiles and no embedded key', () => {
    const imported = importCustomProviderSettingsFromJson(grokPresetJson, [], { deploymentConfig: true })
    expect(imported.profiles.map((profile) => profile.provider)).toEqual(['openai', 'grok', 'openai'])
    expect(imported.profiles.every((profile) => profile.apiKey === '')).toBe(true)
    expect(imported.agent).toMatchObject({ apiConfigMode: 'hybrid', imageProfileId: 'grok-images' })
    const restored = normalizeSettings(JSON.parse(JSON.stringify(settings())))
    expect(getActiveApiProfile(restored)).toMatchObject({ provider: 'grok', model: 'grok-imagine-image' })
  })

  it('ignores stale Codex flags in the legacy settings mirror for Grok', () => {
    expect(getActiveApiProfile({ ...settings(), codexCli: true }).codexCli).toBe(false)
  })

  it('can be selected as the image configuration in Agent hybrid mode', () => {
    const value = normalizeSettings({ ...settings(), agentApiConfigMode: 'hybrid', agentImageProfileId: 'grok-test' })
    expect(getAgentImageApiProfile(value)?.provider).toBe('grok')
  })

  it('normalizes native geometry and removes unsupported generation options', () => {
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max', transparent_output: true, output_compression: 60, resolution: '2k', aspect_ratio: '16:9' } as typeof DEFAULT_PARAMS, settings())
    expect(params).toMatchObject({ resolution: '2k', aspect_ratio: '16:9', quality: 'auto', transparent_output: false, output_compression: null })
  })

  it.each([NaN, Infinity, -1, 1.7])('normalizes invalid output count %s before dispatch', (n) => {
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, n }, settings())
    expect(Number.isInteger(params.n)).toBe(true)
    expect(params.n).toBeGreaterThanOrEqual(1)
    expect(params.n).toBeLessThanOrEqual(10)
  })

  it('sends only Grok fields and preserves PNG results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: PNG }] })))
    const result = await callImageApi({ settings: settings(), prompt: 'a cat', params: { ...DEFAULT_PARAMS, quality: 'high', resolution: '2k', aspect_ratio: '16:9' } as typeof DEFAULT_PARAMS, inputImageDataUrls: [] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://relay.example/v1/images/generations')
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'grok-imagine-image', prompt: 'a cat', n: 1, response_format: 'b64_json', resolution: '2k', aspect_ratio: '16:9' })
    expect(result.images).toEqual([`data:image/png;base64,${PNG}`])
  })

  it.each([false, true])('sends 2.0 quality and omits automatic aspect ratio for edit=%s', async (edit) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: JPEG }] })))
    const value = settings()
    value.profiles[0].model = 'grok-imagine-image-2.0'
    value.model = 'grok-imagine-image-2.0'
    await callImageApi({ settings: value, prompt: 'a cup', params: { ...DEFAULT_PARAMS, quality: 'medium', aspect_ratio: 'auto' }, inputImageDataUrls: edit ? [`data:image/jpeg;base64,${JPEG}`] : [] })
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(String(url)).toContain(edit ? 'images/edits' : 'images/generations')
    expect(body.quality).toBe('medium')
    expect(body).not.toHaveProperty('aspect_ratio')
    expect(body).not.toHaveProperty('output_format')
    expect(body).not.toHaveProperty('size')
  })

  it('preserves the legacy quality model ID without sending a quality selector', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: JPEG }] })))
    const value = settings()
    value.profiles[0].model = 'grok-imagine-image-quality'
    value.model = 'grok-imagine-image-quality'
    await callImageApi({ settings: value, prompt: 'cup', params: { ...DEFAULT_PARAMS, quality: 'medium', aspect_ratio: '21:9' }, inputImageDataUrls: [] })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: 'grok-imagine-image-quality', aspect_ratio: '1:1' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty('quality')
  })

  it('uses JSON image references for edits without dropping any of the three images', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: JPEG }] })))
    const images = [1, 2, 3].map(() => `data:image/png;base64,${PNG}`)
    const result = await callImageApi({ settings: settings(), prompt: 'edit', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: images })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://relay.example/v1/images/edits')
    expect(JSON.parse(String(init?.body)).images).toEqual(images)
    expect(result.images).toEqual([`data:image/jpeg;base64,${JPEG}`])
    expect(result.actualParamsList?.[0]?.output_format).toBe('jpeg')
  })

  it('rejects more than three references before issuing a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
    await expect(callImageApi({ settings: settings(), prompt: 'edit', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: Array(4).fill(`data:image/png;base64,${PNG}`) })).rejects.toThrow('3 张')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a saved mask before issuing a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
    await expect(callImageApi({ settings: settings(), prompt: 'edit', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [`data:image/png;base64,${PNG}`], maskDataUrl: `data:image/png;base64,${PNG}` })).rejects.toThrow('遮罩')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['gpt-image-2', 'grok-imagine-video'])('rejects a non-image model %s before issuing a request', async (model) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
    const value = settings()
    value.profiles[0].model = model
    value.model = model
    await expect(callImageApi({ settings: value, prompt: 'cat', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })).rejects.toThrow('模型')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps valid images when another single-image response is malformed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: PNG }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'invalid' }] })))
    const result = await callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageDataUrls: [] })
    expect(result.images).toHaveLength(1)
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: expect.stringContaining('图片') }])
  })

  it('keeps successes when one of the independent image requests fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: PNG }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }))
    const result = await callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageDataUrls: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).n === 1)).toBe(true)
    expect(result.images).toHaveLength(1)
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: expect.stringContaining('rate limited') }])
  })

  it.each([401, 403, 429, 500])('returns an HTTP %s error without retrying the generation', async (status) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: `failure ${status}` } }), { status }))
    await expect(callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })).rejects.toThrow(`failure ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })


  it('defaults empty models and invalid geometry without applying GPT geometry', () => {
    const profile = normalizeSettings({ profiles: [{ ...settings().profiles[0], model: '' }] }).profiles[0]
    expect(profile.model).toBe(GROK_IMAGE_MODELS.join(', '))
    const params = normalizeParamsForSettings({ ...DEFAULT_PARAMS, resolution: '4k', aspect_ratio: 'invalid' } as unknown as typeof DEFAULT_PARAMS, settings())
    expect(params).toMatchObject({ resolution: '1k', aspect_ratio: '1:1', size: 'auto' })
  })

  it('does not forward a Grok group key when switching back to OpenAI', () => {
    const profile = switchApiProfileProvider(settings().profiles[0], 'openai')
    expect(profile.apiKey).toBe('')
  })

  it('enforces safe settings in provider drafts imported from external files', () => {
    const profile = normalizeSettings({ profiles: [{ ...settings().profiles[0], providerDrafts: { grok: { codexCli: true, apiMode: 'responses', streamImages: true, transparentBackgroundMethod: 'api' } } }] }).profiles[0]
    expect(profile.providerDrafts?.grok).toMatchObject({ codexCli: false, apiMode: 'images', streamImages: false, transparentBackgroundMethod: 'local' })
  })

  it('resolves a returned image URL without sending the API key to image storage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://images.example/result.jpg' }] })))
      .mockResolvedValueOnce(new Response(Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]), { headers: { 'Content-Type': 'application/octet-stream' } }))
    const result = await callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })
    expect(result.images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(result.rawImageUrls).toEqual(['https://images.example/result.jpg'])
    expect(fetchMock.mock.calls[1][1]?.headers).toBeUndefined()
  })

  it('recognizes WebP returned as base64 despite the PNG request placeholder', () => {
    const result = normalizeGrokImageResult({ images: ['data:image/png;base64,UklGRiIAAABXRUJQ'] })
    expect(result.images[0]).toContain('data:image/webp;')
    expect(result.actualParamsList?.[0]?.output_format).toBe('webp')
  })

  it('rejects non-image base64 instead of saving a corrupt PNG', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'aW52YWxpZA==' }] })))
    await expect(callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })).rejects.toThrow('图片')
  })

  it('does not submit the first batch when the task has already been cancelled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
    await expect(callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS, n: 4 }, inputImageDataUrls: [], isCancelled: () => true })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([1, 2, 4, 5, 10])('dispatches %s single-image requests with concurrency capped at ten', async (n) => {
    let active = 0
    let maxActive = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }))
    })
    const result = await callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS, n }, inputImageDataUrls: [] })
    expect(fetchMock).toHaveBeenCalledTimes(n)
    expect(maxActive).toBe(Math.min(n, 10))
    expect(result.images).toHaveLength(n)
    expect(fetchMock.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).n === 1)).toBe(true)
  })

  it('rejects an empty prompt before dispatch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected fetch'))
    await expect(callImageApi({ settings: settings(), prompt: ' ', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })).rejects.toThrow('提示词')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty result instead of creating a completed image task', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [] })))
    await expect(callImageApi({ settings: settings(), prompt: 'cat', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [] })).rejects.toThrow('图片')
  })
})
