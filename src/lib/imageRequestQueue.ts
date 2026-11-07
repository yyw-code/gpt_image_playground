interface QueueOptions {
  /** 同页 Grok 与 OpenAI/Agent 分别共享十个槽位，后端仍可施加统一限流。 */
  lane?: 'openai' | 'grok'
  signal?: AbortSignal
  isCancelled?: () => boolean
  onState?: (state: 'queued' | 'running' | 'finished', position: number) => void
}

interface QueueEntry {
  options: QueueOptions
  start: () => Promise<void>
  cancel: () => void
}

const waiting: QueueEntry[] = []
const active = { openai: 0, grok: 0 }
// 每条供应商队列的页面并发上限，跨任务共用，不能绕过服务端配额。
const IMAGE_REQUEST_CONCURRENCY = 10

/** 更新等待位置并启动最早的有效请求；同页按供应商共享有界执行槽位。 */
function drainImageQueue() {
  for (const entry of [...waiting]) {
    if (entry.options.signal?.aborted || entry.options.isCancelled?.()) entry.cancel()
  }
  waiting.forEach((entry, index) => entry.options.onState?.('queued', index + 1))
  const index = waiting.findIndex((entry) => {
    const lane = entry.options.lane ?? 'openai'
    return active[lane] < IMAGE_REQUEST_CONCURRENCY
  })
  if (index < 0) return
  const [next] = waiting.splice(index, 1)
  const lane = next.options.lane ?? 'openai'
  active[lane]++
  void next.start().finally(() => {
    active[lane]--
    drainImageQueue()
  })
  drainImageQueue()
}

/** 将单图请求加入 FIFO 队列，实际启动后才运行 worker 内的超时；等待取消不调用接口。 */
export function enqueueImageRequest<T>(worker: () => Promise<T>, options: QueueOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const removeAbortListener = () => options.signal?.removeEventListener('abort', entry.cancel)
    const entry: QueueEntry = {
      options,
      cancel: () => {
        const index = waiting.indexOf(entry)
        if (index < 0) return
        waiting.splice(index, 1)
        removeAbortListener()
        options.onState?.('finished', 0)
        waiting.forEach((item, position) => item.options.onState?.('queued', position + 1))
        reject(new DOMException('任务已取消', 'AbortError'))
      },
      start: async () => {
        removeAbortListener()
        try {
          options.onState?.('running', 0)
          resolve(await worker())
        } catch (error) {
          reject(error)
        } finally {
          options.onState?.('finished', 0)
        }
      },
    }
    waiting.push(entry)
    options.signal?.addEventListener('abort', entry.cancel, { once: true })
    drainImageQueue()
  })
}
