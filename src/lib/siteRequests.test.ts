import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), image: vi.fn() }))
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

  it('新建本站配置仍能进入原有图像请求路径', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const { setPresetConfig } = await import('./presetConfig')
    const site = createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1' })
    setPresetConfig({ customProviders: [], profiles: [site] })
    const profile = { ...site, id: 'own-copy', apiKey: 'own-key' }
    const settings = normalizeSettings({ profiles: [profile] })
    const { callImageApi } = await import('./api')
    await callImageApi({ settings, prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(mocks.image).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'own-copy', baseUrl: site.baseUrl }), null)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
