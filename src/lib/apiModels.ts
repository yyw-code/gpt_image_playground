import type { ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { apiFetch } from './platform'
import { getSiteProfileError } from './siteProfiles'

/** 使用当前配置的个人 Key 查询模型；只返回模型 ID，不推断接口或工具能力，不记录密钥。 */
export async function fetchApiModels(profile: ApiProfile, signal?: AbortSignal): Promise<string[]> {
  const siteError = getSiteProfileError(profile)
  if (siteError) throw new Error(siteError)
  if (profile.provider !== 'openai') throw new Error('当前供应商不支持此模型查询')
  if (!profile.apiKey.trim()) throw new Error('请先填写个人 API Key')
  if (signal?.aborted) throw new DOMException('模型查询已取消', 'AbortError')

  const proxy = readClientDevProxyConfig()
  const useProxy = shouldUseApiProxy(profile.apiProxy, proxy)
  if (!profile.baseUrl.trim() && !useProxy) throw new Error('请先配置 API 地址')
  const controller = new AbortController()
  let timedOut = false
  /** 将配置切换或组件卸载的取消信号传递给实际请求。 */
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 15000)

  try {
    let response: Response
    try {
      response = await apiFetch(buildApiUrl(profile.baseUrl, 'models', proxy, useProxy), {
        method: 'GET',
        headers: { Authorization: `Bearer ${profile.apiKey.trim()}` },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      if (timedOut) throw new Error('模型查询超时，请重试')
      if (controller.signal.aborted) throw new DOMException('模型查询已取消', 'AbortError')
      throw new Error('无法获取模型，请检查网络、跨域或 API 代理配置')
    }

    if (timedOut) throw new Error('模型查询超时，请重试')
    if (controller.signal.aborted) throw new DOMException('模型查询已取消', 'AbortError')

    // 不展示原始错误响应，避免网关返回的调试信息包含个人密钥或请求头。
    if (response.status === 401) throw new Error('API Key 无效或已过期，请检查当前配置')
    if (response.status === 403) throw new Error('模型查询被拒绝，请检查密钥权限及代理是否允许 GET')
    if (response.status === 404) throw new Error('未找到模型查询接口，请检查 API 地址及代理目标')
    if (response.status === 429) throw new Error('模型查询过于频繁，请稍后重试')
    if (!response.ok) throw new Error(`模型查询失败（HTTP ${response.status}）`)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      if (timedOut) throw new Error('模型查询超时，请重试')
      if (controller.signal.aborted) throw new DOMException('模型查询已取消', 'AbortError')
      throw new Error('模型接口未返回有效 JSON，请检查 API 地址')
    }
    if (timedOut) throw new Error('模型查询超时，请重试')
    if (controller.signal.aborted) throw new DOMException('模型查询已取消', 'AbortError')
    if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
      throw new Error('模型列表格式异常，仍可手动填写模型 ID')
    }
    const models = [...new Set(body.data.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') return []
      const id = item.id.trim()
      return id ? [id] : []
    }))]
    if (body.data.length > 0 && models.length === 0) throw new Error('模型列表缺少有效模型 ID，仍可手动填写')
    return models
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
