// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Select from './Select'

it('保留禁用选项和原因，点击无效；支持的选项仍可选择', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onChange = vi.fn()
  try {
    act(() => root.render(<Select value="auto" onChange={onChange} options={[
      { label: '自动', value: 'auto' },
      { label: '高质量', value: 'high', disabled: true, disabledReason: '当前通道不支持' },
      { label: '中质量', value: 'medium' },
    ]} />))
    act(() => container.querySelector<HTMLElement>('.cursor-pointer')!.click())
    const disabled = container.querySelector<HTMLElement>('[data-option-value="high"]')!
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
    expect(disabled.textContent).toContain('当前通道不支持')
    act(() => disabled.click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => container.querySelector<HTMLElement>('[data-option-value="medium"]')!.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('medium')
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
