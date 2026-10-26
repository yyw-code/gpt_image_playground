import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), config: vi.fn(), subscribe: vi.fn(), result: vi.fn() }))
vi.mock('./platform', () => ({ isTauri: false, apiFetch: mocks.fetch }))
vi.mock('@fal-ai/client', () => ({ fal: { config: mocks.config, queue: { subscribeToStatus: mocks.subscribe, result: mocks.result } } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('旧外站异步任务恢复', () => {
  it('自动恢复 fal 和自定义任务时也不能向外站发送旧密钥', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    const p = await import('./apiProfiles')
    const { setPresetConfig } = await import('./presetConfig')
    const site = p.createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1' })
    setPresetConfig({ customProviders: [], profiles: [site] })
    const { getFalQueuedImageResult } = await import('./falAiImageApi')
    const { getCustomQueuedImageResult } = await import('./openaiCompatibleImageApi')
    const fal = p.createDefaultFalProfile({ apiKey: 'old-fal-key' })
    await expect(getFalQueuedImageResult(fal, 'image-model', 'request-id', DEFAULT_PARAMS)).rejects.toThrow('不属于本站')
    const custom = { ...site, provider: 'sb2api-async', baseUrl: 'https://foreign.example/v1', apiKey: 'old-custom-key' }
    await expect(getCustomQueuedImageResult(custom, p.getCustomProviderDefinition(p.DEFAULT_SETTINGS, 'sb2api-async')!, 'task-id', DEFAULT_PARAMS)).rejects.toThrow('不属于本站')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.result).not.toHaveBeenCalled()
  })
})
