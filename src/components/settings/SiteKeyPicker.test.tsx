// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import { setSiteConnection } from '../../lib/siteProfiles'
import { fetchSiteKeys, type SiteKey, type SiteKeyPage } from '../../lib/siteKeys'
import SiteKeyPicker from './SiteKeyPicker'

vi.mock('../../lib/siteMode', () => ({ IS_SITE_MODE: true }))
vi.mock('../../lib/siteKeys', async (original) => ({ ...await original<typeof import('../../lib/siteKeys')>(), fetchSiteKeys: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const fetchMock = vi.mocked(fetchSiteKeys)
const profile = createDefaultOpenAIProfile({ id: 'gallery', apiKey: '', baseUrl: `${window.location.origin}/v1` })
const key: SiteKey = { id: 1, name: '我的生图密钥', key: 'fixture-personal-alpha', groupName: 'Codex 余额', platform: 'openai', status: 'active', expiresAt: null, quota: 0, quotaUsed: 0 }
const page: SiteKeyPage = { items: [key], page: 1, pages: 1 }
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  window.localStorage.setItem('auth_token', 'fixture-session-a')
  setSiteConnection(profile)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  window.localStorage.clear()
  setSiteConnection()
  fetchMock.mockReset()
})

/** 挂载真实选择器，使用受控配置验证类型筛选、密钥填入及名称展示。 */
function renderPicker(provider: ApiProfile['provider'] = 'openai') {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const select = vi.fn()
  /** 模拟画廊或 Agent 编辑入口保存用户明确选择的 Key。 */
  function Harness({ id, provider }: { id: string; provider: ApiProfile['provider'] }) {
    const [apiKey, setApiKey] = useState('')
    return <SiteKeyPicker profile={{ ...profile, id, provider, apiKey }} onSelect={(value) => { select(value); setApiKey(value) }} />
  }
  /** 在同一实例中切换配置或生图类型，验证请求取消及候选隔离。 */
  const render = (id = profile.id, nextProvider = provider) => act(() => root!.render(<Harness id={id} provider={nextProvider} />))
  render()
  return { container, select, render }
}

describe('按名称选择主站个人密钥', () => {
  it('点击才读取，以名称和分组展示，选择后填入 Key 并显示名称', async () => {
    fetchMock.mockResolvedValue(page)
    const p = renderPicker()
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('我的生图密钥')
    expect(p.container.textContent).toContain('Codex 余额 · 可用 · …lpha')
    expect(p.container.innerHTML).not.toContain(key.key)
    expect(p.container.innerHTML).not.toContain('fixture-session-a')
    act(() => p.container.querySelector<HTMLButtonElement>('li button')!.click())
    expect(p.select).toHaveBeenCalledWith(key.key)
    expect(p.container.textContent).toContain('已选择：我的生图密钥')
    expect(p.container.querySelector('ul')).toBeNull()
    expect(window.localStorage.length).toBe(1)
  })

  it.each([
    { status: 'inactive' }, { status: 'expired' }, { expiresAt: 1 },
    { status: 'quota_exhausted' }, { quota: 2, quotaUsed: 2 }, { status: 'unknown' },
    { key: 'fixture-***masked' }, { key: '' }, { platform: 'grok' }, { platform: 'anthropic' },
  ])('隐藏不可选密钥，保留可用项：%j', async (patch) => {
    fetchMock.mockResolvedValue({ ...page, items: [key, { ...key, ...patch, id: 2, name: '不可选密钥' }] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.querySelectorAll('li button')).toHaveLength(1)
    expect(p.container.querySelector('li button')?.textContent).toContain(key.name)
    expect(p.container.textContent).not.toContain('不可选密钥')
    expect(p.select).not.toHaveBeenCalled()
  })

  it.each(['openai', 'grok'] as const)('仅展示当前类型及原有兼容分组的可用密钥：%s', async (provider) => {
    fetchMock.mockResolvedValue({ ...page, items: [
      { ...key, name: 'ChatGPT 密钥' },
      { ...key, id: 2, name: 'Grok 密钥', platform: 'grok' },
      { ...key, id: 3, name: '混合分组密钥', platform: 'composite' },
      { ...key, id: 4, name: '未标记平台密钥', platform: '' },
    ] })
    const p = renderPicker(provider)
    await act(async () => p.container.querySelector('button')!.click())
    const list = p.container.querySelector('ul')!
    expect(list.querySelectorAll('li')).toHaveLength(3)
    expect(list.textContent).toContain(provider === 'openai' ? 'ChatGPT 密钥' : 'Grok 密钥')
    expect(list.textContent).not.toContain(provider === 'openai' ? 'Grok 密钥' : 'ChatGPT 密钥')
    expect(list.textContent).toContain('混合分组密钥')
    expect(list.textContent).toContain('未标记平台密钥')
    expect(p.select).not.toHaveBeenCalled()
  })

  it.each(['openai', 'grok'] as const)('本页没有匹配项时提示当前类型，仍可翻页选择：%s', async (provider) => {
    fetchMock.mockResolvedValueOnce({ ...page, pages: 2, items: [{ ...key, status: 'inactive' }] })
      .mockResolvedValueOnce({ ...page, page: 2, pages: 2, items: [{ ...key, platform: provider, name: '第二页可用密钥' }] })
    const p = renderPicker(provider)
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.querySelectorAll('li')).toHaveLength(0)
    expect(p.container.textContent).toContain(`本页暂无可用的 ${provider === 'openai' ? 'ChatGPT' : 'Grok'} 密钥，请翻页查看`)
    const next = Array.from(p.container.querySelectorAll('button')).find((button) => button.textContent === '下一页密钥')!
    expect(next.disabled).toBe(false)
    await act(async () => next.click())
    expect(fetchMock.mock.calls[1][1]).toBe(2)
    act(() => p.container.querySelector<HTMLButtonElement>('li button')!.click())
    expect(p.select).toHaveBeenCalledWith(key.key)
  })

  it('单页密钥全部不可用时提示当前类型，不误报没有个人密钥', async () => {
    fetchMock.mockResolvedValue({ ...page, items: [{ ...key, platform: 'grok' }] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('暂无可用的 ChatGPT 密钥')
    expect(p.container.textContent).not.toContain('暂无个人密钥')
    expect(p.container.querySelectorAll('li')).toHaveLength(0)
    expect(p.select).not.toHaveBeenCalled()
  })

  it('切换生图类型丢弃旧候选，重新获取后只显示新类型的可选密钥', async () => {
    const grokKey = { ...key, id: 2, platform: 'grok', name: 'Grok 专用密钥', key: 'fixture-grok-beta' }
    fetchMock.mockResolvedValue({ ...page, items: [key, grokKey] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.querySelector('li')?.textContent).toContain(key.name)
    p.render(profile.id, 'grok')
    expect(p.container.querySelector('ul')).toBeNull()
    await act(async () => p.container.querySelector('button')!.click())
    expect(fetchMock.mock.calls[1][0].provider).toBe('grok')
    expect(p.container.querySelectorAll('li')).toHaveLength(1)
    expect(p.container.querySelector('li')?.textContent).toContain(grokKey.name)
    act(() => p.container.querySelector<HTMLButtonElement>('li button')!.click())
    expect(p.select).toHaveBeenCalledWith(grokKey.key)
  })

  it('读取失败与空列表给出提示，原配置不受影响', async () => {
    fetchMock.mockRejectedValueOnce(new Error('主站登录已失效')).mockResolvedValueOnce({ ...page, items: [] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('主站登录已失效')
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('暂无个人密钥')
    expect(p.select).not.toHaveBeenCalled()
  })

  it('分页查询对应页，不自动选择或创建密钥', async () => {
    fetchMock.mockResolvedValueOnce({ ...page, pages: 2 }).mockResolvedValueOnce({ ...page, page: 2, pages: 2, items: [{ ...key, name: '第二页密钥' }] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    const next = Array.from(p.container.querySelectorAll('button')).find((button) => button.textContent === '下一页密钥')!
    await act(async () => next.click())
    expect(fetchMock.mock.calls[1][1]).toBe(2)
    expect(p.container.textContent).toContain('第二页密钥')
    expect(p.select).not.toHaveBeenCalled()
  })

  it('账号变化后清除旧列表，迟到响应不能显示', async () => {
    let finish!: (data: SiteKeyPage) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const p = renderPicker()
    act(() => p.container.querySelector('button')!.click())
    const signal = fetchMock.mock.calls[0][2]!
    act(() => {
      window.localStorage.setItem('auth_token', 'fixture-session-b')
      window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token' }))
    })
    expect(signal.aborted).toBe(true)
    await act(async () => finish(page))
    expect(p.container.textContent).not.toContain('我的生图密钥')
    expect(p.select).not.toHaveBeenCalled()
  })

  it('选择瞬间再核对会话，未收到存储事件也不能选旧账号密钥', async () => {
    fetchMock.mockResolvedValue(page)
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    window.localStorage.removeItem('auth_token')
    act(() => p.container.querySelector<HTMLButtonElement>('li button')!.click())
    expect(p.select).not.toHaveBeenCalled()
    expect(p.container.querySelector('ul')).toBeNull()
  })

  it('配置切换或卸载取消旧查询', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const p = renderPicker()
    act(() => p.container.querySelector('button')!.click())
    const firstSignal = fetchMock.mock.calls[0][2]!
    p.render('agent-text')
    expect(firstSignal.aborted).toBe(true)
    act(() => p.container.querySelector('button')!.click())
    const secondSignal = fetchMock.mock.calls[1][2]!
    act(() => root!.unmount())
    root = null
    expect(secondSignal.aborted).toBe(true)
  })
})
