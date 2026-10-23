// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  siteMode: { IS_SITE_MODE: true },
}))

vi.mock('../lib/platform', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../lib/siteMode', () => mocks.siteMode)
vi.mock('../lib/localRecord', () => ({ readLocal: () => null, writeLocal: vi.fn() }))

import { checkForUpdates, loadOlderReleases, setUpdateModalOpen, useAutoUpdateCheck, useReleaseUpdates } from './useReleaseUpdates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  mocks.apiFetch.mockReset()
  mocks.siteMode.IS_SITE_MODE = true
  useReleaseUpdates.setState({ modalOpen: false })
})

describe('站点停用上游更新', () => {
  it('旧设置启用自动检查时仍不请求上游，也不接受手动打开弹窗', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    /** 模拟从旧版本恢复了自动检查已开启的偏好。 */
    function OldSettings() {
      useAutoUpdateCheck(true)
      return null
    }
    try {
      await act(async () => root.render(<OldSettings />))
      expect(await checkForUpdates()).toBeUndefined()
      await loadOlderReleases()
      setUpdateModalOpen(true)
      expect(mocks.apiFetch).not.toHaveBeenCalled()
      expect(useReleaseUpdates.getState().modalOpen).toBe(false)
    } finally {
      act(() => root.unmount())
    }
  })

  it('关闭站点模式后仍保留手动打开更新弹窗的能力', () => {
    mocks.siteMode.IS_SITE_MODE = false
    setUpdateModalOpen(true)
    expect(useReleaseUpdates.getState().modalOpen).toBe(true)
  })
})
