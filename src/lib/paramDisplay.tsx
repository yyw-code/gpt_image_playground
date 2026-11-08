import { useEffect, useRef, useState } from 'react'
import type { TaskParams, TaskRecord } from '../types'
import ViewportTooltip from '../components/ViewportTooltip'
import { formatImageRatio, getImageAspectRatioWarning, parseRatio } from './size'

type ParamKey = keyof TaskParams

interface ParamValueProps {
  task: TaskRecord
  paramKey: ParamKey
  className?: string
  actualParams?: Partial<TaskParams>
}

interface ActualValueBadgeProps {
  value: string
  className?: string
  variant?: 'highlight' | 'normal'
  tooltip?: string
}

/** 获取单张图的回显；批量缺少逐图数据时不借用首张图的参数，旧单图仍兼容任务级数据。 */
export function getTaskImageActualParams(task: TaskRecord, imageId: string): Partial<TaskParams> {
  return task.actualParamsByImage?.[imageId] ?? (task.outputImages.length === 1 ? task.actualParams ?? {} : {})
}

/** 按任务快照核对原图比例；独立目标比例不与建议像素比较，质量等仍仅核对回显。 */
export function getImageParameterCheck(task: TaskRecord, actualParams = task.actualParams) {
  const native = task.imageParameterMode !== 'composition' && task.imageParameterMode !== 'default'
  const fields = [
    { key: 'size', label: '尺寸', enabled: native && task.apiProvider !== 'grok' && task.params.imageAspectRatio === undefined },
    { key: 'imageAspectRatio', label: '比例', enabled: task.apiProvider !== 'grok' && task.params.imageAspectRatio !== undefined },
    { key: 'aspect_ratio', label: '比例', enabled: task.apiProvider === 'grok' },
    { key: 'resolution', label: '分辨率档位回显', enabled: task.apiProvider === 'grok' },
    { key: 'quality', label: '质量回显', enabled: native && (task.apiProvider !== 'grok' || task.apiModel === 'grok-imagine-image-2.0') },
    { key: 'output_format', label: '格式', enabled: native && task.apiProvider !== 'grok' },
    { key: 'complexity', label: '复杂度回显', enabled: native && task.apiProvider !== 'grok' },
    { key: 'output_compression', label: '压缩率回显', enabled: native && task.apiProvider !== 'grok' && task.params.output_format !== 'png' },
  ] as const
  const checks = fields.filter(({ key, enabled }) => enabled && task.params[key] != null && task.params[key] !== 'auto').map(({ key, label }) => {
    if (key === 'aspect_ratio' || key === 'imageAspectRatio') {
      // 不信任接口可能照抄的比例字段；真实尺寸缺失时保留未验证，容忍 1% 的像素规整误差。
      const size = actualParams?.size ?? ''
      const dimensions = parseRatio(size)
      return {
        key, label, requestedValue: task.params[key]!,
        displayValue: dimensions ? formatImageRatio(dimensions.width, dimensions.height) : '',
        verified: Boolean(dimensions),
        isMismatch: Boolean(getImageAspectRatioWarning(task.params[key]!, size)),
        isAutoResolved: false,
      }
    }
    const display = getParamDisplay(task, key, actualParams)
    const value = actualParams?.[key]
    const verified = value !== undefined && value !== null && value !== '' && value !== 'auto'
    return { key, label, ...display, verified }
  })
  return {
    checked: checks.filter((item) => item.verified).length,
    mismatches: checks.filter((item) => item.verified && item.isMismatch),
    unverified: checks.filter((item) => !item.verified),
  }
}

