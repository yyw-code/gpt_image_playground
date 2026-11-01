import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { fetchApiModels } from './apiModels'
import { setSiteConnection } from './siteProfiles'

const mocks = vi.hoisted(() => ({ siteMode: { IS_SITE_MODE: false } }))
vi.mock('./siteMode', () => mocks.siteMode)
vi.mock('./platform', () => ({ isTauri: false, apiFetch: (url: string, init: RequestInit) => fetch(url, init) }))

const profile = createDefaultOpenAIProfile({ id: 'test', baseUrl: 'https://site.example/v1', apiKey: 'fixture-key' })
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
  vi.stubEnv('VITE_API_PROXY_LOCKED', 'false')
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  mocks.siteMode.IS_SITE_MODE = false
  setSiteConnection()
})

describe('个人 Key 模型查询', () => {
  it('只通过鉴权 GET 获取模型，去重清洗 ID，不传登录信息或发送生成请求', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: ' text-a ' }, { id: 'image-b' }, { id: 'text-a' }, null, { id: 12 }, { id: ' ' }] })))
    await expect(fetchApiModels(profile)).resolves.toEqual(['text-a', 'image-b'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://site.example/v1/models', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer fixture-key' }, credentials: 'omit', cache: 'no-store', redirect: 'error',
    }))
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('沿用实际代理路径，包括允许隐藏 API 地址的代理配置', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    fetchMock.mockResolvedValue(new Response('{"data":[]}'))
    await expect(fetchApiModels({ ...profile, apiProxy: true, baseUrl: '' })).resolves.toEqual([])
    expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/models')
  })

  it('强制代理沿用部署端策略，不因用户配置为 false 而绕过', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    fetchMock.mockResolvedValue(new Response('{"data":[]}'))
    await fetchApiModels({ ...profile, apiProxy: false })
    expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/models')
  })

  it.each([
    { ...profile, apiKey: '' },
    { ...profile, baseUrl: '' },
    { ...profile, provider: 'fal' },
  ])('缺少必要配置或供应商不匹配时，不发送请求', async (invalid) => {
    await expect(fetchApiModels(invalid)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('站点模式拒绝外站配置和缺少部署连接，防止向旧供应商发送 Key', async () => {
    mocks.siteMode.IS_SITE_MODE = true
    setSiteConnection(profile)
    await expect(fetchApiModels({ ...profile, baseUrl: 'https://foreign.example/v1' })).rejects.toThrow('不属于本站')
    setSiteConnection({ ...profile, baseUrl: '' })
    await expect(fetchApiModels(profile)).rejects.toThrow('尚未配置')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 429, 500])('HTTP %s 显示固定错误，不回显可能含有敏感信息的响应体', async (status) => {
    fetchMock.mockResolvedValue(new Response('fixture-sensitive-debug-value', { status }))
    const pending = fetchApiModels(profile)
    await expect(pending).rejects.toThrow(/Key|拒绝|未找到|频繁|HTTP 500/)
    await expect(pending).rejects.not.toThrow('fixture-sensitive-debug-value')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([null, [], {}, { data: {} }, { data: [{ id: false }] }])('异常外部数据 %j 不作为有效模型列表', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)))
    await expect(fetchApiModels(profile)).rejects.toThrow(/格式异常|有效模型 ID/)
  })

  it('HTML 或其他非 JSON 响应提供地址错误说明', async () => {
    fetchMock.mockResolvedValue(new Response('<html>SPA fallback</html>'))
    await expect(fetchApiModels(profile)).rejects.toThrow('未返回有效 JSON')
  })

  it('网络异常使用固定说明，不输出底层请求地址或鉴权内容', async () => {
    fetchMock.mockRejectedValue(new Error('fixture-sensitive-debug-value'))
    await expect(fetchApiModels(profile)).rejects.toThrow('请检查网络、跨域或 API 代理配置')
  })

  it('已取消的查询不发送请求', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchApiModels(profile, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('配置切换可取消实际请求，并清理超时定时器', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')))
    }))
    const controller = new AbortController()
    const pending = fetchApiModels(profile, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('十五秒超时取消连接，允许用户重新获取', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')))
    }))
    const assertion = expect(fetchApiModels(profile)).rejects.toThrow('模型查询超时')
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
