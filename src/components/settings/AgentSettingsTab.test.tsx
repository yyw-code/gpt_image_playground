// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from '../../lib/apiProfiles'
import AgentSettingsTab from './AgentSettingsTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/** 渲染真实 Agent 设置及下拉框，验证已存配置选择和 API 管理导航。 */
function renderAgentSettings(withProfiles: boolean) {
  const text = createDefaultOpenAIProfile({ id: 'text', name: '文本配置', apiMode: 'responses', apiKey: 'text-key' })
  const image = createDefaultOpenAIProfile({ id: 'image', name: '图像配置', apiKey: 'image-key' })
  const draft = normalizeSettings({ profiles: [text, image], agentApiConfigMode: 'hybrid' })
  const commit = vi.fn()
  const edit = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<AgentSettingsTab
    draft={draft}
    agentMaxToolRoundsInput="15"
    agentTextProfileOptions={withProfiles ? [{ label: text.name, value: text.id }] : []}
    agentImageProfileOptions={withProfiles ? [{ label: image.name, value: image.id }] : []}
    selectedAgentTextProfile={withProfiles ? text : null}
    selectedAgentImageProfile={withProfiles ? image : null}
    setAgentMaxToolRoundsInput={vi.fn()}
    updateAgentApiConfigMode={vi.fn()}
    commitSettings={commit}
    commitAgentMaxToolRounds={vi.fn()}
    onEditApiProfiles={edit}
  />))
  return { container, commit, edit }
}

describe('Agent 配置入口', () => {
  it('无可用配置时解释准备条件，并可返回 API 页维护配置', () => {
    const { container, edit } = renderAgentSettings(false)
    expect(container.textContent).toContain('选择 Responses API')
    expect(container.textContent).toContain('保存一套图像配置')
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === '管理 API 配置')!
    act(() => button.click())
    expect(edit).toHaveBeenCalledOnce()
  })

  it('文本和图像均能从已存配置中选择并保存引用', () => {
    const { container, commit } = renderAgentSettings(true)
    for (const [label, id] of [['文本配置', 'text'], ['图像配置', 'image']]) {
      const trigger = [...container.querySelectorAll<HTMLDivElement>('div.cursor-pointer')].find((item) => item.textContent?.trim() === label)!
      act(() => trigger.click())
      const option = container.querySelector<HTMLDivElement>(`[data-option-value="${id}"]`)!
      act(() => option.click())
    }
    expect(commit).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentTextProfileId: 'text' }))
    expect(commit).toHaveBeenNthCalledWith(2, expect.objectContaining({ agentImageProfileId: 'image' }))
  })
})
