import type { ApiProfile } from '../types'
import { getSiteConnection, getSiteProfileError } from './siteProfiles'
import { IS_SITE_MODE } from './siteMode'

export interface SiteKey {
  id: number
  name: string
  key: string
  groupName: string
  platform: string
  status: string
  expiresAt: number | null
  quota: number
  quotaUsed: number
}

export interface SiteKeyPage {
  items: SiteKey[]
  page: number
  pages: number
}

/** 只读取同源主站已有的登录凭据，不从 URL、用户编号或生成 Key 推导登录身份。 */
export function readSiteSessionToken(): string {
  if (!IS_SITE_MODE || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem('auth_token')?.trim() ?? ''
  } catch {
    return ''
  }
}

/** 校验本站及同源连接；登录凭据只能发送到当前主站，不能跟随用户配置的 API 地址。 */
export function getSiteKeyAccessError(profile: ApiProfile): string | null {
  if (!IS_SITE_MODE || !['openai', 'grok'].includes(profile.provider)) return '当前配置不支持读取本站密钥'
  const error = getSiteProfileError(profile)
  if (error) return error
  try {
    if (new URL(getSiteConnection().baseUrl).origin !== window.location.origin) return '请从主站的在线生图入口打开工作台，以复用登录'
  } catch {
    return '本站连接尚未配置，无法读取个人密钥'
  }
  return null
}

/** 返回当前不可选的原因；状态、到期时间、额度和明确的分组平台都参与校验。 */
export function getSiteKeyUnavailableReason(item: SiteKey, provider: string): string | null {
  if (item.status === 'inactive') return '已禁用'
  if (item.status === 'expired' || item.expiresAt !== null && item.expiresAt <= Date.now()) return '已过期'
  if (item.status === 'quota_exhausted' || item.quota > 0 && item.quotaUsed >= item.quota) return '额度已用尽'
  if (item.status !== 'active') return '状态不可用'
  if (!item.key || /[*•…]/.test(item.key)) return '密钥不可完整读取'
  if (item.platform && item.platform !== 'composite' && item.platform !== provider) return '分组不匹配'
  return null
}

/** 按主站认证身份分页读取本人密钥；不传用户编号、不创建密钥，失败时不回显响应内容。 */
export async function fetchSiteKeys(profile: ApiProfile, page = 1, signal?: AbortSignal): Promise<SiteKeyPage> {
  const error = getSiteKeyAccessError(profile)
  if (error) throw new Error(error)
  const token = readSiteSessionToken()
  if (!token) throw new Error('请先登录主站，再获取个人密钥')
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('密钥列表页码无效')
  if (signal?.aborted) throw new DOMException('密钥查询已取消', 'AbortError')
  const controller = new AbortController()
  /** 将卸载或配置切换传递给请求，避免旧结果覆盖当前账号。 */
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 15000)
  try {
    let response: Response
    try {
      response = await fetch(`/api/v1/keys?page=${page}&page_size=20`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      })
    } catch {
      throw new Error('无法读取个人密钥，请检查主站连接后重试')
    }
    if (response.status === 401) throw new Error('主站登录已失效，请重新登录后获取密钥')
    if (response.status === 403) throw new Error('没有读取个人密钥的权限')
    if (!response.ok) throw new Error(`读取个人密钥失败（HTTP ${response.status}）`)
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || !('code' in body) || body.code !== 0 || !('data' in body)
      || !body.data || typeof body.data !== 'object' || !('items' in body.data) || !Array.isArray(body.data.items)
      || !('pages' in body.data) || typeof body.data.pages !== 'number' || !Number.isSafeInteger(body.data.pages) || body.data.pages < 0) {
      throw new Error('个人密钥列表格式异常，请在主站查看密钥')
    }
    if (token !== readSiteSessionToken()) throw new Error('主站登录已变化，请重新获取密钥')
    const items: SiteKey[] = body.data.items.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('个人密钥列表格式异常')
      const item = value as Record<string, unknown>
      if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1
        || typeof item.name !== 'string' || typeof item.key !== 'string' || typeof item.status !== 'string'
        || typeof item.quota !== 'number' || !Number.isFinite(item.quota) || item.quota < 0
        || typeof item.quota_used !== 'number' || !Number.isFinite(item.quota_used) || item.quota_used < 0
        || item.expires_at !== null && (typeof item.expires_at !== 'string' || !Number.isFinite(Date.parse(item.expires_at)))) {
        throw new Error('个人密钥列表格式异常')
      }
      const group = item.group && typeof item.group === 'object' ? item.group as Record<string, unknown> : null
      return {
        id: item.id, name: item.name.trim() || '未命名密钥', key: item.key.trim(), status: item.status,
        groupName: typeof group?.name === 'string' ? group.name : '未绑定分组',
        platform: typeof group?.platform === 'string' ? group.platform : '',
        expiresAt: item.expires_at === null ? null : Date.parse(item.expires_at as string),
        quota: item.quota, quotaUsed: item.quota_used,
      }
    })
    if (controller.signal.aborted) throw new DOMException('密钥查询已取消', 'AbortError')
    return { items, page, pages: body.data.pages }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('密钥查询已取消', 'AbortError')
    if (controller.signal.aborted) throw new Error('密钥查询超时，请重试')
    // 网络与 JSON 解析错误不回显底层内容，避免泄露主站登录凭据。
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('无法读取个人密钥，请检查主站连接后重试')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
