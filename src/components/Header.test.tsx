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
  it('Windows 端隐藏客户端、PWA 和缓存的新版本提示，并保留桌面/移动 Agent 切换', () => {
    const container = renderHeader()
    expect(container.querySelector('[aria-label="下载客户端"]')).toBeNull()
    expect(container.querySelector('[aria-label="安装为应用"]')).toBeNull()
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
})
