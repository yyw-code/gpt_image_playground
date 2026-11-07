import { describe, expect, it, vi } from 'vitest'
import { enqueueImageRequest } from './imageRequestQueue'

describe.each(['openai', 'grok'] as const)('%s 页面图片请求队列', (lane) => {
  it('跨任务共享十个槽位，第十一个等待，任一完成立即补位', async () => {
    const releases: (() => void)[] = []
    const workers = Array.from({ length: 10 }, () => {
      const gate = new Promise<void>((resolve) => { releases.push(resolve) })
      return vi.fn(() => gate)
    })
    const running = workers.map((worker) => enqueueImageRequest(worker, { lane }))
    const events = vi.fn()
    const next = vi.fn(async () => 'eleventh')
    const eleventh = enqueueImageRequest(next, { lane, onState: events })
    try {
      workers.forEach((worker) => expect(worker).toHaveBeenCalledOnce())
      expect(next).not.toHaveBeenCalled()
      expect(events).toHaveBeenCalledWith('queued', 1)
      releases[2]()
      await running[2]
      expect(await eleventh).toBe('eleventh')
      expect(events).toHaveBeenCalledWith('running', 0)
    } finally {
      releases.forEach((release) => release())
      await Promise.all([...running, eleventh])
    }
  })

  it('取消等待项不发送，失败释放槽位并继续后续任务', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const running = Array.from({ length: 10 }, () => enqueueImageRequest(() => gate, { lane }))
    const cancelled = new AbortController()
    const skipped = vi.fn(async () => 'skipped')
    const pending = enqueueImageRequest(skipped, { lane, signal: cancelled.signal }).catch((error) => error)
    const failed = enqueueImageRequest(async () => { throw new Error('429') }, { lane }).catch((error) => error)
    const lastWorker = vi.fn(async () => 'last')
    const last = enqueueImageRequest(lastWorker, { lane })
    try {
      cancelled.abort()
      expect(skipped).not.toHaveBeenCalled()
      expect(lastWorker).not.toHaveBeenCalled()
      release()
      expect((await pending).name).toBe('AbortError')
      expect((await failed).message).toBe('429')
      expect(await last).toBe('last')
    } finally {
      release()
      await Promise.all([...running, pending, failed, last])
    }
  })

  it('已取消的请求不占用槽位或发送请求', async () => {
    const controller = new AbortController()
    controller.abort()
    const worker = vi.fn(async () => 'unexpected')
    await expect(enqueueImageRequest(worker, { lane, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker).not.toHaveBeenCalled()
  })
})

it('GPT 与 Grok 分别共享十个前端槽位', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const workers = Array.from({ length: 20 }, () => vi.fn(() => gate))
  const requests = workers.map((worker, index) => enqueueImageRequest(worker, { lane: index < 10 ? 'openai' : 'grok' }))
  try {
    workers.forEach((worker) => expect(worker).toHaveBeenCalledOnce())
  } finally {
    release()
    await Promise.all(requests)
  }
})
