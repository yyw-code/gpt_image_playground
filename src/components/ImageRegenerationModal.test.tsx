// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS } from '../lib/apiProfiles'

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../store', () => ({
  useStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
  getTaskApiProfile: (_settings: unknown, task: TaskRecord) => (mocks.state.settings as typeof DEFAULT_SETTINGS).profiles.find((profile) => profile.id === task.apiProfileId) ?? (mocks.state.settings as typeof DEFAULT_SETTINGS).profiles[0],
  submitImageRegeneration: vi.fn(async () => ['new']), stopBatchPrompts: vi.fn(),
}))
vi.mock('../lib/imageCache', () => ({ ensureImageCached: vi.fn(async () => 'data:image/png;base64,test'), cacheImage: vi.fn() }))
import ImageRegenerationModal from './ImageRegenerationModal'
import { submitImageRegeneration } from '../store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

/** 挂载独立草稿并模拟响应式 store 更新，不访问真实 API。 */
async function renderModal(batch = false, count = 1, sourceCount = batch ? 2 : 1) {
  const targets = (mocks.state.tasks as TaskRecord[]).flatMap((task) => task.outputImages.map((imageId, requestIndex) => ({ taskId: task.id, requestIndex, imageId }))).slice(0, sourceCount)
  mocks.state.imageRegeneration = { targets, mode: 'edit', prompt: '', promptMode: 'replace', count }
  mocks.state.setImageRegeneration = (draft: unknown) => { mocks.state.imageRegeneration = draft; root.render(<ImageRegenerationModal />) }
  await act(async () => root.render(<ImageRegenerationModal />))
}

beforeEach(() => {
  vi.clearAllMocks()
  const profile = createDefaultOpenAIProfile({ id: 'profile', codexCli: false })
  mocks.state = { settings: { ...DEFAULT_SETTINGS, profiles: [profile], agentProfiles: [] }, tasks: [{ id: 'source', prompt: '原提示词', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageIds: [], outputImages: ['a', 'b'], status: 'done', createdAt: 1 }], batchProgress: null, sketchBoard: null, setSketchBoard: vi.fn(), setDetailTaskId: vi.fn(), setConfirmDialog: vi.fn(), showToast: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

it('批量入口保留画板按钮，禁用并说明原因，数量按源图计算', async () => {
  await renderModal(true)
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes('画板标注'))!
  expect(button.disabled).toBe(true)
  expect(container.textContent).toContain('批量不支持画板标注')
  expect(container.textContent).toContain('共生成 2 张')
  await act(async () => button.click())
  expect(mocks.state.setSketchBoard).not.toHaveBeenCalled()
})

it('单图画板保存结果到独立草稿，参数数量不沿用原批次', async () => {
  await renderModal()
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes('画板标注'))!
  await act(async () => button.click())
  const request = vi.mocked(mocks.state.setSketchBoard as ReturnType<typeof vi.fn>).mock.calls[0][0]
  expect(request.onConfirm).toBeTypeOf('function')
  const layout = { width: 1200, height: 1800, imageBounds: { x: 100, y: 100, width: 900, height: 1500 } }
  await act(async () => request.onConfirm('data:image/png;base64,marked', [{ x: .5, y: .5, text: '改这里' }], layout))
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1, annotation: { comments: [{ text: '改这里' }] } })
  expect(container.textContent).toContain('1 条位置评论')
  await act(async () => [...container.querySelectorAll('button')].find((el) => el.textContent === '修改画板标注')!.click())
  expect(vi.mocked(mocks.state.setSketchBoard as ReturnType<typeof vi.fn>).mock.calls[1][0].layout).toEqual(layout)
})

it('按原输入重跑禁用画板，切回图片修改后恢复', async () => {
  await renderModal()
  const mode = (text: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === text)!
  await act(async () => mode('重新生成一张').click())
  expect(mode('画板标注').disabled).toBe(true)
  await act(async () => mode('修改这张图').click())
  expect(mode('画板标注').disabled).toBe(false)
})

/** 展开真实公共 Select 并点击选项，验证组件到独立草稿的完整交互。 */
async function selectOption(label: string, value: string) {
  await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const trigger = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  await act(async () => trigger.click())
  const option = trigger.parentElement!.querySelector<HTMLElement>(`[data-option-value="${value}"]`)!
  await act(async () => option.click())
  return option
}

it('复用原下拉组件，禁用选项可见且不能写草稿，支持配置恢复后可选择', async () => {
  const settings = mocks.state.settings as typeof DEFAULT_SETTINGS
  settings.profiles[0].codexCli = true
  settings.profiles.push(createDefaultOpenAIProfile({ id: 'native', name: '原生通道', codexCli: false }))
  await renderModal()
  expect(container.querySelectorAll('select')).toHaveLength(0)
  const quality = await selectOption('重生成质量', 'high')
  expect(quality.getAttribute('aria-disabled')).toBe('true')
  expect(quality.textContent).toContain('当前模型或通道不支持此参数')
  const format = await selectOption('重生成输出格式', 'webp')
  expect(format.getAttribute('aria-disabled')).toBe('true')
  expect((mocks.state.imageRegeneration as { params?: unknown }).params).toBeUndefined()
  await selectOption('重生成配置', 'gallery:native')
  await selectOption('重生成质量', 'high')
  await selectOption('重生成输出格式', 'webp')
  expect(mocks.state.imageRegeneration).toMatchObject({ params: { quality: 'high', output_format: 'webp' }, profile: { id: 'native' } })
})

