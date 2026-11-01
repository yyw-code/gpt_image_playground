// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import { fetchApiModels } from '../../lib/apiModels'
import type { ApiProfile } from '../../types'
import ApiModelFields from './ApiModelFields'

vi.mock('../../lib/apiModels', () => ({ fetchApiModels: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | null = null
const fetchMock = vi.mocked(fetchApiModels)
const profile = createDefaultOpenAIProfile({ id: 'first', apiKey: 'fixture-first', model: 'saved-model', apiMode: 'responses', imageGenerationModel: '' })

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

/** 挂载真实查询及字段组件，可切换连接，验证异步响应不跨配置显示。 */
function renderFields() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const change = vi.fn()
  const commit = vi.fn()
  /** 复用同一组件实例切换配置或密钥，覆盖响应竞态与锁定策略。 */
  const render = (next = profile, locked = false) => act(() => root!.render(<ApiModelFields profile={next} locked={locked} onChange={change} onCommit={commit} />))
  render()
  return { container, change, commit, render }
}

describe('当前配置的模型查询状态', () => {
  it('仅在用户点击时查询，成功不覆盖模型或空工具模型，两个选择器共享候选', async () => {
    fetchMock.mockResolvedValue(['text-discovered', 'image-discovered'])
    const p = renderFields()
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => p.container.querySelector('button')!.click())
    expect(fetchMock).toHaveBeenCalledWith(profile, expect.any(AbortSignal))
    expect(p.container.textContent).toContain('已获取 2 个模型')
    for (const label of ['模型 ID', '图像生成模型']) {
      act(() => p.container.querySelector<HTMLButtonElement>(`[aria-label="选择${label}"]`)!.click())
    }
    expect(p.container.querySelectorAll('[role="option"]')).toHaveLength(6)
    expect(p.container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('saved-model')
    expect(p.change).not.toHaveBeenCalled()
    expect(p.commit).not.toHaveBeenCalled()
  })

  it.each(['id', 'apiKey', 'baseUrl', 'apiProxy'] as const)('改变 %s 后取消旧请求，迟到结果不污染新配置', async (field) => {
    let finish!: (models: string[]) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const p = renderFields()
    act(() => p.container.querySelector('button')!.click())
    const signal = fetchMock.mock.calls[0][1]!
    const next: ApiProfile = { ...profile, [field]: field === 'apiProxy' ? !profile.apiProxy : 'changed-fixture' }
    p.render(next)
    expect(signal.aborted).toBe(true)
    await act(async () => finish(['old-model-discovered']))
    expect(p.container.textContent).not.toContain('已获取')
    act(() => p.container.querySelector<HTMLButtonElement>('[aria-label="选择模型 ID"]')!.click())
    expect(p.container.textContent).not.toContain('old-model-discovered')
    expect(p.commit).not.toHaveBeenCalled()
  })

  it('空列表、失败和重试均保留旧值，错误状态允许重新获取', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('模型查询被拒绝')).mockResolvedValueOnce(['retry-model'])
    const p = renderFields()
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('接口未返回模型')
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('模型查询被拒绝')
    expect(p.container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('saved-model')
    await act(async () => p.container.querySelector('button')!.click())
    expect(p.container.textContent).toContain('已获取 1 个模型')
    expect(p.commit).not.toHaveBeenCalled()
  })

  it('卸载取消请求，缺少 Key 或锁定时不允许查询', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const p = renderFields()
    p.render({ ...profile, apiKey: '' })
    expect(p.container.querySelector('button')!.disabled).toBe(true)
    p.render(profile, true)
    expect(p.container.querySelector('button')!.disabled).toBe(true)
    p.render()
    act(() => p.container.querySelector('button')!.click())
    const signal = fetchMock.mock.calls[0][1]!
    act(() => root!.unmount())
    root = null
    expect(signal.aborted).toBe(true)
  })

  it('Images 模式只显示主模型，其他供应商沿用手动填写', () => {
    const p = renderFields()
    p.render({ ...profile, apiMode: 'images' })
    expect(p.container.querySelector('[aria-label="选择图像生成模型"]')).toBeNull()
    p.render({ ...profile, provider: 'fal' })
    expect(p.container.querySelector('button')).toBeNull()
    expect(p.container.querySelector('input')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
