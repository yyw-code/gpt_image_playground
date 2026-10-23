import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('./platform')
  vi.resetModules()
})

describe('站点模式', () => {
  it('网页版默认启用，不要求部署额外设置开关', async () => {
    vi.stubEnv('VITE_SITE_MODE', '')
    vi.doMock('./platform', () => ({ isTauri: false }))
    expect((await import('./siteMode')).IS_SITE_MODE).toBe(true)
  })

  it('显式关闭后恢复上游网页功能', async () => {
    vi.stubEnv('VITE_SITE_MODE', ' false ')
    vi.doMock('./platform', () => ({ isTauri: false }))
    expect((await import('./siteMode')).IS_SITE_MODE).toBe(false)
  })

  it('客户端不受站点模式影响', async () => {
    vi.stubEnv('VITE_SITE_MODE', 'true')
    vi.doMock('./platform', () => ({ isTauri: true }))
    expect((await import('./siteMode')).IS_SITE_MODE).toBe(false)
  })
})