it('各自保留参数时仍能修改生成数量，统一参数区保持禁用', async () => {
  await renderModal(true)
  expect(container.querySelector<HTMLInputElement>('[aria-label="每张源图生成数量"]')?.disabled).toBe(false)
  expect(container.querySelector('fieldset')?.disabled).toBe(true)
  expect(container.querySelector('fieldset')?.contains(container.querySelector('[aria-label="每张源图生成数量"]'))).toBe(false)
})

it('取消不发请求；有改动时经确认才放弃草稿', async () => {
  await renderModal()
  const rerun = [...container.querySelectorAll('button')].find((button) => button.textContent === '重新生成一张')!
  await act(async () => rerun.click())
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === '取消')!.click())
  expect(submitImageRegeneration).not.toHaveBeenCalled()
  expect(mocks.state.imageRegeneration).not.toBeNull()
  const confirm = vi.mocked(mocks.state.setConfirmDialog as ReturnType<typeof vi.fn>).mock.calls[0][0]
  await act(async () => confirm.action())
  expect(mocks.state.imageRegeneration).toBeNull()
})

it('提交失败显示错误并保留修改草稿', async () => {
  vi.mocked(submitImageRegeneration).mockRejectedValueOnce(new Error('来源图片已不存在'))
  await renderModal()
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === '生成新版本')!.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('来源图片已不存在')
  expect(mocks.state.imageRegeneration).not.toBeNull()
})

it('只展示两种操作和一个可输入的要求框，切换不丢失已输入文字', async () => {
  await renderModal()
  const input = container.querySelector<HTMLTextAreaElement>('#regeneration-prompt')!
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  expect(container.querySelector('#regeneration-prompt-help')?.textContent).toContain('本次要求')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '改成蓝色')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '重新生成一张')!.click())
  expect(input.disabled).toBe(false)
  expect(input.value).toBe('改成蓝色')
  expect(container.querySelector('#regeneration-prompt-help')?.textContent).toContain('不填则按原要求')
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '修改这张图')!.click())
  expect(input.value).toBe('改成蓝色')
  expect(input.disabled).toBe(false)
})

it.each([false, true])('旧草稿的隐藏提示词模式不能影响简化后的图片修改，批量=%s', async (batch) => {
  await renderModal(batch)
  const draft = mocks.state.imageRegeneration as Record<string, unknown>
  draft.promptMode = 'original'
  draft.prompt = '本次要求'
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('生成') && b.closest('footer'))!.click())
  expect(submitImageRegeneration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit', prompt: '本次要求', promptMode: 'replace' }))
})

it('重新生成自动使用原要求，允许填写追加要求，无需选择文字组合方式', async () => {
  await renderModal()
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '重新生成一张')!.click())
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '生成新版本')!.click())
  expect(submitImageRegeneration).toHaveBeenCalledWith(expect.objectContaining({ mode: 'rerun', prompt: '', promptMode: 'append' }))
})

/** 使用原生 setter 触发受控输入，避免 React 的 value tracker 吞掉测试事件。 */
async function enterCount(value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="每张源图生成数量"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

it('数量可清空后输入，不把空值写成零，空值期间禁止提交且不显示虚假总数', async () => {
  await renderModal()
  const input = await enterCount('')
  expect(input.value).toBe('')
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1 })
  const submit = [...container.querySelectorAll('footer button')].find((button) => button.textContent === '生成新版本') as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  expect(container.querySelector('footer')?.textContent).not.toContain('共生成')
  await act(async () => submit.click())
  expect(submitImageRegeneration).not.toHaveBeenCalled()
  await enterCount('2')
  expect(input.value).toBe('2')
  expect(submit.disabled).toBe(false)
  expect(container.textContent).toContain('共生成 2 张')
  await act(async () => submit.click())
  expect(submitImageRegeneration).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }))
})

it.each([['0002', '2'], ['02224', '10'], ['9999999999999999999999999999999999999999999', '10'], ['0', '1']])('数量输入 %s 规范为 %s', async (value, expected) => {
  await renderModal()
  expect((await enterCount(value)).value).toBe(expected)
  expect(mocks.state.imageRegeneration).toMatchObject({ count: Number(expected) })
})

it.each(['-1', '1.5', '1e2', 'NaN', 'Infinity', 'abc'])('拒绝非正整数输入 %s，不写入草稿', async (value) => {
  await renderModal()
  expect((await enterCount(value)).value).toBe('1')
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1 })
})

