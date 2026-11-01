// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from '../lib/api'
import { createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import { enforcePresetConfigPolicy, setPresetConfig } from '../lib/presetConfig'

const mocks = vi.hoisted(() => ({
  siteMode: { IS_SITE_MODE: true },
  state: {} as Record<string, unknown>,
  only: false,
  locked: false,
}))

vi.mock('../lib/siteMode', () => mocks.siteMode)
vi.mock('../store', () => ({
  useStore: Object.assign(
    (select: (state: Record<string, unknown>) => unknown) => select(mocks.state),
    { getState: () => mocks.state },
  ),
  exportData: vi.fn(), importData: vi.fn(), clearData: vi.fn(),
}))
vi.mock('../lib/presetConfig', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/presetConfig')>(),
  isPresetConfigOnlyEnabled: () => mocks.only,
  isPresetProfileLocked: () => mocks.locked,
}))

import SettingsModal from './SettingsModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null
const site = createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1', apiProxy: true })

beforeEach(() => {
  mocks.siteMode.IS_SITE_MODE = true
  mocks.only = false
  mocks.locked = false
  setPresetConfig({ customProviders: [], profiles: [site] })
  mocks.state = {
    showSettings: true, tasks: [], agentConversations: [],
    settings: normalizeSettings({ profiles: [{ ...site, apiKey: 'fixture-openai-key', model: 'saved-openai-model', apiMode: 'responses' }] }),
    setSettings: vi.fn((settings: AppSettings) => { mocks.state.settings = enforcePresetConfigPolicy(normalizeSettings(settings)) }),
    setShowSettings: vi.fn(), setReusedTaskApiProfile: vi.fn(), showToast: vi.fn(),
  }
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  setPresetConfig(null)
  vi.restoreAllMocks()
})

/** 挂载真实配置页及下拉框，通过用户操作验证类型切换和配置保存。 */
function renderSettings() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<SettingsModal />))
  return container
}

/** 按字段标题查找控件，避免依赖设置页中的字段顺序。 */
function field(container: HTMLElement, title: string) {
  const label = [...container.querySelectorAll('span')].find((el) => el.textContent === title)
  expect(label, `缺少字段：${title}`).toBeDefined()
  return label!.closest('label') ?? label!.parentElement!
}

/** 使用真实下拉框选择类型，覆盖入口可见性与事件处理。 */
function chooseProvider(container: HTMLElement, label: string) {
  const control = field(container, mocks.siteMode.IS_SITE_MODE ? '生图类型' : '服务商类型')
  act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
  const option = [...control.querySelectorAll('span')].find((el) => el.textContent === label && el.closest('.absolute'))
  expect(option, `缺少选项：${label}`).toBeDefined()
  act(() => option!.click())
}

describe('配置页的生图类型选择', () => {
  it('站点模式只开放 OpenAI 和 Grok，连接继续只读', () => {
    const container = renderSettings()
    const control = field(container, '生图类型')
    act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
    expect(control.textContent).toContain('Grok（Sub2API）')
    expect(control.textContent).toContain('OpenAI 兼容接口')
    for (const hidden of ['fal.ai', 'sub2api（异步）', '创建自定义服务商']) expect(control.textContent).not.toContain(hidden)
    expect(field(container, 'API URL').querySelector('input')).toMatchObject({ readOnly: true, value: site.baseUrl })
    expect(container.querySelector('[aria-label="API 代理"]')).toBeNull()
  })

  it('切换 Grok 后覆盖外站草稿连接，保存恢复并使用原生请求参数', async () => {
    const settings = mocks.state.settings as AppSettings
    settings.profiles[0].providerDrafts = { grok: { baseUrl: 'https://foreign.example/v1', apiProxy: false, model: 'grok-imagine-image-2.0' } }
    const container = renderSettings()
    chooseProvider(container, 'Grok（Sub2API）')
    const saved = mocks.state.settings as AppSettings
    expect(saved.profiles[0]).toMatchObject({ id: site.id, provider: 'grok', baseUrl: site.baseUrl, apiProxy: true, apiKey: '', model: 'grok-imagine-image-2.0', apiMode: 'images', codexCli: false, streamImages: false })
    expect(field(container, '生图类型').textContent).toContain('Grok（Sub2API）')
    expect(field(container, 'API URL').querySelector('input')?.value).toBe(site.baseUrl)
    const restored = normalizeSettings(enforcePresetConfigPolicy(normalizeSettings(JSON.parse(JSON.stringify(saved)))))
    expect(restored.activeProfileId).toBe(site.id)
    expect(restored.profiles[0]).toEqual(saved.profiles[0])
    restored.profiles[0].apiKey = 'fixture-grok-key'
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUg==' }] })))
    await callImageApi({ settings: restored, prompt: '帮我生成一张小猫图片', params: { ...DEFAULT_PARAMS, resolution: '1k', aspect_ratio: '1:1' }, inputImageDataUrls: [] })
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ model: 'grok-imagine-image-2.0', prompt: '帮我生成一张小猫图片', n: 1, response_format: 'b64_json', resolution: '1k', aspect_ratio: '1:1' })
  })

  it('切回 OpenAI 恢复原有模型和接口，本站连接不受草稿影响', () => {
    const container = renderSettings()
    chooseProvider(container, 'Grok（Sub2API）')
    chooseProvider(container, 'OpenAI 兼容接口')
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject({ provider: 'openai', baseUrl: site.baseUrl, apiProxy: true, model: 'saved-openai-model', apiMode: 'responses', apiKey: '' })
  })

  it.each(['only', 'locked'] as const)('部署启用 %s 时仍禁止切换类型', (restriction) => {
    mocks[restriction] = true
    const container = renderSettings()
    const control = field(container, '生图类型')
    act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
    expect(control.querySelector('.absolute')).toBeNull()
    expect(mocks.state.setSettings).not.toHaveBeenCalled()
    expect((mocks.state.settings as AppSettings).profiles[0].provider).toBe('openai')
  })

  it('非站点模式保留完整的服务商选择入口', () => {
    mocks.siteMode.IS_SITE_MODE = false
    const container = renderSettings()
    const control = field(container, '服务商类型')
    act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
    for (const label of ['Grok（Sub2API）', 'fal.ai', 'sub2api（异步）', '创建自定义服务商']) expect(control.textContent).toContain(label)
  })
})
