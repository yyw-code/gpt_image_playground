// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from '../../lib/apiProfiles'
import type { AppSettings } from '../../types'
import AgentSettingsTab from './AgentSettingsTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/** 使用真实设置组件和状态，验证 Agent 配置的编辑、新建、复制和选择隔离。 */
function renderAgentSettings(withProfiles: boolean, overrides: Partial<AppSettings> = {}) {
  const text = createDefaultOpenAIProfile({ id: 'text', name: '文本配置', apiMode: 'responses', apiKey: 'fixture-text' })
  const image = createDefaultOpenAIProfile({ id: 'image', name: '图像配置', apiKey: 'fixture-image' })
  let latest = normalizeSettings({ profiles: [image], agentProfiles: withProfiles ? [text, image] : [], agentTextProfileId: withProfiles ? 'text' : null, agentImageProfileId: withProfiles ? 'image' : null, agentApiConfigMode: 'hybrid', ...overrides })
  const commit = vi.fn()
  const remove = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  /** 只在提交时归一化；输入期间保留草稿，与实际设置页一致。 */
  function Harness() {
    const [draft, setDraft] = useState(latest)
    latest = draft
    return <AgentSettingsTab draft={draft} agentMaxToolRoundsInput="15" setAgentMaxToolRoundsInput={vi.fn()} updateAgentApiConfigMode={(mode) => setDraft({ ...draft, agentApiConfigMode: mode })} changeSettings={setDraft} commitSettings={(next) => { commit(next); setDraft(normalizeSettings(next)) }} commitAgentMaxToolRounds={vi.fn()} onDeleteProfile={remove} />
  }
  act(() => root!.render(<Harness />))
  return { container, commit, remove, latest: () => latest }
}

/** 通过真实 DOM 输入事件修改受控输入，避免直接调用组件内部实现。 */
function fill(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}

