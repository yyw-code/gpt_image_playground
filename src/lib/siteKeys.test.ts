// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from './apiProfiles'
import { setSiteConnection } from './siteProfiles'
import { fetchSiteKeys, getSiteKeyAccessError, getSiteKeyUnavailableReason, readSiteSessionToken } from './siteKeys'

vi.mock('./siteMode', () => ({ IS_SITE_MODE: true }))
const profile = createDefaultOpenAIProfile({ baseUrl: `${window.location.origin}/v1`, apiKey: 'fixture-generation-key' })
const fetchMock = vi.fn<typeof fetch>()
const rawKey = {
  id: 1, user_id: 2, name: '日常生图', key: 'fixture-personal-alpha', status: 'active',
  quota: 0, quota_used: 0, expires_at: null, group: { name: 'Codex 余额', platform: 'openai' },
}

/** 创建隔离的 Sub2API 分页响应，不连接主站。 */
function response(items: unknown[] = [rawKey], pages = 1) {
  return new Response(JSON.stringify({ code: 0, data: { items, pages } }))
}

beforeEach(() => {
  window.localStorage.setItem('auth_token', 'fixture-session-a')
  setSiteConnection(profile)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  window.localStorage.clear()
  setSiteConnection()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('主站本人密钥查询', () => {
  it('使用登录凭据读取同源本人列表，返回名称和分组，不传用户编号或生成密钥', async () => {
    fetchMock.mockResolvedValue(response())
    const result = await fetchSiteKeys(profile)
    expect(result).toMatchObject({ page: 1, pages: 1, items: [{ id: 1, name: '日常生图', key: rawKey.key, groupName: 'Codex 余额', platform: 'openai', expiresAt: null }] })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/keys?page=1&page_size=20', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer fixture-session-a' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    }))
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('fixture-generation-key')
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('支持分页、空列表和空名称回退', async () => {
    fetchMock.mockResolvedValueOnce(response([{ ...rawKey, name: ' ' }], 3)).mockResolvedValueOnce(response([], 0))
    expect((await fetchSiteKeys(profile, 2)).items[0].name).toBe('未命名密钥')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/keys?page=2&page_size=20')
    await expect(fetchSiteKeys(profile)).resolves.toEqual({ page: 1, pages: 0, items: [] })
  })

  it('未登录、无效页码或预先取消时不发送请求', async () => {
    window.localStorage.removeItem('auth_token')
    expect(readSiteSessionToken()).toBe('')
    await expect(fetchSiteKeys(profile)).rejects.toThrow('请先登录')
    window.localStorage.setItem('auth_token', 'fixture-session-a')
    await expect(fetchSiteKeys(profile, 0)).rejects.toThrow('页码')
    await expect(fetchSiteKeys(profile, 1.5)).rejects.toThrow('页码')
    await expect(fetchSiteKeys(profile, 1, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('拒绝外站配置和不同源主站，不把登录凭据发送给配置地址', async () => {
    await expect(fetchSiteKeys({ ...profile, baseUrl: 'https://foreign.example/v1' })).rejects.toThrow('不属于本站')
    const foreign = { ...profile, baseUrl: 'https://foreign.example/v1' }
    setSiteConnection(foreign)
    expect(getSiteKeyAccessError(foreign)).toContain('主站')
    await expect(fetchSiteKeys(foreign)).rejects.toThrow('主站')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 429, 500])('HTTP %s 不回显响应中的敏感信息', async (status) => {
    fetchMock.mockResolvedValue(new Response('fixture-sensitive-debug', { status }))
    const pending = fetchSiteKeys(profile)
    await expect(pending).rejects.toThrow(/登录|权限|HTTP/)
    await expect(pending).rejects.not.toThrow('fixture-sensitive-debug')
  })

  it.each([null, {}, { code: 0, data: { items: [], pages: '1' } }, { code: 7, data: { items: [], pages: 0 } }])('拒绝异常列表结构 %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)))
    await expect(fetchSiteKeys(profile)).rejects.toThrow('格式异常')
  })

  it.each([
    { id: '1' }, { name: null }, { key: null }, { quota: '0' }, { quota_used: -1 }, { expires_at: 'bad-date' },
  ])('拒绝异常密钥字段 %j', async (patch) => {
    fetchMock.mockResolvedValue(response([{ ...rawKey, ...patch }]))
    await expect(fetchSiteKeys(profile)).rejects.toThrow('格式异常')
  })

  it('网络或 JSON 错误只显示固定信息', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fixture-sensitive-debug')).mockResolvedValueOnce(new Response('<html>'))
    await expect(fetchSiteKeys(profile)).rejects.toThrow('无法读取个人密钥')
    await expect(fetchSiteKeys(profile)).rejects.toThrow('无法读取个人密钥')
  })

  it('请求完成时账号已变化，不返回旧账号的密钥', async () => {
    fetchMock.mockImplementation(async () => {
      window.localStorage.setItem('auth_token', 'fixture-session-b')
      return response()
    })
    await expect(fetchSiteKeys(profile)).rejects.toThrow('登录已变化')
  })

  it('取消与超时终止请求并清理定时器', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')))
    }))
    const controller = new AbortController()
    const cancelled = expect(fetchSiteKeys(profile, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await cancelled
    const timedOut = expect(fetchSiteKeys(profile)).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(15000)
    await timedOut
    expect(vi.getTimerCount()).toBe(0)
  })

  it('禁用、过期、耗尽、脱敏、分组错误的密钥都不能选择', async () => {
    fetchMock.mockResolvedValue(response())
    const item = (await fetchSiteKeys(profile)).items[0]
    expect(getSiteKeyUnavailableReason(item, 'openai')).toBeNull()
    expect(getSiteKeyUnavailableReason({ ...item, status: 'inactive' }, 'openai')).toBe('已禁用')
    expect(getSiteKeyUnavailableReason({ ...item, expiresAt: Date.now() - 1 }, 'openai')).toBe('已过期')
    expect(getSiteKeyUnavailableReason({ ...item, quota: 2, quotaUsed: 2 }, 'openai')).toBe('额度已用尽')
    expect(getSiteKeyUnavailableReason({ ...item, key: 'sk-***masked' }, 'openai')).toBe('密钥不可完整读取')
    expect(getSiteKeyUnavailableReason(item, 'grok')).toBe('分组不匹配')
    expect(getSiteKeyUnavailableReason({ ...item, platform: 'composite' }, 'grok')).toBeNull()
  })
})
