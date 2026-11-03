import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { CloseIcon } from '../icons'

interface ProfileEditDialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  suspended?: boolean
}

/** 展示配置编辑弹窗；关闭时由调用方保存草稿，键盘焦点和滚动限制在弹窗内。 */
export default function ProfileEditDialog({ title, onClose, children, suspended = false }: ProfileEditDialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // 打开外层挂载的子弹窗时，交还 Escape 和滚动控制权。
  useCloseOnEscape(!suspended, onClose)
  usePreventBackgroundScroll(!suspended, panelRef)

  useEffect(() => {
    const previousFocus = document.activeElement
    closeRef.current?.focus()
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus() }
  }, [])

  /** 将 Tab 循环限制在当前弹窗；嵌套弹窗由其自身处理键盘事件。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || (event.target as HTMLElement).closest('[role="dialog"]') !== panelRef.current) return
    const controls = [...panelRef.current!.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')]
      .filter((element) => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length > 0)
    const target = event.shiftKey ? controls[controls.length - 1] : controls[0]
    if (document.activeElement !== (event.shiftKey ? controls[0] : controls[controls.length - 1])) return
    event.preventDefault()
    target?.focus()
  }

  // 保留在设置页的滚动边界内，避免父页面的滚动锁阻止弹窗内容滚动。
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown} className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-gray-900">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button ref={closeRef} type="button" aria-label="关闭配置编辑" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]"><CloseIcon className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6 custom-scrollbar">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 dark:border-white/[0.08]">
          <span className="text-xs text-gray-400">修改后自动保存</span>
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700">完成</button>
        </div>
      </div>
    </div>
  )
}