/** 显示实际值及其来源说明；黄色表示不同，灰色表示自动决定的值。 */
export function ActualValueBadge({ value, className = '', variant = 'highlight', tooltip = 'API 实际响应值' }: ActualValueBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const touchTimerRef = useRef<number | null>(null)
  const colorClass = variant === 'normal'
    ? 'bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400'
    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'

  useEffect(() => () => {
    if (touchTimerRef.current != null) window.clearTimeout(touchTimerRef.current)
  }, [])

  const clearTouchTimer = () => {
    if (touchTimerRef.current != null) {
      window.clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
  }

  return (
    <span
      className={`relative inline-flex cursor-help ${colorClass} ${className}`}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      onClick={() => setTooltipVisible(true)}
      onTouchStart={() => {
        clearTouchTimer()
        touchTimerRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
          touchTimerRef.current = null
        }, 450)
      }}
      onTouchEnd={clearTouchTimer}
      onTouchCancel={clearTouchTimer}
    >
      {value}
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

/** 比较任务快照与实际值；独立目标比例按原图核对，建议像素不作为精确分辨率承诺。 */
export function getParamDisplay(task: TaskRecord, paramKey: ParamKey, actualParams = task.actualParams) {
  const usesDefaultParameter = (task.imageParameterMode === 'composition' || task.imageParameterMode === 'default')
    && ['size', 'quality', 'output_format', 'output_compression', 'complexity', 'moderation'].includes(paramKey)
    && !(task.imageParameterMode === 'composition' && paramKey === 'size')
  const requestedValue = usesDefaultParameter || paramKey === 'size' && task.params.imageAspectRatio !== undefined || task.sourceMode === 'agent' && paramKey === 'n' || task.apiProvider === 'grok' && paramKey === 'output_format' || paramKey === 'complexity' && task.params.complexity === undefined
    ? 'auto'
    : task.params[paramKey]
  const actualValue = actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null && actualValue !== '' && actualValue !== 'auto'
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch =
    hasActualValue &&
    requestedValue !== 'auto' &&
    String(actualValue) !== String(requestedValue)

  if (task.apiProvider === 'grok' && paramKey === 'aspect_ratio' || paramKey === 'imageAspectRatio') {
    const size = actualParams?.size ?? ''
    const dimensions = parseRatio(size)
    return {
      requestedValue: String(requestedValue ?? '1:1'),
      displayValue: dimensions ? formatImageRatio(dimensions.width, dimensions.height) : String(requestedValue ?? '1:1'),
      isMismatch: Boolean(getImageAspectRatioWarning(String(requestedValue ?? '1:1'), size)),
      isAutoResolved: Boolean(dimensions && requestedValue === 'auto'),
    }
  }
  return {
    displayValue: String(displayValue),
    isMismatch,
    requestedValue: String(requestedValue),
    isAutoResolved: hasActualValue && requestedValue === 'auto' && String(actualValue) !== String(requestedValue),
  }
}

/** 在设置值旁展示实际值；保留黄色差异、未知状态和兼容模式说明，不改变参数或生成状态。 */
export function DetailParamValue({ task, paramKey, className = '', actualParams = task.actualParams }: ParamValueProps) {
  const display = getParamDisplay(task, paramKey, actualParams)
  const { isMismatch, isAutoResolved } = display
  const requestedValue = paramKey === 'resolution' ? display.requestedValue.toUpperCase() : display.requestedValue
  const displayValue = paramKey === 'resolution' ? display.displayValue.toUpperCase() : display.displayValue
  const unverified = getImageParameterCheck(task, actualParams).unverified.some((item) => item.key === paramKey)
    || paramKey === 'size' && task.imageParameterMode === 'composition' && requestedValue !== 'auto' && !parseRatio(actualParams?.size ?? '')
  const tooltip = paramKey === 'size'
    ? task.imageParameterMode === 'composition' ? '实际图片尺寸；左侧仅作构图参考，未发送精确像素参数' : '实际图片尺寸，优先使用原图解码结果'
    : paramKey === 'aspect_ratio' || paramKey === 'imageAspectRatio' ? '根据原图宽高计算；允许 1% 的像素规整误差'
      : paramKey === 'quality' || paramKey === 'complexity' ? 'API 实际响应值，不代表视觉效果' : 'API 实际响应值'

  if (paramKey === 'size' && task.params.imageAspectRatio !== undefined) {
    return <span className={className}>{parseRatio(actualParams?.size ?? '') ? actualParams?.size : '未验证'}</span>
  }

  if (unverified) return <span className={`inline-flex items-center gap-1 ${className}`}><span>{requestedValue}</span><span className="text-gray-400" title="缺少可核对的实际值，不代表与设置一致">未验证</span></span>

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <ActualValueBadge value={displayValue} variant="normal" tooltip={tooltip} className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-gray-700 dark:text-gray-300 ${className}`}>{paramKey === 'imageAspectRatio' ? requestedValue : displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <ActualValueBadge value={displayValue} tooltip={tooltip} className="rounded px-1 py-0.5" />
    </span>
  )
}
