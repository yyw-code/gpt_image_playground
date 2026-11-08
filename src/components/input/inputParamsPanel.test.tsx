// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import InputParamsPanel from './inputParamsPanel'
import { setSiteConnection } from '../../lib/siteProfiles'

const mode = vi.hoisted(() => ({ IS_SITE_MODE: true }))
vi.mock('../../lib/siteMode', () => mode)
afterEach(() => { mode.IS_SITE_MODE = true; setSiteConnection() })

vi.mock('../Select', () => ({
  default: ({ prefix, value, onChange, options, disabled }: { prefix?: React.ReactNode; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string; disabled?: boolean }>; disabled?: boolean }) => <label>{prefix}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>,
}))
vi.mock('./paramPopoverChip', () => ({
  default: ({ children, summary }: { children: React.ReactNode; summary: string }) => <div>{summary}{children}</div>,
  CHIP_BASE_CLASS: '', CHIP_IDLE_CLASS: '',
}))
vi.mock('./buttonTooltip', () => ({ default: () => null }))

/** 提供普通 API 的空交互夹具；Codex 用例显式开启开关，独立检查能力边界。 */
function props(provider: string): ComponentProps<typeof InputParamsPanel> {
  const hint = { visible: false, show: vi.fn(), hide: vi.fn(), clearTimer: vi.fn(), startTouch: vi.fn() }
  return {
    params: { ...DEFAULT_PARAMS }, setParams: vi.fn(), activeProfile: createDefaultOpenAIProfile({ provider, codexCli: false }),
    modelOptions: [{ label: 'test-model', value: 'test-model' }], onModelChange: vi.fn(),
    isFalProvider: false, isFalTextToImage: false, displaySize: 'auto',
    qualityOptions: [{ label: 'high', value: 'high' }], selectClass: '',
    transparentOutputAvailable: false, showTransparentOutputControl: false, transparentOutputEnabled: false,
    transparentOutputHint: hint, onTransparentOutputMenuOpenChange: vi.fn(), compressionHint: hint,
    compressionDisabled: true, outputCompressionInput: '', setOutputCompressionInput: vi.fn(), commitOutputCompression: vi.fn(),
    moderationHint: hint, moderationDisabled: true, agentAutoImageCount: false, outputImageLimit: 10,
    nInput: '1', setNInputFocused: vi.fn(), commitN: vi.fn(), handleNInputChange: vi.fn(),
    handleNLimitIncreaseAttempt: vi.fn(), showAgentNHint: vi.fn(), hideNLimitHint: vi.fn(),
    startAgentNHintTouch: vi.fn(), clearAgentNHintTouchTimer: vi.fn(), nLimitHint: hint, nLimitHintText: '',
    streamConcurrentByN: false, streamConcurrentHint: hint, sizeHint: hint, qualityHint: hint, onOpenSizePicker: vi.fn(),
    showBatch: false, batchEnabled: false, batchMode: 'concurrent', batchConcurrencyLimited: true,
    batchConcurrency: 2, batchPromptCount: 0, batchProgress: null, onBatchChange: vi.fn(), onStopBatch: vi.fn(),
  }
}

/** 将实际参数面板渲染为 DOM，检查可见入口及浏览器禁用状态。 */
function markup(value: ComponentProps<typeof InputParamsPanel>) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<InputParamsPanel {...value} />)
  return container
}

/** 按字段名称获取其下拉框，不依赖面板内部文件实现。 */
function control(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('select')].find((select) => select.closest('label')?.textContent?.startsWith(label) || select.parentElement?.parentElement?.previousElementSibling?.textContent === label)!
}