it('清空后失焦恢复 1，不遗留前导零', async () => {
  await renderModal(false, 3)
  const input = await enterCount('')
  await act(async () => { input.focus(); input.blur() })
  expect(input.value).toBe('1')
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1 })
})

it('批量上限按总数计算，改变选图后立即更新，既有超限值不能提交', async () => {
  await renderModal()
  const input = await enterCount('10')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择第 2 张源图"]')!.click())
  expect(input.value).toBe('10')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(container.textContent).toContain('每张最多 5 张')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(true)
  expect((await enterCount('6')).value).toBe('5')
  expect(container.textContent).toContain('共生成 10 张')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(false)
})

it('切换到更低数量限制的配置后提示超限，切回恢复，手动输入按配置限制', async () => {
  const settings = mocks.state.settings as typeof DEFAULT_SETTINGS
  settings.profiles.push(createDefaultFalProfile({ id: 'fal', name: 'FAL' }))
  await renderModal(false, 5)
  await selectOption('重生成配置', 'gallery:fal')
  expect(container.textContent).toContain('每张最多 4 张')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(true)
  await selectOption('重生成配置', '')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(false)
  await selectOption('重生成配置', 'gallery:fal')
  expect((await enterCount('8')).value).toBe('4')
})

it.each([0, -1, 1.5, 2224, NaN, Infinity])('旧草稿非法数量 %s 在页面禁止提交', async (count) => {
  await renderModal(false, count)
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(true)
  expect(container.querySelector('footer')?.textContent).not.toContain('共生成')
})

it('三张源图每张最多三张，不能向上取整突破总数上限', async () => {
  const task = (mocks.state.tasks as TaskRecord[])[0]
  task.outputImages.push('c')
  task.params.n = 3
  await renderModal(true, 1, 3)
  expect((await enterCount('4')).value).toBe('3')
  expect(container.textContent).toContain('共生成 9 张')
})

it('混合来源按更低的通道限制计算，切换预览不改变上限', async () => {
  const settings = mocks.state.settings as typeof DEFAULT_SETTINGS
  settings.profiles.push(createDefaultFalProfile({ id: 'fal', name: 'FAL' }))
  const task = (mocks.state.tasks as TaskRecord[])[0]
  task.outputImages = ['a']
  task.params.n = 1
  ;(mocks.state.tasks as TaskRecord[]).push({ ...task, id: 'fal-source', apiProfileId: 'fal', outputImages: ['b'] })
  await renderModal(true)
  expect((await enterCount('5')).value).toBe('4')
  await selectOption('预览来源图片', '1')
  expect(container.textContent).toContain('每张最多 4 张')
})

it('来源超过十张时提示取消多余选择，不出现零数量或启用提交', async () => {
  const task = (mocks.state.tasks as TaskRecord[])[0]
  task.outputImages = Array.from({ length: 11 }, (_, index) => `image-${index}`)
  task.params.n = 11
  await renderModal(true, 1, 11)
  expect(container.textContent).toContain('一次最多选择 10 张源图')
  expect((await enterCount('2')).value).toBe('1')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(true)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择第 11 张源图"]')!.click())
  expect(container.textContent).toContain('共生成 10 张')
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(false)
})

it('没有选中来源时禁止提交，不显示非有限总数', async () => {
  await renderModal()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择第 1 张源图"]')!.click())
  expect(container.querySelector('footer button:last-child')?.hasAttribute('disabled')).toBe(true)
  expect(container.querySelector('footer')?.textContent).not.toMatch(/NaN|Infinity/)
})

it('批量未统一参数时公共下拉保持禁用，统一后可选且不影响数量', async () => {
  await renderModal(true)
  const quality = container.querySelector<HTMLButtonElement>('[aria-label="重生成质量"]')!
  expect(quality.disabled).toBe(true)
  await act(async () => quality.click())
  expect(quality.parentElement!.querySelector('[data-option-value]')).toBeNull()
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1 })
  const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((el) => el.parentElement?.textContent?.includes('统一设置以下参数'))!
  await act(async () => checkbox.click())
  expect(quality.disabled).toBe(false)
  await selectOption('重生成质量', 'high')
  expect(mocks.state.imageRegeneration).toMatchObject({ count: 1, params: { quality: 'high', n: 1 } })
})

it('公共模型下拉更新模型，更多参数的下拉保留原样式和禁用态', async () => {
  ;(mocks.state.settings as typeof DEFAULT_SETTINGS).profiles[0].model = 'gpt-image-2,gpt-image-1.5'
  await renderModal()
  await selectOption('重生成模型', 'gpt-image-1.5')
  expect(mocks.state.imageRegeneration).toMatchObject({ profile: { model: 'gpt-image-1.5' } })
  expect(container.querySelector<HTMLButtonElement>('[aria-label="重生成构图复杂度"]')?.disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('[aria-label="重生成内容审核"]')?.disabled).toBe(false)
  await selectOption('重生成内容审核', 'low')
  expect(mocks.state.imageRegeneration).toMatchObject({ params: { moderation: 'low' } })
})
