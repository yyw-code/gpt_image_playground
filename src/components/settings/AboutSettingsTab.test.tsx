// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ siteMode: { IS_SITE_MODE: true } }))
vi.mock('../../lib/siteMode', () => mocks.siteMode)
vi.mock('../../store', () => ({
  useStore: (select: (state: unknown) => unknown) => select({ showToast: vi.fn() }),
}))
vi.mock('../../hooks/useReleaseUpdates', () => ({
  useReleaseUpdates: (select: (state: unknown) => unknown) => select({ releases: [], checkError: '' }),
  checkForUpdates: vi.fn(), setUpdateModalOpen: vi.fn(),
}))

import AboutSettingsTab from './AboutSettingsTab'

afterEach(() => { mocks.siteMode.IS_SITE_MODE = true })

describe('站点关于页', () => {
  it('隐藏原项目、作者和外部入口，同时保留字体许可入口', () => {
    const html = renderToStaticMarkup(<AboutSettingsTab onOpenFontLicenses={() => {}} />)
    expect(html).not.toContain('检查更新')
    expect(html).not.toContain('赞助作者')
    expect(html).not.toContain('反馈问题')
    expect(html).not.toContain('GPT Image Playground')
    expect(html).not.toContain('CookSleep')
    expect(html).not.toContain('本站基于')
    expect(html).not.toContain('<a ')
    expect(html).toContain('字体与第三方许可')
    expect(html).toContain('HarmonyOS Sans SC')
    expect(html).toContain('Maple Mono NF CN')
  })

  it('非站点模式保留原有更新与赞助入口', () => {
    mocks.siteMode.IS_SITE_MODE = false
    const html = renderToStaticMarkup(<AboutSettingsTab onOpenFontLicenses={() => {}} />)
    expect(html).toContain('检查更新')
    expect(html).toContain('赞助作者')
    expect(html).toContain('GPT Image Playground')
    expect(html).toContain('CookSleep')
  })
})
