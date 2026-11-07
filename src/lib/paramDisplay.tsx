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
}

/** 获取单张图的回显；批量缺少逐图数据时不借用首张图的参数，旧单图仍兼容任务级数据。 */
export function getTaskImageActualParams(task: TaskRecord, imageId: string): Partial<TaskParams> {
  return task.actualParamsByImage?.[imageId] ?? (task.outputImages.length === 1 ? task.actualParams ?? {} : {})
}

/** 按任务原设置核对已保存结果；Grok 比例使用实际宽高，档位、质量和复杂度仅核对回显，不推断视觉效果。 */
export function getImageParameterCheck(task: TaskRecord, actualParams = task.actualParams) {
  // 兼容/未知通道未发送原生字段，不能拿隐藏草稿值制造质量或格式失败。
  if (task.imageParameterMode === 'composition' || task.imageParameterMode === 'default') return { checked: 0, mismatches: [], unverified: [] }
  const fields = [
    { key: 'size', label: '尺寸', enabled: task.apiProvider !== 'grok' },
    { key: 'aspect_ratio', label: '比例', enabled: task.apiProvider === 'grok' },
    { key: 'resolution', label: '分辨率档位回显', enabled: task.apiProvider === 'grok' },
    { key: 'quality', label: '质量回显', enabled: task.apiProvider !== 'grok' || task.apiModel === 'grok-imagine-image-2.0' },
    { key: 'output_format', label: '格式', enabled: task.apiProvider !== 'grok' },
    { key: 'complexity', label: '复杂度回显', enabled: task.apiProvider !== 'grok' },
    { key: 'output_compression', label: '压缩率回显', enabled: task.apiProvider !== 'grok' && task.params.output_format !== 'png' },
  ] as const
  const checks = fields.filter(({ key, enabled }) => enabled && task.params[key] != null && task.params[key] !== 'auto').map(({ key, label }) => {
    if (key === 'aspect_ratio') {
      // 不信任接口可能照抄的比例字段；真实尺寸缺失时保留未验证，容忍 1% 的像素规整误差。
      const size = actualParams?.size ?? ''
      const dimensions = parseRatio(size)
      return {
        key, label, requestedValue: task.params.aspect_ratio!,
        displayValue: dimensions ? formatImageRatio(dimensions.width, dimensions.height) : '',
        verified: Boolean(dimensions),
        isMismatch: Boolean(getImageAspectRatioWarning(task.params.aspect_ratio!, size)),
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

export function ActualValueBadge({ value, className = '', variant = 'highlight' }: ActualValueBadgeProps) {
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
        API 实际响应值
      </ViewportTooltip>
    </span>
  )
}

/** 比较任务快照与回显；兼容/未知模式未发送的字段、未指定复杂度、Agent 张数及 Grok 格式视为接口决定。 */
export function getParamDisplay(task: TaskRecord, paramKey: ParamKey, actualParams = task.actualParams) {
  const usesDefaultParameter = (task.imageParameterMode === 'composition' || task.imageParameterMode === 'default')
    && ['size', 'quality', 'output_format', 'output_compression', 'complexity', 'moderation'].includes(paramKey)
  const requestedValue = usesDefaultParameter || task.sourceMode === 'agent' && paramKey === 'n' || task.apiProvider === 'grok' && paramKey === 'output_format' || paramKey === 'complexity' && task.params.complexity === undefined
    ? 'auto'
    : task.params[paramKey]
  const actualValue = actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch =
    hasActualValue &&
    requestedValue !== 'auto' &&
    String(actualValue) !== String(requestedValue)

  return {
    displayValue: String(displayValue),
    isMismatch,
    requestedValue: String(requestedValue),
    isAutoResolved: hasActualValue && requestedValue === 'auto' && String(actualValue) !== String(requestedValue),
  }
}

export function DetailParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch, requestedValue, isAutoResolved } = getParamDisplay(task, paramKey, actualParams)

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <ActualValueBadge value={displayValue} variant="normal" className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-gray-700 dark:text-gray-300 ${className}`}>{displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <ActualValueBadge value={displayValue} className="rounded px-1 py-0.5" />
    </span>
  )
}
