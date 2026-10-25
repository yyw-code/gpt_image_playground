import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertRuntimeConfigLoaded, readRuntimeEnv } from './runtimeEnv'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('部署运行时配置', () => {
  it('未提供运行时覆盖时保留构建配置和旧调用方式', () => {
    expect(readRuntimeEnv(' build-value ')).toBe('build-value')
    expect(readRuntimeEnv(undefined, 'VITE_DEFAULT_API_URL')).toBe('')
  })

  it('使用本次页面加载的配置覆盖构建值，允许显式清空', () => {
    vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: { VITE_DEFAULT_API_URL: ' https://new.example/v1 ', VITE_SITE_MODE: '' } })
    expect(readRuntimeEnv('https://old.example/v1', 'VITE_DEFAULT_API_URL')).toBe('https://new.example/v1')
    expect(readRuntimeEnv('true', 'VITE_SITE_MODE')).toBe('')
  })

  it('只读取配置自身的字段，不接受原型上的覆盖值', () => {
    vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: Object.create({ VITE_SITE_MODE: 'false' }) })
    expect(readRuntimeEnv('true', 'VITE_SITE_MODE')).toBe('true')
  })

  it('同一份代码在下一次加载配置后读取新值', () => {
    vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: { VITE_DEFAULT_API_URL: 'https://first.example/v1' } })
    expect(readRuntimeEnv('', 'VITE_DEFAULT_API_URL')).toBe('https://first.example/v1')
    window.__GPT_IMAGE_RUNTIME_CONFIG__ = { VITE_DEFAULT_API_URL: 'https://second.example/v1' }
    expect(readRuntimeEnv('', 'VITE_DEFAULT_API_URL')).toBe('https://second.example/v1')
  })

  it('现有 API 配置、站点模式与字体入口实际读取本次部署值', async () => {
    vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: {
      VITE_DEFAULT_API_URL: 'https://new.example/v1', VITE_SITE_MODE: 'true', VITE_DEFAULT_UI_FONT: '站点字体',
    } })
    const apiProfiles = await import('./apiProfiles')
    const siteMode = await import('./siteMode')
    const fonts = await import('./fonts')
    expect(apiProfiles.createDefaultOpenAIProfile().baseUrl).toBe('https://new.example/v1')
    expect(siteMode.IS_SITE_MODE).toBe(true)
    expect(fonts.resolveSlotFont('ui', 'default', '')).toEqual({ source: 'custom', name: '站点字体' })
  })

  it('配置文件缺失或结构损坏时阻止继续启动', () => {
    vi.stubGlobal('window', {})
    expect(() => assertRuntimeConfigLoaded()).toThrow('站点配置')
    for (const invalid of [null, [], 'invalid', {}, { VITE_DOCKER_DEPLOYMENT: 'true', VITE_SITE_MODE: true }]) {
      vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: invalid })
      expect(() => assertRuntimeConfigLoaded()).toThrow('站点配置')
    }
  })

  it('静态部署空配置保留构建值，Docker 完整配置可正常启动', () => {
    vi.stubGlobal('window', { __GPT_IMAGE_RUNTIME_CONFIG__: {} })
    expect(readRuntimeEnv('build-value', 'VITE_DEFAULT_API_URL')).toBe('build-value')
    window.__GPT_IMAGE_RUNTIME_CONFIG__ = { VITE_DOCKER_DEPLOYMENT: 'true', VITE_SITE_MODE: 'true' }
    expect(() => assertRuntimeConfigLoaded()).not.toThrow()
  })
})
