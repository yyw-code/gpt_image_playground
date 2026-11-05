import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiProfile } from '../../types'
import { fetchSiteKeys, getSiteKeyAccessError, getSiteKeyUnavailableReason, readSiteSessionToken, type SiteKey, type SiteKeyPage } from '../../lib/siteKeys'
import { IS_SITE_MODE } from '../../lib/siteMode'

interface SiteKeyPickerProps {
  profile: ApiProfile
  onSelect: (apiKey: string) => void
}

/** 读取同源主站的本人密钥并按名称选择；列表只驻留内存，账号变化或配置切换时丢弃。 */
export default function SiteKeyPicker({ profile, onSelect }: SiteKeyPickerProps) {
  const [session, setSession] = useState(readSiteSessionToken)
  const [result, setResult] = useState<{ connection: object; token: string; data: SiteKeyPage } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const connection = useMemo(() => ({}), [profile.id, profile.provider, profile.baseUrl, profile.apiProxy, session])
  const current = result?.connection === connection && result.token === readSiteSessionToken() ? result.data : null
  const selected = current?.items.find((item) => item.key === profile.apiKey.trim())

  useEffect(() => {
    /** 主站退出或切换账号后清理候选；同源父页面的存储变化会通知工作台 iframe。 */
    const syncSession = () => setSession(readSiteSessionToken())
    window.addEventListener('storage', syncSession)
    window.addEventListener('focus', syncSession)
    return () => {
      window.removeEventListener('storage', syncSession)
      window.removeEventListener('focus', syncSession)
    }
  }, [])

  useEffect(() => {
    request.current?.abort()
    setResult(null)
    setOpen(false)
    setLoading(false)
    setError('')
    return () => request.current?.abort()
  }, [connection])

  /** 分页查询只读密钥接口；取消的请求和已变化的会话不能更新候选。 */
  const loadKeys = async (page = 1) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const token = readSiteSessionToken()
    if (token !== session) {
      setSession(token)
      return
    }
    setLoading(true)
    setError('')
    setOpen(true)
    try {
      const data = await fetchSiteKeys(profile, page, controller.signal)
      if (!controller.signal.aborted && request.current === controller && token === readSiteSessionToken()) setResult({ connection, token, data })
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) {
        setResult(null)
        setError(error instanceof Error ? error.message : '读取个人密钥失败，请重试')
      }
    } finally {
      if (!controller.signal.aborted && request.current === controller) setLoading(false)
    }
  }

  /** 选择前复核会话与可用状态，只向当前配置填入用户明确选择的密钥。 */
  const selectKey = (item: SiteKey) => {
    if (!result || result.token !== readSiteSessionToken()) {
      setResult(null)
      setError('主站登录已变化，请重新获取密钥')
      setSession(readSiteSessionToken())
      return
    }
    const reason = getSiteKeyUnavailableReason(item, profile.provider)
    if (reason) { setError(reason); return }
    onSelect(item.key)
    setOpen(false)
  }

  if (!IS_SITE_MODE || !['openai', 'grok'].includes(profile.provider)) return null
  const accessError = getSiteKeyAccessError(profile)

  return (
    <div className="mt-2 space-y-2 text-xs">
      <button type="button" disabled={loading || Boolean(accessError)} onClick={() => void loadKeys()} className="font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400">
        {loading ? '正在获取密钥…' : '获取我的密钥'}
      </button>
      {selected && <p className="text-gray-500">已选择：{selected.name} · {selected.groupName}</p>}
      {(error || accessError) && <p role="status" className="text-amber-600">{error || accessError}</p>}
      {(!session || error.includes('登录')) && !accessError && <p className="text-gray-500">请先在主站登录，再获取本人密钥。<a href="/login" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">前往主站登录</a></p>}
      {open && <div className="rounded-xl border border-gray-200 p-3 dark:border-white/[0.1]">
        <div className="mb-2 flex items-center justify-between gap-2"><span>选择个人密钥</span><button type="button" onClick={() => setOpen(false)} className="text-gray-500">收起密钥列表</button></div>
        {current && !loading && <>
          {current.items.length === 0 && <p className="text-gray-500">暂无个人密钥，请先在主站创建。</p>}
          <ul aria-label="本人密钥列表" className="max-h-56 space-y-1 overflow-y-auto">
            {current.items.map((item) => {
              const reason = getSiteKeyUnavailableReason(item, profile.provider)
              return <li key={item.id}><button type="button" disabled={Boolean(reason)} onClick={() => selectKey(item)} className="w-full rounded-lg px-2 py-2 text-left hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06]">
                <span className="block font-medium text-gray-700 dark:text-gray-200">{item.name}</span>
                <span className="text-gray-500">{item.groupName} · {reason || '可用'} · {item.key.length > 4 ? `…${item.key.slice(-4)}` : '已隐藏'}</span>
              </button></li>
            })}
          </ul>
          {current.pages > 1 && <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" disabled={current.page <= 1} onClick={() => void loadKeys(current.page - 1)} className="text-blue-600 disabled:opacity-40">上一页密钥</button>
            <span className="text-gray-500">{current.page} / {current.pages}</span>
            <button type="button" disabled={current.page >= current.pages} onClick={() => void loadKeys(current.page + 1)} className="text-blue-600 disabled:opacity-40">下一页密钥</button>
          </div>}
        </>}
      </div>}
    </div>
  )
}
