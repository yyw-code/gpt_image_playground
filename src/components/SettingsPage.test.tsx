// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from '../lib/api'
import * as imageApi from '../lib/api'
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

import SettingsPage from './SettingsPage'

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
    settings: normalizeSettings({ profiles: [{ ...site, apiKey: 'fixture-openai-key', model: 'saved-openai-model', apiMode: 'images' }] }),
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
function renderSettings(openEditor = true) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<SettingsPage />))
  if (openEditor) act(() => container.querySelector<HTMLButtonElement>('[aria-label^="编辑图片配置"]')!.click())
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
  it('本站 CLI 开关说明与目标比例生成逻辑一致', () => {
    const container = renderSettings()
    expect(container.textContent).toContain('无论开关状态，本站均按所选目标比例约束整张画布')
    expect(container.textContent).not.toContain('不自动拼接构图比例')
  })

  it('旧 Responses 画廊配置保持原路径、文本模型和工具模型，不影响 Agent 副本', () => {
    const legacy = { ...site, apiKey: 'fixture', apiMode: 'responses' as const, model: 'gpt-6.1-sol', selectedModel: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.5-sunburst' }
    mocks.state.settings = normalizeSettings({ profiles: [legacy], agentProfiles: [legacy], agentTextProfileId: legacy.id })
    const agentBefore = (mocks.state.settings as AppSettings).agentProfiles
    const container = renderSettings()
    expect(field(container, 'API 接口').textContent).toContain('Responses')
    expect(container.querySelector('[aria-label="选择文本模型 ID"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="选择图像工具模型"]')).not.toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject(legacy)
    expect((mocks.state.settings as AppSettings).agentProfiles).toEqual(agentBefore)
  })

  it.each([true, false])('旧 Responses 空图片工具模型保持原值，不猜测模型，site=%s', (siteMode) => {
    mocks.siteMode.IS_SITE_MODE = siteMode
    const legacy = { ...site, apiMode: 'responses' as const, model: 'text-model', imageGenerationModel: '' }
    mocks.state.settings = normalizeSettings({ profiles: [legacy] })
    const container = renderSettings()
    expect(container.querySelector('[aria-label="选择图像工具模型"]')?.previousElementSibling).toHaveProperty('value', '')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject({ apiMode: 'responses', model: 'text-model', imageGenerationModel: '' })
  })

  it('锁定的 Responses 预置保留原值，路径选项不可修改', () => {
    mocks.locked = true
    const legacy = { ...site, apiMode: 'responses' as const, model: 'text-model', imageGenerationModel: 'gpt-image-2.6-flare' }
    mocks.state.settings = normalizeSettings({ profiles: [legacy] })
    const container = renderSettings()
    const api = field(container, 'API 接口')
    act(() => api.querySelector<HTMLElement>('.cursor-pointer')!.click())
    expect(api.querySelector('[data-option-value]')).toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject(legacy)
  })

  it('明确选择 Responses 后要求文本模型，不自动选模型或发生成请求', () => {
    const submit = vi.spyOn(imageApi, 'callImageApi')
    const container = renderSettings()
    const api = field(container, 'API 接口')
    act(() => api.querySelector<HTMLElement>('.cursor-pointer')!.click())
    act(() => api.querySelector<HTMLElement>('[data-option-value="responses"]')!.click())
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject({ apiMode: 'responses', model: '', imageGenerationModel: 'saved-openai-model', codexCli: false, streamImages: false })
    expect(container.textContent).toContain('请先选择文本模型')
    expect(submit).not.toHaveBeenCalled()
  })

  it('保存本站配置时不转换外站历史 Responses 配置', () => {
    const settings = mocks.state.settings as AppSettings
    const external = { ...site, id: 'external', baseUrl: 'https://other.example/v1', apiMode: 'responses' as const, model: 'external-text', imageGenerationModel: 'gpt-image-2.6-flare' }
    mocks.state.settings = normalizeSettings({ ...settings, profiles: [...settings.profiles, external] })
    const container = renderSettings()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect((mocks.state.settings as AppSettings).profiles.find((profile) => profile.id === external.id)).toEqual(external)
  })

  it('切回旧 OpenAI 草稿时保留 Responses 路径和工具模型', () => {
    const settings = mocks.state.settings as AppSettings
    const profile = settings.profiles[0]
    mocks.state.settings = normalizeSettings({ ...settings, profiles: [{
      ...profile,
      provider: 'grok', model: 'grok-imagine-image',
      providerDrafts: { openai: { ...profile, apiMode: 'responses', model: 'text-model', imageGenerationModel: 'gpt-image-2.6-sunburst' } },
    }] })
    const container = renderSettings()
    chooseProvider(container, 'ChatGPT')
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject({ apiMode: 'responses', model: 'text-model', imageGenerationModel: 'gpt-image-2.6-sunburst' })
    expect(field(container, 'API 接口').textContent).toContain('Responses')
  })
  it('使用独立设置页面，提供返回工作台入口和常驻配置列表', () => {
    const container = renderSettings(false)
    expect(container.querySelector('[data-settings-page]')).not.toBeNull()
    expect(container.querySelector('.animate-overlay-in')).toBeNull()
    expect(container.querySelector('[aria-label="返回工作台"]')).not.toBeNull()
    const list = container.querySelector('[aria-label="图片配置列表"]')!
    expect(list).not.toBeNull()
    expect(list.textContent).toContain('saved-openai-model')
    expect(list.textContent).toContain('当前使用')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[aria-label="图片配置详情"]')).toBeNull()
  })

  it('列表选中配置仅编辑，返回工作台前保存草稿', () => {
    const settings = mocks.state.settings as AppSettings
    mocks.state.settings = normalizeSettings({ ...settings, profiles: [...settings.profiles, { ...settings.profiles[0], id: 'second', name: '第二套配置' }] })
    const container = renderSettings(false)
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="编辑图片配置「第二套配置」"]')!.click())
    expect((mocks.state.settings as AppSettings).activeProfileId).toBe(site.id)
    const input = field(container, '配置名称').querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '待保存的名称')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="返回工作台"]')!.click())
    expect(mocks.state.setShowSettings).toHaveBeenCalledWith(false)
    expect((mocks.state.settings as AppSettings).profiles).toHaveLength(2)
    expect((mocks.state.settings as AppSettings).profiles.find((profile) => profile.id === 'second')?.name).toBe('待保存的名称')
  })

  it('切换列表项时重新遮挡密钥，列表不展示密钥', () => {
    const settings = mocks.state.settings as AppSettings
    mocks.state.settings = normalizeSettings({ ...settings, profiles: [...settings.profiles, { ...settings.profiles[0], id: 'second', name: '第二套配置' }] })
    const container = renderSettings()
    const detail = container.querySelector('[aria-label="图片配置详情"]')!
    const key = [...detail.querySelectorAll<HTMLInputElement>('input')].find((input) => input.type === 'password')!
    act(() => key.parentElement!.querySelector<HTMLButtonElement>('button')!.click())
    expect(key.type).toBe('text')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="编辑图片配置「${settings.profiles[0].name}」"]`)!.click())
    expect(container.querySelector('[aria-label="图片配置详情"] input[type="password"]')).not.toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="编辑图片配置「第二套配置」"]')!.click())
    expect(container.querySelector('[aria-label="图片配置详情"] input[type="password"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="图片配置列表"]')?.textContent).not.toContain('fixture-openai-key')
  })

  it('新建后打开编辑弹窗，密钥为空且关闭不切换当前使用项', () => {
    const before = mocks.state.settings as AppSettings
    const container = renderSettings(false)
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === '创建新配置')!.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    const saved = mocks.state.settings as AppSettings
    expect(saved.profiles).toHaveLength(2)
    expect(saved.profiles[1].apiKey).toBe('')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect((mocks.state.settings as AppSettings).activeProfileId).toBe(before.activeProfileId)
    expect(mocks.state.setShowSettings).not.toHaveBeenCalled()
  })

  it('自定义服务商弹窗按 Escape 逐层关闭，保留配置编辑和设置页面', () => {
    mocks.siteMode.IS_SITE_MODE = false
    const container = renderSettings()
    chooseProvider(container, '创建自定义服务商')
    expect(document.body.textContent).toContain('AI 一键生成与导入')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.body.textContent).not.toContain('AI 一键生成与导入')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.state.setShowSettings).not.toHaveBeenCalled()
  })

  it('复制只创建待编辑图片配置，显式启用才切换，Agent 配置保持独立', () => {
    const before = mocks.state.settings as AppSettings
    const container = renderSettings()
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="复制一份配置「${before.profiles[0].name}」"]`)!.click())
    const copied = mocks.state.settings as AppSettings
    expect(copied.profiles).toHaveLength(2)
    expect(copied.activeProfileId).toBe(before.activeProfileId)
    expect(copied.agentProfiles).toEqual(before.agentProfiles)
    const activate = [...container.querySelectorAll('button')].find((button) => button.textContent === '使用此图片配置')!
    expect(activate).toBeDefined()
    act(() => activate.click())
    expect((mocks.state.settings as AppSettings).activeProfileId).toBe(copied.profiles[1].id)
    expect((mocks.state.settings as AppSettings).agentProfiles).toEqual(before.agentProfiles)
  })

  it('站点模式以 ChatGPT 和 Grok 展示生图类型，连接继续只读', () => {
    const container = renderSettings()
    const control = field(container, '生图类型')
    act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
    expect(control.textContent).toContain('Grok')
    expect(control.textContent).toContain('ChatGPT')
    expect(control.textContent).not.toContain('兼容接口')
    expect(control.textContent).not.toContain('Sub2API')
    for (const hidden of ['fal.ai', 'sub2api（异步）', '创建自定义服务商']) expect(control.textContent).not.toContain(hidden)
    expect(field(container, 'API URL').querySelector('input')).toMatchObject({ readOnly: true, value: site.baseUrl })
    expect(container.querySelector('[aria-label="API 代理"]')).toBeNull()
  })

  it('切换 Grok 后覆盖外站草稿连接，保存恢复并使用原生请求参数', async () => {
    const settings = mocks.state.settings as AppSettings
    settings.profiles[0].providerDrafts = { grok: { baseUrl: 'https://foreign.example/v1', apiProxy: false, model: 'grok-imagine-image-2.0' } }
    const container = renderSettings()
    chooseProvider(container, 'Grok')
    const saved = mocks.state.settings as AppSettings
    expect(saved.profiles[0]).toMatchObject({ id: site.id, provider: 'grok', baseUrl: site.baseUrl, apiProxy: true, apiKey: '', model: 'grok-imagine-image-2.0', apiMode: 'images', codexCli: false, streamImages: false })
    expect(field(container, '生图类型').textContent).toContain('Grok')
    expect(field(container, 'API URL').querySelector('input')?.value).toBe(site.baseUrl)
    const restored = normalizeSettings(enforcePresetConfigPolicy(normalizeSettings(JSON.parse(JSON.stringify(saved)))))
    expect(restored.activeProfileId).toBe(site.id)
    expect(restored.profiles[0]).toEqual(saved.profiles[0])
    restored.profiles[0].apiKey = 'fixture-grok-key'
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUg==' }] })))
    await callImageApi({ settings: restored, prompt: '帮我生成一张小猫图片', params: { ...DEFAULT_PARAMS, resolution: '1k', aspect_ratio: '1:1' }, inputImageDataUrls: [] })
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ model: 'grok-imagine-image-2.0', prompt: '帮我生成一张小猫图片', n: 1, response_format: 'b64_json', resolution: '1k', aspect_ratio: '1:1', quality: 'auto' })
  })

  it('切回 OpenAI 恢复原有模型和接口，本站连接不受草稿影响', () => {
    const container = renderSettings()
    chooseProvider(container, 'Grok')
    chooseProvider(container, 'ChatGPT')
    expect((mocks.state.settings as AppSettings).profiles[0]).toMatchObject({ provider: 'openai', baseUrl: site.baseUrl, apiProxy: true, model: 'saved-openai-model', apiMode: 'images', apiKey: '' })
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
