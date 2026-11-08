// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'

vi.mock('../store', () => ({
  useStore: (select: (state: unknown) => unknown) => select({ settings: DEFAULT_SETTINGS, streamPreviews: {}, toggleTaskSelection: vi.fn(), openFavoritePicker: vi.fn() }),
  retryTask: vi.fn(),
}))
vi.mock('../hooks/useNearViewport', () => ({ useNearViewport: () => true }))
vi.mock('../lib/imageCache', () => ({
  ensureImageThumbnailCached: async () => ({ src: 'data:image/png;base64,test', width: 1024, height: 1024 }),
  subscribeImageThumbnail: () => () => {},
}))
import TaskCard from './TaskCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot> | undefined
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })

/** 挂载真实任务卡，验证中断恢复后的封面、补图入口及计时。 */
async function renderTask(overrides: Partial<TaskRecord>) {
  const task: TaskRecord = { id: 'task', prompt: 'test', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageIds: [], outputImages: [], status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null, ...overrides }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />))
  return container
}

describe('批量任务卡恢复', () => {
  it('新任务展示准确目标比例，不把建议请求像素当作承诺尺寸', async () => {
    const container = await renderTask({
      params: { ...DEFAULT_PARAMS, n: 1, size: '1536x864', imageAspectRatio: '16:9' },
      imageParameterMode: 'composition', status: 'done', outputImages: ['first'], actualParams: { size: '1672x941' },
    })
    expect(container.textContent).toContain('比例16:9')
    expect(container.textContent).not.toContain('1536x864')
    expect(container.textContent).not.toContain('≈16:9')
    expect(container.textContent).not.toContain('参数与设置不符')
  })

  it('只统计不符的图片，缺少逐图回显时标记未验证并保留成功结果', async () => {
    const container = await renderTask({
      status: 'done', params: { ...DEFAULT_PARAMS, n: 3, size: '1024x1024', quality: 'high' },
      outputImages: ['first', 'second', 'third'],
      actualParams: { size: '1024x1024', quality: 'high', output_format: 'png' },
      actualParamsByImage: {
        first: { size: '1024x1024', quality: 'high', output_format: 'png' },
        second: { size: '1024x1024', quality: 'low', output_format: 'png' },
      },
    })
    expect(container.textContent).toContain('参数与设置不符 1 张')
    expect(container.textContent).toContain('部分参数未验证 1 张')
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('[aria-label^="补齐未完成"]')).toBeNull()
  })

  it('首帧时钟早于请求发送时显示零，不出现负耗时', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const container = await renderTask({ startedAt: 1001 })
    expect(container.textContent).toContain('00:00')
    expect(container.textContent).not.toContain('-1')
  })

  it('中断任务保留成功封面，并明确只补缺失的图片', async () => {
    const container = await renderTask({ status: 'error', error: '请求中断', outputImages: ['saved'], outputErrors: [{ requestIndex: 1, error: 'pending' }, { requestIndex: 2, error: 'pending' }] })
    expect(container.textContent).toContain('部分成功')
    expect(container.textContent).toContain('已成功 1/3')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,test')
    expect(container.querySelector('[aria-label="补齐未完成的 2 张"]')).not.toBeNull()
  })
})
