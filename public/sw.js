// Cache Storage 在同域间共享，使用应用标记和注册路径隔离不同站点入口。
const SCOPE_URL = new URL(self.registration.scope)
const CACHE_PREFIX = `gpt-image-playground:${encodeURIComponent(SCOPE_URL.pathname)}:`
const CACHE_NAME = `${CACHE_PREFIX}v0.8.0-runtime-config-1`
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-icon.svg']
const APP_SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href))
const ASSETS_PATH = new URL('./assets/', self.registration.scope).pathname
const INDEX_URL = new URL('./index.html', self.registration.scope).href
const RUNTIME_CONFIG_PATH = new URL('./runtime-config.js', self.registration.scope).pathname

/** 安装时只预存本入口的页面资源，部署配置必须在每次打开页面时从网络读取。 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL_URLS])),
  )
  self.skipWaiting()
})

/** 只删除本应用当前注册路径下的旧缓存；保留其他应用及归属不明的历史共享缓存。 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  )
})

/** 页面联网优先，静态资源仅命中自己的缓存；配置、API 与入口外请求交给浏览器处理。 */
self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) return
  if (url.pathname === RUNTIME_CONFIG_PATH) return

  // 只缓存顶层页面；公告卡片中的 iframe 也是导航请求，不能写进 index.html 的缓存
  if (request.mode === 'navigate' && request.destination === 'document') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        try {
          const response = await fetch(request, { cache: 'no-cache' })
          // 缓存容量不足不应把已成功下载的新页面替换为旧页面。
          if (response.ok) await cache.put(INDEX_URL, response.clone()).catch(() => console.warn('页面离线缓存写入失败'))
          return response
        } catch {
          return await cache.match(INDEX_URL) ?? Response.error()
        }
      })(),
    )
    return
  }

  if (!APP_SHELL_URLS.has(url.href) && !url.pathname.startsWith(ASSETS_PATH)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      // 缓存属于可选加速；写入失败时仍把网络资源交给页面。
      if (response.ok) await cache.put(request, response.clone()).catch(() => console.warn('静态资源缓存写入失败'))
      return response
    })(),
  )
})
