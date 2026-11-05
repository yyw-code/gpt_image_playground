// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** 挂载真实选择器，使用受控配置验证填入当前配置及密钥名称的展示。 */
function renderPicker() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const select = vi.fn()
  /** 模拟画廊或 Agent 编辑入口保存用户明确选择的 Key。 */
  function Harness({ id }: { id: string }) {
    const [apiKey, setApiKey] = useState('')
    return <SiteKeyPicker profile={{ ...profile, id, apiKey }} onSelect={(value) => { select(value); setApiKey(value) }} />
  }
  /** 在同一实例中切换配置，验证请求取消及候选隔离。 */
  const render = (id = profile.id) => act(() => root!.render(<Harness id={id} />))
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

  it('禁用、过期和分组不匹配的密钥不能填入', async () => {
    fetchMock.mockResolvedValue({ ...page, items: [{ ...key, status: 'inactive' }, { ...key, id: 2, expiresAt: 1 }, { ...key, id: 3, platform: 'grok' }] })
    const p = renderPicker()
    await act(async () => p.container.querySelector('button')!.click())
    for (const button of p.container.querySelectorAll<HTMLButtonElement>('li button')) {
      expect(button.disabled).toBe(true)
      act(() => button.click())
    }
    expect(p.select).not.toHaveBeenCalled()
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
