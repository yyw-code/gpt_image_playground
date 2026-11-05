import { describe, expect, it, vi } from 'vitest'
import { enqueueImageRequest } from './imageRequestQueue'

describe('页面图片请求队列', () => {
  it('跨任务串行，失败释放队列，取消的等待项不发送', async () => {
    let release!: () => void
    const first = enqueueImageRequest(() => new Promise<void>((resolve) => { release = resolve }))
    const cancelled = new AbortController()
    const skipped = vi.fn(async () => 'skipped')
    const second = enqueueImageRequest(skipped, { signal: cancelled.signal }).catch((error) => error)
    const failed = enqueueImageRequest(async () => { throw new Error('429') }).catch((error) => error)
    const lastWorker = vi.fn(async () => 'last')
    const last = enqueueImageRequest(lastWorker)
    cancelled.abort()
    expect(skipped).not.toHaveBeenCalled()
    expect(lastWorker).not.toHaveBeenCalled()
    release()
    await first
    expect((await second).name).toBe('AbortError')
    expect((await failed).message).toBe('429')
    expect(await last).toBe('last')
  })

  it('排队期间不启动请求计时，并通知等待位置和实际开始', async () => {
    let release!: () => void
    const first = enqueueImageRequest(() => new Promise<void>((resolve) => { release = resolve }))
    const events = vi.fn()
    const worker = vi.fn(async () => 2)
    const second = enqueueImageRequest(worker, { onState: events })
    expect(events).toHaveBeenCalledWith('queued', 1)
    expect(worker).not.toHaveBeenCalled()
    release()
    await first
    expect(await second).toBe(2)
    expect(events).toHaveBeenCalledWith('running', 0)
  })
})

it('Grok 全页面共享两个槽位，一张完成立即补位且不影响 GPT', async () => {
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
  const secondWorker = vi.fn(() => secondGate)
  const first = enqueueImageRequest(() => firstGate, { lane: 'grok' })
  const second = enqueueImageRequest(secondWorker, { lane: 'grok' })
  const next = vi.fn(async () => 'third')
  const third = enqueueImageRequest(next, { lane: 'grok' })
  try {
    expect(secondWorker).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    expect(await enqueueImageRequest(async () => 'GPT')).toBe('GPT')
    releaseSecond()
    await second
    expect(await third).toBe('third')
  } finally { releaseFirst(); releaseSecond(); await Promise.all([first, second, third]) }
})
