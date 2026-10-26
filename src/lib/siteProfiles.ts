import type { ApiProfile } from '../types'
import { parseDefaultApiUrl } from './defaultApiUrl'
import { isImportableConfigUrl } from './importableConfigUrl'
import { readRuntimeEnv } from './runtimeEnv'
import { IS_SITE_MODE } from './siteMode'

const rawDefaultUrl = readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL, 'VITE_DEFAULT_API_URL')
const defaultConnection = {
  baseUrl: isImportableConfigUrl(rawDefaultUrl) ? '' : parseDefaultApiUrl(rawDefaultUrl).baseUrl,
  apiProxy: readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE, 'VITE_API_PROXY_AVAILABLE') === 'true',
}
let connection = defaultConnection

/** 规范化部署地址；拒绝凭据、查询参数及非 HTTP 协议，保留路径的拼接语义。 */
function connectionUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return ''
  }
}

/** 只从部署预置注册本站连接，不能使用导入备份或用户配置更新请求目标。 */
export function setSiteConnection(profile?: ApiProfile) {
  connection = profile
    ? { baseUrl: connectionUrl(profile.baseUrl), apiProxy: profile.apiProxy }
    : { ...defaultConnection, baseUrl: connectionUrl(defaultConnection.baseUrl) }
}

/** 返回部署维护的连接副本，供配置创建和只读地址展示使用。 */
export function getSiteConnection() {
  return { ...connection, baseUrl: connectionUrl(connection.baseUrl) }
}

/** 判断配置是否属于本站；旧外站配置保持原样，不能因 ID 相同而迁移其密钥。 */
export function isSiteApiProfile(profile: ApiProfile): boolean {
  const site = getSiteConnection()
  return profile.provider === 'openai' &&
    (profile.baseUrl === '' ? site.baseUrl === '' : Boolean(site.baseUrl) && connectionUrl(profile.baseUrl) === site.baseUrl) &&
    profile.apiProxy === site.apiProxy
}

/** 在请求前校验站点策略；缺少部署配置时明确失败，不回退官方接口或外站。 */
export function getSiteProfileError(profile: ApiProfile): string | null {
  if (!IS_SITE_MODE) return null
  if (!getSiteConnection().baseUrl) return '本站尚未配置 API 地址，请联系站点管理员'
  if (!isSiteApiProfile(profile)) return '此配置不属于本站，请选择 NorthByteHub 配置'
  return null
}
