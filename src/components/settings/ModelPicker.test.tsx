// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ModelPicker from './ModelPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/** 通过原生输入事件驱动真实受控组件，覆盖手动输入、筛选和保存行为。 */
function enter(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 挂载使用真实状态的选择器，避免仅验证回调而遗漏旧值覆盖和多选行为。 */
function renderPicker(initial = 'legacy-model', multiple = true, disabled = false) {
  const commit = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  /** 模拟设置页把输入同步到草稿，再在失焦或选择时持久化。 */
  function Harness() {
    const [value, setValue] = useState(initial)
    return <ModelPicker label="测试模型" value={value} models={['text-model', 'image-model']} placeholder="输入模型" disabled={disabled} multiple={multiple} allowDefault={!multiple} onChange={setValue} onCommit={commit} />
  }
  act(() => root!.render(<Harness />))
  return { container, commit, input: container.querySelector('input')!, toggle: container.querySelector('button')! }
}

describe('模型搜索选择及手动输入', () => {
  it('候选中保留接口未返回的旧值，多选增加和取消不覆盖其他模型', () => {
    const p = renderPicker()
    act(() => p.toggle.click())
    expect(p.container.textContent).toContain('已保存')
    const option = [...p.container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes('text-model'))!
    act(() => option.click())
    expect(p.input.value).toBe('legacy-model, text-model')
    expect(p.commit).toHaveBeenLastCalledWith('legacy-model, text-model')
    act(() => option.click())
    expect(p.input.value).toBe('legacy-model')
  })

  it('搜索不修改已保存模型，键盘确认添加匹配候选', () => {
    const p = renderPicker()
    act(() => p.toggle.click())
    const search = p.container.querySelector<HTMLInputElement>('input[type="search"]')!
    enter(search, 'IMAGE')
    expect(p.container.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(p.input.value).toBe('legacy-model')
    expect(p.commit).not.toHaveBeenCalled()
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(p.input.value).toBe('legacy-model, image-model')
  })

  it('手动输入自定义模型和中文逗号继续可用，失焦时提交实际输入', () => {
    const p = renderPicker()
    enter(p.input, 'custom-one，custom-two')
    expect(p.input.value).toBe('custom-one，custom-two')
    act(() => p.input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(p.commit).toHaveBeenLastCalledWith('custom-one，custom-two')
  })

  it('工具模型可单选，也可明确选择接口默认值并保存空字符串', () => {
    const p = renderPicker('old-image', false)
    act(() => p.toggle.click())
    const option = [...p.container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes('image-model'))!
    act(() => option.click())
    expect(p.input.value).toBe('image-model')
    expect(p.container.querySelector('[role="listbox"]')).toBeNull()
    act(() => p.toggle.click())
    act(() => p.container.querySelector<HTMLButtonElement>('[role="option"]')!.click())
    expect(p.input.value).toBe('')
    expect(p.commit).toHaveBeenLastCalledWith('')
  })

  it('锁定配置不能编辑或展开候选', () => {
    const p = renderPicker('old-image', false, true)
    expect(p.input.disabled).toBe(true)
    expect(p.toggle.disabled).toBe(true)
    act(() => p.toggle.click())
    expect(p.container.querySelector('[role="listbox"]')).toBeNull()
  })

  it('无匹配模型时保留已输入值，Escape 关闭候选列表', () => {
    const p = renderPicker()
    act(() => p.toggle.click())
    const search = p.container.querySelector<HTMLInputElement>('input[type="search"]')!
    enter(search, 'unknown-alias')
    expect(p.container.textContent).toContain('没有匹配模型')
    expect(p.input.value).toBe('legacy-model')
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(p.container.querySelector('[role="listbox"]')).toBeNull()
    expect(p.commit).not.toHaveBeenCalled()
  })
})
