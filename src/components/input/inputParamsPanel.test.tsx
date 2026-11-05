// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import InputParamsPanel from './inputParamsPanel'

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
  it('原生 2.6 可用复杂度，其他通道保留但禁用', () => {
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

  it('Grok 旧模型与 2.0 展示相同选项，按模型禁用质量、比例和 4K', () => {
    const value = props('grok')
    const legacy = markup(value)
    expect(control(legacy, '质量').querySelector<HTMLOptionElement>('option[value="medium"]')?.disabled).toBe(true)
    expect(control(legacy, '比例').querySelector<HTMLOptionElement>('option[value="21:9"]')?.disabled).toBe(true)
    value.activeProfile.model = 'grok-imagine-image-2.0'
    const modern = markup(value)
    expect(control(modern, '质量').querySelector<HTMLOptionElement>('option[value="medium"]')?.disabled).toBe(false)
    expect(control(modern, '质量').querySelector<HTMLOptionElement>('option[value="high"]')?.disabled).toBe(true)
    expect(control(modern, '比例').querySelector<HTMLOptionElement>('option[value="21:9"]')?.disabled).toBe(false)
    expect(control(modern, '分辨率档位').querySelector<HTMLOptionElement>('option[value="4k"]')?.disabled).toBe(true)
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
