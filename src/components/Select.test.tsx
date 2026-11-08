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
    expect(container.querySelector('[data-option-value="auto"]')?.hasAttribute('title')).toBe(false)
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

it('下拉触发器可聚焦并继承 fieldset 禁用，禁用更新会关闭已展开菜单', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onChange = vi.fn()
  try {
    act(() => root.render(<fieldset disabled><Select ariaLabel="测试下拉" value="a" onChange={onChange} options={[{ label: 'A', value: 'a' }]} /></fieldset>))
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="测试下拉"]')!
    expect(trigger).not.toBeNull()
    expect(trigger.matches(':disabled')).toBe(true)
    act(() => trigger.click())
    expect(container.querySelector('[data-option-value]')).toBeNull()
    act(() => root.render(<fieldset><Select ariaLabel="测试下拉" value="a" onChange={onChange} options={[{ label: 'A', value: 'a' }]} /></fieldset>))
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    act(() => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    act(() => root.render(<fieldset><Select ariaLabel="测试下拉" disabled value="a" onChange={onChange} options={[{ label: 'A', value: 'a' }]} /></fieldset>))
    expect(container.querySelector('[data-option-value]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it('键盘可选择可用项、不能选择禁用项，Escape 只关闭下拉', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onChange = vi.fn()
  const onEscape = vi.fn()
  window.addEventListener('keydown', onEscape)
  try {
    act(() => root.render(<Select ariaLabel="键盘测试" value="a" onChange={onChange} options={[
      { label: 'A', value: 'a' }, { label: 'B', value: 'b', disabled: true }, { label: 'C', value: 'c' },
    ]} />))
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    act(() => trigger.click())
    const disabled = container.querySelector<HTMLElement>('[data-option-value="b"]')!
    expect(disabled.tabIndex).toBe(-1)
    act(() => disabled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(onChange).not.toHaveBeenCalled()
    act(() => container.querySelector<HTMLElement>('[data-option-value="c"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('c')
    act(() => trigger.click())
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(onEscape).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
  } finally {
    window.removeEventListener('keydown', onEscape)
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
