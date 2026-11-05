import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), image: vi.fn().mockResolvedValue({ images: ['data:image/png;base64,iVBORw0KGgo='] }) }))
vi.mock('./platform', () => ({ isTauri: false, apiFetch: mocks.fetch }))
vi.mock('./openaiCompatibleImageApi', () => ({ callOpenAICompatibleImageApi: mocks.image }))
vi.mock('./falAiImageApi', () => ({ callFalAiImageApi: mocks.image }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('本站请求边界', () => {
  it('画廊、Agent、标题和批量图片均在请求前拒绝外站历史配置', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const { setPresetConfig } = await import('./presetConfig')
    const site = createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1' })
    setPresetConfig({ customProviders: [], profiles: [site] })
    const profile = { ...site, baseUrl: 'https://foreign.example/v1', apiKey: 'foreign-key' }
    const settings = normalizeSettings({ profiles: [profile] })
    const { callImageApi } = await import('./api')
    const agent = await import('./agentApi')
    await expect(callImageApi({ settings, prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('不属于本站')
    await expect(agent.callAgentResponsesApi({ settings, profile, params: DEFAULT_PARAMS, input: 'test' })).rejects.toThrow('不属于本站')
    await expect(agent.callAgentConversationTitleApi({ settings, profile, prompt: 'test' })).rejects.toThrow('不属于本站')
    await expect(agent.callBatchImageSingle({ profile, params: DEFAULT_PARAMS, batchItemId: 'test', prompt: 'test', referenceImageDataUrls: [] })).rejects.toThrow('不属于本站')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('本站 Grok 通过站点检查后仍使用专属协议，外站 Grok 在发请求前被拒绝', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    const p = await import('./apiProfiles')
    const { setPresetConfig } = await import('./presetConfig')
    const site = p.createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1' })
    setPresetConfig({ customProviders: [], profiles: [site] })
    const settings = p.normalizeSettings({ profiles: [{ ...site, id: 'grok', provider: 'grok', model: 'grok-imagine-image', apiKey: 'grok-key' }] })
    const { callImageApi } = await import('./api')
    await callImageApi({ settings, prompt: 'cat', params: { ...DEFAULT_PARAMS, resolution: '2k', aspect_ratio: '16:9' }, inputImageDataUrls: [] })
    expect(mocks.image).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ resolution: '2k', aspect_ratio: '16:9' }) }),
      expect.objectContaining({ provider: 'grok', apiKey: 'grok-key' }),
      expect.objectContaining({ submit: expect.objectContaining({ path: 'images/generations' }) }),
    )
    const foreign = p.normalizeSettings({ profiles: [{ ...settings.profiles[0], baseUrl: 'https://foreign.example/v1' }] })
    await expect(callImageApi({ settings: foreign, prompt: 'cat', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('不属于本站')
    expect(mocks.image).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('新建本站配置仍能进入原有图像请求路径', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const { setPresetConfig } = await import('./presetConfig')
    const site = createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1' })
    setPresetConfig({ customProviders: [], profiles: [site] })
    const profile = { ...site, id: 'own-copy', apiKey: 'own-key' }
    const settings = normalizeSettings({ profiles: [profile] })
    const { callImageApi } = await import('./api')
    const result = await callImageApi({ settings, prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(mocks.image).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'own-copy', baseUrl: site.baseUrl }), null)
    expect(result.actualParams).toMatchObject({ n: 1, output_format: 'png' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
