import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { getProxySetting } from './lib/networkProxy'
import { installBrowserBehaviorGuards, installExternalLinkHandler, isTauri } from './lib/platform'
import { installTauriLog } from './lib/tauriLog'
import { installTauriStorageFlush, loadTauriStorage } from './lib/tauriStorage'
import { installMobileViewportGuards } from './lib/viewport'
import { assertRuntimeConfigLoaded } from './lib/runtimeEnv'

installMobileViewportGuards()

if (isTauri) {
  installTauriLog()
  installExternalLinkHandler()
  installBrowserBehaviorGuards()
  // 预先读取代理设置，打开设置时不必等待；失败时由设置页重新读取并显示原因
  void getProxySetting().catch((err) => console.warn('预读代理设置失败：', err))
}

// 客户端不注册 Service Worker，避免缓存与客户端版本更新冲突
if (!isTauri && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      const scope = new URL(import.meta.env.BASE_URL, window.location.href).href
      registrations.filter((registration) => registration.scope === scope).forEach((registration) => registration.unregister())
    })
  }
}

/** 校验 Docker 站点配置并加载工作台；客户端先读存储，避免 store 提前 hydration 覆盖用户设置。 */
async function start() {
  if (!isTauri && import.meta.env.VITE_DOCKER_DEPLOYMENT === 'true') assertRuntimeConfigLoaded()
  if (isTauri) {
    await loadTauriStorage()
    void installTauriStorageFlush().catch((err) => console.error('注册关闭前保存失败：', err))
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start().catch((error) => {
  console.error('工作台启动失败：', error)
  const message = document.createElement('p')
  message.className = 'p-6 text-center text-red-600'
  message.textContent = '工作台启动失败，请刷新重试或联系管理员检查站点配置。'
  document.getElementById('root')?.replaceChildren(message)
})
