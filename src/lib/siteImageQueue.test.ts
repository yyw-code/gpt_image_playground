import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { callAgentResponsesApi, callBatchImageSingle } from './agentApi'
import { setSiteConnection } from './siteProfiles'

vi.mock('./siteMode', () => ({ IS_SITE_MODE: true }))

const profile = createDefaultOpenAIProfile({ baseUrl: 'https://queue.example/v1', apiKey: 'test-key', codexCli: false, streamImages: false, timeout: 60 })
setSiteConnection(profile)

/** 返回离线图片响应，同时兼容 Images 与 Responses，避免真实请求和费用。 */
function response() {
  return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }], output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }] }), { headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('多图 Images、其他任务的 Responses 和 Agent 单图工具共用 FIFO 串行队列', async () => {
  let release!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve })).mockImplementation(async () => response())
  const events = vi.fn()
  const images = callImageApi({ settings: normalizeSettings({ profiles: [profile] }), prompt: 'first', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageDataUrls: [], onRequestState: events })
  const responsesProfile = { ...profile, apiMode: 'responses' as const }
  const responses = callImageApi({ settings: normalizeSettings({ profiles: [responsesProfile] }), prompt: 'second', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
  const agent = callBatchImageSingle({ profile: responsesProfile, params: DEFAULT_PARAMS, batchItemId: 'agent', prompt: 'third', referenceImageDataUrls: [] })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ requestIndex: 1, state: 'queued' }))
  release(response())
  const results = await Promise.all([images, responses, agent])
  expect(results[0].images).toHaveLength(2)
  expect(results[1].images).toHaveLength(1)
  expect(results[2].image).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(4)
  const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
  expect(bodies.slice(0, 2).every((body) => body.prompt.includes('first') && (body.n === 1 || body.n === undefined))).toBe(true)
  expect(String(bodies[2].input)).toContain('second')
  expect(String(bodies[3].input)).toContain('third')
})

it('排队超过单次超时仍不会发送或计时，发送后才开始超时，失败释放队列', async () => {
  vi.useFakeTimers()
  let release!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
    .mockImplementationOnce((_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    .mockImplementation(async () => response())
  const first = callImageApi({ settings: normalizeSettings({ profiles: [profile] }), prompt: 'hold', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
  const short = { ...profile, timeout: 1 }
  const second = callImageApi({ settings: normalizeSettings({ profiles: [short] }), prompt: 'timeout', params: DEFAULT_PARAMS, inputImageDataUrls: [] }).catch((error: Error) => error)
  const third = callBatchImageSingle({ profile: { ...profile, apiMode: 'responses' }, params: DEFAULT_PARAMS, batchItemId: 'last', prompt: 'after failure', referenceImageDataUrls: [] })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  release(response())
  await first
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await second).toBeInstanceOf(Error)
  expect((await third).image).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('取消等待任务后不发送其请求，后续任务继续执行', async () => {
  let release!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve })).mockImplementation(async () => response())
  const opts = { settings: normalizeSettings({ profiles: [profile] }), prompt: 'image', params: DEFAULT_PARAMS, inputImageDataUrls: [] }
  const first = callImageApi(opts)
  const controller = new AbortController()
  const cancelled = callImageApi({ ...opts, signal: controller.signal }).catch((error: Error) => error)
  const last = callImageApi(opts)
  controller.abort()
  expect(await cancelled).toMatchObject({ name: 'AbortError' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  release(response())
  await Promise.all([first, last])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('Agent 卡片删除后在出队前跳过请求，同轮其他图片继续执行', async () => {
  let release!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve })).mockImplementation(async () => response())
  const first = callImageApi({ settings: normalizeSettings({ profiles: [profile] }), prompt: 'hold', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
  let deleted = false
  const opts = { profile: { ...profile, apiMode: 'responses' as const }, params: DEFAULT_PARAMS, batchItemId: 'deleted', prompt: 'deleted', referenceImageDataUrls: [] }
  const cancelled = callBatchImageSingle({ ...opts, isCancelled: () => deleted }).catch((error: Error) => error)
  const last = callBatchImageSingle({ ...opts, batchItemId: 'live', prompt: 'live' })
  deleted = true
  release(response())
  const [, skipped, result] = await Promise.all([first, cancelled, last])
  expect(skipped).toMatchObject({ name: 'AbortError' })
  expect(result.image).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('原生 Agent 图片工具也排队，混合模式的纯文本推理仍可直接执行', async () => {
  let release!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve })).mockImplementation(async () => response())
  const first = callImageApi({ settings: normalizeSettings({ profiles: [profile] }), prompt: 'hold', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
  const opts = { profile: { ...profile, apiMode: 'responses' as const }, params: DEFAULT_PARAMS, input: 'agent' }
  const native = callAgentResponsesApi({ ...opts, settings: normalizeSettings({ profiles: [profile], agentApiConfigMode: 'native' }) })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await callAgentResponsesApi({ ...opts, settings: normalizeSettings({ profiles: [profile], agentApiConfigMode: 'hybrid' }) })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  release(response())
  await Promise.all([first, native])
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
