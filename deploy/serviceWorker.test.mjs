import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const scope = 'https://site.example/draw/'
const ownPrefix = 'gpt-image-playground:%2Fdraw%2F:'

/** 在隔离环境执行真实 Worker，模拟缓存和网络，不触碰浏览器或外部接口。 */
function createWorker(keys = []) {
  const handlers = {}
  const entries = new Map()
  const cache = {
    addAll: vi.fn(async (_urls) => undefined),
    match: vi.fn(async (request) => entries.get(typeof request === 'string' ? request : request.url)),
    put: vi.fn(async (request, response) => { entries.set(typeof request === 'string' ? request : request.url, response) }),
  }
  const caches = {
    open: vi.fn(async (_name) => cache),
    keys: vi.fn(async () => keys),
    delete: vi.fn(async (_key) => true),
    match: vi.fn(async () => new Response('other-app')),
  }
  const fetch = vi.fn(async () => new Response('network'))
  runInNewContext(source, {
    URL, Response, caches, fetch,
    self: {
      registration: { scope }, location: { origin: 'https://site.example' },
      addEventListener: (name, handler) => { handlers[name] = handler },
      skipWaiting: vi.fn(), clients: { claim: vi.fn() },
    },
  })

  /** 派发生命周期事件并等待 waitUntil 中的实际异步操作完成。 */
  async function lifecycle(name) {
    let pending
    handlers[name]({ waitUntil: (promise) => { pending = promise } })
    await pending
  }

  /** 派发请求；返回 undefined 表示 Worker 把请求交给浏览器网络层处理。 */
  function request(path, options = {}) {
    let response
    handlers.fetch({
      request: { url: new URL(path, scope).href, method: 'GET', ...options },
      respondWith: (promise) => { response = promise },
    })
    return response
  }
  return { cache, caches, entries, fetch, lifecycle, request }
}

describe('Service Worker 的路径和缓存隔离', () => {
  it('只删除当前路径下的旧缓存，保留其他应用、其他路径和归属不明的旧缓存', async () => {
    const worker = createWorker([`${ownPrefix}old`, 'gpt-image-playground:%2Fother%2F:old', 'sub2api-cache', 'gpt-image-playground-v0.8.0'])
    await worker.lifecycle('activate')
    expect(worker.caches.delete.mock.calls.map(([key]) => key)).toEqual([`${ownPrefix}old`])
  })

  it('安装时只预存当前路径的页面资源，运行时配置不进入缓存', async () => {
    const worker = createWorker()
    await worker.lifecycle('install')
    expect(worker.caches.open.mock.calls[0][0]).toMatch(new RegExp(`^${ownPrefix}`))
    const urls = worker.cache.addAll.mock.calls[0][0]
    expect(urls).toContain(`${scope}index.html`)
    expect(urls.every((url) => url.startsWith(scope) && !url.includes('runtime-config'))).toBe(true)
  })

  it('代码资源只查询自己的缓存，不会命中别的应用缓存', async () => {
    const worker = createWorker()
    expect(await (await worker.request('assets/app.js')).text()).toBe('network')
    expect(worker.caches.match).not.toHaveBeenCalled()
    expect(worker.cache.put).toHaveBeenCalled()
  })

  it('普通静态资源仍然命中自己的缓存以避免重复下载', async () => {
    const worker = createWorker()
    worker.entries.set(`${scope}assets/font.ttf`, new Response('cached-font'))
    expect(await (await worker.request('assets/font.ttf')).text()).toBe('cached-font')
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it('运行时配置、API、其他路径导航、外域和 POST 请求不被缓存拦截', () => {
    const worker = createWorker()
    expect(worker.request('runtime-config.js?v=2')).toBeUndefined()
    expect(worker.request('/v1/models')).toBeUndefined()
    expect(worker.request('/admin', { mode: 'navigate', destination: 'document' })).toBeUndefined()
    expect(worker.request('https://other.example/draw/assets/app.js')).toBeUndefined()
    expect(worker.request('assets/app.js', { method: 'POST' })).toBeUndefined()
    expect(worker.caches.open).not.toHaveBeenCalled()
  })

  it('页面导航联网读取新 HTML，离线时仅使用本应用的页面缓存', async () => {
    const worker = createWorker()
    worker.entries.set(`${scope}index.html`, new Response('old-html'))
    expect(await (await worker.request('', { mode: 'navigate', destination: 'document' })).text()).toBe('network')
    worker.fetch.mockRejectedValue(new Error('offline'))
    expect(await (await worker.request('', { mode: 'navigate', destination: 'document' })).text()).toBe('network')
    expect(worker.caches.match).not.toHaveBeenCalled()
  })

  it('错误页面不会覆盖可用的离线页面', async () => {
    const worker = createWorker()
    worker.entries.set(`${scope}index.html`, new Response('good-html'))
    worker.fetch.mockResolvedValue(new Response('failed', { status: 503 }))
    expect((await worker.request('', { mode: 'navigate', destination: 'document' })).status).toBe(503)
    expect(worker.cache.put).not.toHaveBeenCalled()
  })

  it('缓存写入失败时仍返回联网得到的新页面和代码', async () => {
    const worker = createWorker()
    worker.cache.put.mockRejectedValue(new Error('quota exceeded'))
    worker.entries.set(`${scope}index.html`, new Response('old-html'))
    expect(await (await worker.request('', { mode: 'navigate', destination: 'document' })).text()).toBe('network')
    expect(await (await worker.request('assets/new.js')).text()).toBe('network')
  })
})
