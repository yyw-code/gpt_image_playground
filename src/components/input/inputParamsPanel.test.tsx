// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import InputParamsPanel from './inputParamsPanel'

vi.mock('../Select', () => ({
  default: ({ prefix, options, disabled }: { prefix?: unknown; options: Array<{ label: string }>; disabled?: boolean }) => <span data-disabled={disabled}>{prefix as string}{options.map((option) => option.label).join(' / ')}</span>,
}))
vi.mock('./paramPopoverChip', () => ({
  default: ({ children, summary }: { children: React.ReactNode; summary: string }) => <div>{summary}{children}</div>,
  CHIP_BASE_CLASS: '', CHIP_IDLE_CLASS: '',
}))
vi.mock('./buttonTooltip', () => ({ default: () => null }))

/** 提供参数面板的空交互回调，仅检查用户可见的能力边界。 */
function props(provider: string): ComponentProps<typeof InputParamsPanel> {
  const hint = { visible: false, show: vi.fn(), hide: vi.fn(), clearTimer: vi.fn(), startTouch: vi.fn() }
  return {
    params: { ...DEFAULT_PARAMS }, setParams: vi.fn(), activeProfile: createDefaultOpenAIProfile({ provider }),
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

describe('Grok generation controls', () => {
  it('offers composition complexity only on native 2.6 Images and retains existing output formats', () => {
    const value = props('openai')
    value.activeProfile.model = 'gpt-image-2.6-flare'
    const html = renderToStaticMarkup(<InputParamsPanel {...value} />)
    expect(html).toContain('构图复杂度')
    expect(html).toContain('接口默认')
    expect(html).toContain('PNG / JPEG / WebP')
    for (const patch of [{ model: 'gpt-image-2.5-flare' }, { codexCli: true }, { apiMode: 'responses' as const, imageGenerationModel: 'gpt-image-2.6-flare' }]) {
      expect(renderToStaticMarkup(<InputParamsPanel {...value} activeProfile={{ ...value.activeProfile, ...patch }} />)).not.toContain('构图复杂度')
    }
  })
  it('shows native geometry and original image format instead of GPT controls', () => {
    const html = renderToStaticMarkup(<InputParamsPanel {...props('grok')} />)
    expect(html).toContain('分辨率')
    expect(html).toContain('比例')
    expect(html).toContain('1K')
    expect(html).toContain('2K')
    expect(html).toContain('接口原始格式')
    expect(html).not.toContain('4K')
    expect(html).not.toContain('质量')
    expect(html).not.toContain('压缩率')
    expect(html).not.toContain('审核')
    expect(html).not.toContain('透明背景')
  })

  it('preserves the GPT size, quality and output format controls', () => {
    const html = renderToStaticMarkup(<InputParamsPanel {...props('openai')} />)
    expect(html).toContain('尺寸')
    expect(html).toContain('质量')
    expect(html).toContain('WebP')
    expect(html).not.toContain('接口原始格式')
  })

  it('offers only 2.0 quality and adds its wide ratios', () => {
    const value = props('grok')
    value.activeProfile.model = 'grok-imagine-image-2.0'
    const html = renderToStaticMarkup(<InputParamsPanel {...value} />)
    expect(html).toContain('auto / low / medium')
    expect(html).toContain('21:9')
    expect(html).toContain('5:2')
    expect(html).toContain('生成张数')
    expect(html).toContain('max="10"')
    expect(html).not.toContain('high')
  })

  it('keeps legacy quality wording and does not offer 2.0-specific controls', () => {
    const value = props('grok')
    value.activeProfile.model = 'grok-imagine-image-quality'
    const html = renderToStaticMarkup(<InputParamsPanel {...value} />)
    expect(html).toContain('迁移至 2.0 low')
    expect(html).not.toContain('21:9')
    expect(html).not.toContain('质量</span>')
  })

  it('shows composition guidance and original format for Codex', () => {
    const value = props('openai')
    value.activeProfile.codexCli = true
    value.displaySize = '16:9'
    const html = renderToStaticMarkup(<InputParamsPanel {...value} />)
    expect(html).toContain('构图比例')
    expect(html).toContain('接口原始格式')
    expect(html).not.toContain('WebP')
    expect(html).not.toContain('压缩率')
  })

  it('explains unknown model defaults and keeps Agent count automatic', () => {
    const value = props('openai')
    value.activeProfile.model = 'unconfirmed-image'
    value.agentAutoImageCount = true
    value.nInput = 'auto'
    const html = renderToStaticMarkup(<InputParamsPanel {...value} />)
    expect(html).toContain('参数能力尚未确认')
    expect(html).toContain('value="auto"')
    expect(html).not.toContain('max="10"')
    expect(html).not.toContain('WebP')
  })
})