describe('参数能力展示', () => {
  it('站点在 CLI 开关两种状态均说明目标比例和实际尺寸核对', () => {
    const value = props('openai')
    for (const codexCli of [false, true]) {
      value.activeProfile.codexCli = codexCli
      const container = markup(value)
      expect(container.textContent).toContain('实际分辨率由模型决定')
      expect(container.textContent).toContain('偏差超过 1%')
      expect(container.textContent).not.toContain('不自动向提示词追加比例')
      expect([...container.querySelectorAll('button')].some((button) => button.textContent === '比例auto')).toBe(true)
    }
  })

  it('外部原生模式保留像素参数说明', () => {
    mode.IS_SITE_MODE = false
    try {
      expect(markup(props('openai')).textContent).toContain('不自动向提示词追加比例')
    } finally { mode.IS_SITE_MODE = true }
  })

  it('原生 2.6 可用复杂度，其他通道保留但禁用', () => {
    mode.IS_SITE_MODE = false
    const value = props('openai')
    value.activeProfile.model = 'gpt-image-2.6-flare'
    expect(control(markup(value), '构图复杂度').disabled).toBe(false)
    for (const patch of [{ model: 'gpt-image-2.5-flare' }, { codexCli: true }, { apiMode: 'responses' as const, imageGenerationModel: 'gpt-image-2.6-flare' }]) {
      const container = markup({ ...value, activeProfile: { ...value.activeProfile, ...patch } })
      expect(control(container, '构图复杂度').disabled).toBe(true)
    }
  })

  it.each(['grok', 'openai'])('受限 %s 通道保留格式、压缩、审核和透明背景，但不可选择', (provider) => {
    const value = props(provider)
    value.activeProfile.codexCli = provider === 'openai'
    const container = markup(value)
    for (const label of ['格式', '审核', '透明背景']) expect(control(container, label).disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[placeholder="0-100"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('WebP')
    expect(container.textContent).toContain('接口原始格式')
  })

  it('Grok 使用统一尺寸弹窗入口，质量仍按模型禁用', () => {
    const value = props('grok')
    const legacy = markup(value)
    expect(control(legacy, '质量').querySelector<HTMLOptionElement>('option[value="medium"]')?.disabled).toBe(true)
    expect([...legacy.querySelectorAll('button')].some((button) => button.textContent?.includes('1K · 1:1'))).toBe(true)
    value.activeProfile.model = 'grok-imagine-image-2.0'
    const modern = markup(value)
    expect(control(modern, '质量').querySelector<HTMLOptionElement>('option[value="medium"]')?.disabled).toBe(false)
    expect(control(modern, '质量').querySelector<HTMLOptionElement>('option[value="high"]')?.disabled).toBe(true)
    expect([...modern.querySelectorAll('button')].some((button) => button.textContent?.includes('尺寸'))).toBe(true)
  })

  it('未知模型使用自动参数，保留所有选项且 Agent 张数仍自动', () => {
    const value = props('openai')
    value.activeProfile.model = 'unconfirmed-image'
    value.agentAutoImageCount = true
    value.nInput = 'auto'
    const container = markup(value)
    expect(container.textContent).toContain('参数能力尚未确认')
    expect(control(container, '质量').querySelector<HTMLOptionElement>('option[value="high"]')?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input[value="auto"]')?.disabled).toBe(true)
    expect(container.querySelector('input[max="10"]')).toBeNull()
  })

  it('受限通道仍可操作本地去背景，支持的质量可选择，无效质量不会写入', () => {
    mode.IS_SITE_MODE = false
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const value = props('openai')
    value.activeProfile.codexCli = true
    value.transparentOutputAvailable = true
    value.showTransparentOutputControl = true
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() => root.render(<InputParamsPanel {...value} />))
      const background = control(container, '本地去背景')
      expect(background.disabled).toBe(false)
      act(() => { background.value = 'on'; background.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(value.setParams).toHaveBeenCalledWith(expect.objectContaining({ transparent_output: true }))
      vi.mocked(value.setParams).mockClear()
      const quality = control(container, '质量')
      act(() => { quality.value = 'high'; quality.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(value.setParams).not.toHaveBeenCalled()
      value.activeProfile.codexCli = false
      act(() => root.render(<InputParamsPanel {...value} />))
      act(() => { quality.value = 'high'; quality.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(value.setParams).toHaveBeenCalledWith({ quality: 'high' })
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })
})


describe('本站禁用选项与旧草稿恢复', () => {
  it('格式逐项置灰，强制 change 也不能写入；切回外部模式恢复选择', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const value = props('openai')
    setSiteConnection(value.activeProfile)
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() => root.render(<InputParamsPanel {...value} />))
      const format = control(container, '格式')
      expect(format.disabled).toBe(false)
      expect(format.querySelector<HTMLOptionElement>('option[value="webp"]')!.disabled).toBe(true)
      expect(format.querySelector<HTMLOptionElement>('option[value="jpeg"]')!.disabled).toBe(true)
      expect(container.textContent).toContain('实际返回 PNG')
      act(() => { format.value = 'webp'; format.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(value.setParams).not.toHaveBeenCalled()
      mode.IS_SITE_MODE = false
      act(() => root.render(<InputParamsPanel {...value} />))
      expect(format.querySelector<HTMLOptionElement>('option[value="webp"]')!.disabled).toBe(false)
      act(() => { format.value = 'webp'; format.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(value.setParams).toHaveBeenCalledWith(expect.objectContaining({ output_format: 'webp' }))
    } finally { act(() => root.unmount()); setSiteConnection(); mode.IS_SITE_MODE = true; vi.unstubAllGlobals() }
  })

  it('旧 WebP / high / 压缩率原样展示，用户主动恢复后只更新不支持的字段', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const value = props('openai')
    setSiteConnection(value.activeProfile)
    value.params = { ...value.params, quality: 'high', output_format: 'webp', output_compression: 80, imageAspectRatio: '21:9' }
    value.outputCompressionInput = '80'
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() => root.render(<InputParamsPanel {...value} />))
      expect(control(container, '格式').value).toBe('webp')
      expect(control(container, '质量').value).toBe('high')
      expect(container.textContent).toContain('格式不可用')
      expect(container.textContent).toContain('质量不可用')
      expect(value.setParams).not.toHaveBeenCalled()
      const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === '恢复可用参数')!
      act(() => restore.click())
      expect(value.setParams).toHaveBeenCalledExactlyOnceWith({ quality: 'auto', output_format: 'png', output_compression: null })
    } finally { act(() => root.unmount()); setSiteConnection(); vi.unstubAllGlobals() }
  })
})