describe('Agent 独立配置', () => {
  it('图片配置的生图类型简化为 ChatGPT 和 Grok', () => {
    const p = renderAgentSettings(true)
    act(() => p.container.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!.click())
    const control = [...p.container.querySelectorAll('label')].find((label) => label.textContent?.startsWith('生图类型'))!
    act(() => control.querySelector<HTMLElement>('.cursor-pointer')!.click())
    expect(control.textContent).toContain('ChatGPT')
    expect(control.textContent).toContain('Grok')
    expect(control.textContent).not.toContain('兼容接口')
    expect(control.textContent).not.toContain('Sub2API')
    expect(p.commit).not.toHaveBeenCalled()
  })

  it('默认只展示列表，编辑后打开弹窗，Escape 关闭并恢复列表焦点', () => {
    const p = renderAgentSettings(true)
    expect(p.container.querySelector('[role="dialog"]')).toBeNull()
    expect(p.container.querySelector('[aria-label="Agent 图片 API Key"]')).toBeNull()
    const edit = p.container.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!
    act(() => { edit.focus(); edit.click() })
    expect(p.container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭配置编辑')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(p.container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(edit)
    expect(p.latest().agentImageProfileId).toBe('image')
  })

  it('关闭弹窗前保存未失焦的输入，不自动启用编辑项', () => {
    const p = renderAgentSettings(true, { agentImageProfileId: null })
    act(() => p.container.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!.click())
    const input = p.container.querySelector<HTMLInputElement>('[aria-label="Agent 图片配置名称"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新的图片配置名称')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => p.container.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    expect(p.latest().agentProfiles.find((profile) => profile.id === 'image')?.name).toBe('新的图片配置名称')
    expect(p.latest().agentImageProfileId).toBeNull()
    expect(p.commit).toHaveBeenCalledOnce()
    expect(p.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('未启用图片配置时显示选择提示，浏览列表后仍需显式启用', () => {
    const p = renderAgentSettings(true, { agentImageProfileId: null })
    const section = p.container.querySelector('[aria-label="Agent 图片配置"]')!
    expect(section.querySelector('[aria-label="Agent 图片 API Key"]')).toBeNull()
    expect(section.textContent).toContain('尚未启用图片配置')
    act(() => section.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!.click())
    expect(section.querySelector('[aria-label="Agent 图片 API Key"]')).not.toBeNull()
    expect(p.latest().agentImageProfileId).toBeNull()
    expect(p.commit).not.toHaveBeenCalled()
  })

  it('以列表展示配置及模型，浏览配置不改变当前使用项，密钥不出现在列表中', () => {
    const p = renderAgentSettings(true)
    const list = p.container.querySelector('[aria-label="Agent 图片配置列表"]')!
    expect(list).not.toBeNull()
    expect(list.textContent).toContain('图像配置')
    expect(list.textContent).toContain('当前使用')
    expect(list.textContent).not.toContain('fixture-image')
    act(() => list.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「文本配置」"]')!.click())
    expect(p.latest().agentImageProfileId).toBe('image')
    const use = [...p.container.querySelector('[aria-label="Agent 图片配置"]')!.querySelectorAll('button')].find((button) => button.textContent === '使用此图片配置')!
    act(() => use.click())
    expect(p.latest().agentImageProfileId).toBe('text')
    expect(p.latest().activeProfileId).toBe('image')
  })

  it('切换编辑项时恢复密钥遮挡，防止沿用上一配置的明文显示状态', () => {
    const p = renderAgentSettings(true)
    const section = p.container.querySelector('[aria-label="Agent 图片配置"]')!
    act(() => section.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!.click())
    act(() => [...section.querySelectorAll('button')].find((item) => item.textContent === '显示')!.click())
    expect(section.querySelector('[aria-label="Agent 图片 API Key"]')).toHaveProperty('type', 'text')
    act(() => section.querySelector<HTMLButtonElement>('[aria-label="关闭配置编辑"]')!.click())
    act(() => section.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「文本配置」"]')!.click())
    expect(section.querySelector('[aria-label="Agent 图片 API Key"]')).toHaveProperty('type', 'password')
    expect(p.latest().agentImageProfileId).toBe('image')
  })

  it('缺少配置时可直接创建对话配置，密钥为空且不改变图片配置', () => {
    const p = renderAgentSettings(false)
    expect(p.container.textContent).toContain('不会使用画廊的当前配置')
    const button = [...p.container.querySelectorAll('button')].find((item) => item.textContent === '新建对话配置')!
    act(() => button.click())
    expect(p.latest().agentProfiles).toHaveLength(1)
    expect(p.latest().agentProfiles[0]).toMatchObject({ apiMode: 'responses', apiKey: '' })
    expect(p.latest().agentTextProfileId).toBeNull()
    const use = [...p.container.querySelectorAll('button')].find((item) => item.textContent === '使用此对话配置')!
    act(() => use.click())
    expect(p.latest().agentTextProfileId).toBe(p.latest().agentProfiles[0].id)
    expect(p.latest().profiles[0].apiKey).toBe('fixture-image')
    expect(p.container.textContent).not.toContain('管理 API 配置')
  })

  it('编辑 Agent 的密钥和名称，不改变画廊的同 ID 配置', () => {
    const p = renderAgentSettings(true)
    act(() => p.container.querySelector<HTMLButtonElement>('[aria-label="编辑 Agent 图片配置「图像配置」"]')!.click())
    fill(p.container.querySelector<HTMLInputElement>('[aria-label="Agent 图片 API Key"]')!, 'fixture-agent-updated')
    fill(p.container.querySelector<HTMLInputElement>('[aria-label="Agent 图片配置名称"]')!, 'Agent 专用')
    expect(p.latest().agentProfiles.find((profile) => profile.id === 'image')).toMatchObject({ apiKey: 'fixture-agent-updated', name: 'Agent 专用' })
    expect(p.latest().profiles[0]).toMatchObject({ apiKey: 'fixture-image', name: '图像配置' })
  })

  it('复制画廊配置生成独立 ID，删除按钮先请求确认', () => {
    const p = renderAgentSettings(true)
    const section = p.container.querySelector<HTMLElement>('[aria-label="Agent 图片配置"]')!
    const trigger = [...section.querySelectorAll<HTMLElement>('.cursor-pointer')].find((item) => item.textContent === '从图片配置复制…')!
    act(() => trigger.click())
    act(() => section.querySelector<HTMLElement>('[data-option-value="image"]')!.click())
    const copied = p.latest().agentProfiles[p.latest().agentProfiles.length - 1]
    expect(p.latest().agentImageProfileId).toBe('image')
    expect(copied.id).not.toBe('image')
    expect(copied).toMatchObject({ apiKey: 'fixture-image', name: '图像配置（Agent 副本）' })
    const button = [...section.querySelectorAll('button')].find((item) => item.textContent === '删除此 Agent 配置')!
    act(() => button.click())
    expect(p.remove).toHaveBeenCalledWith(copied)
    expect(p.latest().agentProfiles).toHaveLength(3)
  })
})
