// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  siteMode: { IS_SITE_MODE: true },
  setAppMode: vi.fn(),
}))

vi.mock('../lib/siteMode', () => mocks.siteMode)
vi.mock('../lib/platform', () => ({ isTauri: false }))
vi.mock('../lib/announcements', () => ({ detectOs: () => 'windows' }))
vi.mock('../store', () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select({
    appMode: 'gallery', agentConversations: [], filterFavorite: false,
    setAppMode: mocks.setAppMode,
  }),
}))
vi.mock('../hooks/useReleaseUpdates', () => ({
  useReleaseUpdates: (select: (state: unknown) => unknown) => select({
    releases: [{ version: '99.0.0', tag: 'v99.0.0' }], ignoredVersion: '',
  }),
  setUpdateModalOpen: vi.fn(),
}))
vi.mock('./HelpModal', () => ({ default: () => null }))
vi.mock('./HistoryModal', () => ({ default: () => null }))
vi.mock('./FavoriteCollections', () => ({ useFavoriteCollectionTitle: () => '' }))

import Header from './Header'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  mocks.setAppMode.mockClear()
  mocks.siteMode.IS_SITE_MODE = true
})

/** 挂载真实顶栏，测试站点与上游模式的入口和导航点击。 */
function renderHeader() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Header />))
  return container
}

describe('站点顶栏', () => {
  it('显示本站品牌，隐藏安装、客户端和上游新版本提示，并保留桌面/移动 Agent 切换', () => {
    const container = renderHeader()
    expect(container.querySelector('[aria-label="下载客户端"]')).toBeNull()
    expect(container.querySelector('[aria-label="安装为应用"]')).toBeNull()
    expect(container.textContent).toContain('NorthByteHub 图片工作台')
    expect(container.querySelector('a[href*="github.com"]')).toBeNull()
    expect(container.textContent).not.toContain('NEW')
    const agentButtons = [...container.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'Agent')
    expect(agentButtons).toHaveLength(2)
    agentButtons.forEach((button) => act(() => button.click()))
    expect(mocks.setAppMode).toHaveBeenNthCalledWith(1, 'agent')
    expect(mocks.setAppMode).toHaveBeenNthCalledWith(2, 'agent')
  })

  it('关闭站点模式后保留 Windows 下载入口、PWA 和更新提示', () => {
    mocks.siteMode.IS_SITE_MODE = false
    const container = renderHeader()
    expect(container.querySelector('[aria-label="下载客户端"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="安装为应用"]')).not.toBeNull()
    expect(container.textContent).toContain('NEW')
  })

  it('站点模式收到浏览器安装事件后仍隐藏安装入口', () => {
    const container = renderHeader()
    const prompt = vi.fn()
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt })
    act(() => { window.dispatchEvent(event) })
    expect(container.querySelector('[aria-label="安装为应用"]')).toBeNull()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('非站点模式可以调用浏览器的 PWA 安装提示', async () => {
    mocks.siteMode.IS_SITE_MODE = false
    const container = renderHeader()
    const prompt = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) })
    act(() => { window.dispatchEvent(event) })
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="安装为应用"]')!.click() })
    expect(prompt).toHaveBeenCalledOnce()
    expect(container.querySelector('[aria-label="安装为应用"]')).toBeNull()
  })
})
