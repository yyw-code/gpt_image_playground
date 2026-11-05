// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SizePickerModal from './SizePickerModal'

describe('model-aware size picker', () => {
  it('offers fixed 1.5 sizes while retaining disabled custom controls', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="1024x1024" sizeMode="fixed" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('1536x1024')
    expect(html).toContain('1024x1536')
    expect(html).toContain('4K')
    expect(html).toContain('自定义宽高')
  })

  it('shows only composition controls for a Codex connection', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="1280x720" codexCli onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('设置构图比例')
    expect(html).toContain('16:9')
    expect(html).not.toContain('1280x720')
    expect(html).toContain('基准分辨率')
    expect(html).toContain('自定义宽高')
    expect(html).toContain('4K')
    expect(html).toContain('不保证精确比例')
  })

  it.each(['fixed', 'composition', 'auto'] as const)('禁用 %s 的自定义宽高和档位，点击不会改变确认结果', (sizeMode) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const onSelect = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1024x1024" sizeMode={sizeMode} onSelect={onSelect} onClose={vi.fn()} />))
      for (const label of ['自定义宽高', '1K', '2K', '4K']) {
        const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
        expect(button.disabled).toBe(true)
        act(() => button.click())
      }
      const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === '确定')!
      act(() => confirm.click())
      expect(onSelect).toHaveBeenCalledWith(sizeMode === 'auto' ? 'auto' : '1024x1024')
    } finally { act(() => root.unmount()); vi.unstubAllGlobals() }
  })

  it('keeps custom native sizes and labels experimental resolution', () => {
    const html = renderToStaticMarkup(<SizePickerModal currentSize="3840x2160" sizeMode="custom" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('3840x2160')
    expect(html).toContain('自定义宽高')
    expect(html).toContain('实验支持')
  })

  it('retains a non-preset Codex composition when confirming the reopened picker', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSelect = vi.fn()
    const onClose = vi.fn()
    try {
      act(() => root.render(<SizePickerModal currentSize="1152x960" sizeMode="composition" onSelect={onSelect} onClose={onClose} />))
      expect(container.querySelector('input')?.value).toBe('1152:960')
      const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === '确定')!
      act(() => confirm.click())
      const [width, height] = onSelect.mock.calls[0][0].split('x').map(Number)
      expect(Math.abs((width / height) / (1152 / 960) - 1)).toBeLessThanOrEqual(0.01)
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
