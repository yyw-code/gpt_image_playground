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
  it('首帧时钟早于请求发送时显示零，不出现负耗时', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const container = await renderTask({ startedAt: 1001 })
    expect(container.textContent).toContain('00:00')
    expect(container.textContent).not.toContain('-1')
  })

  it('中断任务保留成功封面，并明确只补缺失的图片', async () => {
    const container = await renderTask({ status: 'error', error: '请求中断', outputImages: ['saved'], outputErrors: [{ requestIndex: 1, error: 'pending' }, { requestIndex: 2, error: 'pending' }] })
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,test')
    expect(container.querySelector('[aria-label="重试失败的 2 张"]')).not.toBeNull()
  })
})
