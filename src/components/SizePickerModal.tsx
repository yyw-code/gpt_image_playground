import { useEffect, useMemo, useRef, useState } from 'react'
import { calculateImageSize, FIXED_IMAGE_SIZES, getImageRatioSize, getRequestedImageAspectRatio, isExperimentalImageSize, normalizeCodexCliImageSize, normalizeImageAspectRatio, normalizeImageSize, parseRatio, type ImageSizeMode, type SizeTier } from '../lib/size'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { getGrokAspectRatios } from '../lib/grokImage'
import ViewportTooltip from './ViewportTooltip'

const TIERS: SizeTier[] = ['1K', '2K', '4K']
const SIZE_LIMIT_TEXT = '由于模型限制，不符合要求的分辨率会被自动规整：\n宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。'
const CLAMPED_SIZE_TEXT = '由于模型限制，原始分辨率已被自动规整'
const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]

interface Props {
  currentSize: string
  onSelect: (size: string, imageAspectRatio?: string) => void
  /** 仅选择画布比例；请求像素内部计算，不提供未确认的分辨率承诺。 */
  ratioOnly?: boolean
  imageAspectRatio?: string
  onClose: () => void
  allowAuto?: boolean
  codexCli?: boolean
  grokModel?: string
  grokResolution?: '1k' | '2k'
  grokAspectRatio?: string
  onGrokSelect?: (params: { resolution: '1k' | '2k'; aspect_ratio: string }) => void
  sizeMode?: ImageSizeMode
  /** 打开当前模式的配置页；仅导航，不直接切换协议或修改参数。 */
  onOpenSettings?: () => void
}

type Mode = 'auto' | 'ratio' | 'resolution'

function parseSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!match) return null
  return { width: match[1], height: match[2] }
}

function findPresetForSize(size: string) {
  const normalized = normalizeImageSize(size)
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === normalized) {
        return { tier, ratio: ratio.value }
      }
    }
  }
  return null
}

/** 按通道展示尺寸入口；比例模式准确保存目标比例并保留禁用像素入口，原生通道保留原有像素选择。 */
export default function SizePickerModal({ currentSize, onSelect, onClose, allowAuto = true, codexCli = false, sizeMode = 'custom', grokModel = '', grokResolution = '1k', grokAspectRatio = '1:1', onGrokSelect, ratioOnly = false, imageAspectRatio }: Props) {
  const modalRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(true, modalRef)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const mouseDownTarget = mouseDownTargetRef.current
    const mouseUpTarget = e.target

    if (
      modalRef.current &&
      mouseDownTarget &&
      !modalRef.current.contains(mouseDownTarget as Node) &&
      mouseUpTarget &&
      !modalRef.current.contains(mouseUpTarget as Node)
    ) {
      onClose()
    }
    mouseDownTargetRef.current = null
  }

  const currentPreset = findPresetForSize(currentSize)
  const isGrok = sizeMode === 'grok'
  const grokRatios = getGrokAspectRatios(grokModel)
  const visibleRatios = isGrok ? getGrokAspectRatios('grok-imagine-image-2.0').filter((value) => value !== 'auto').map((value) => ({ label: value, value })) : RATIOS
  const compositionOnly = !isGrok && (ratioOnly || codexCli || sizeMode === 'composition')
  const fixedSizesOnly = !compositionOnly && sizeMode === 'fixed'
  const autoOnly = !compositionOnly && sizeMode === 'auto'
  const currentRatio = getRequestedImageAspectRatio({ size: currentSize, imageAspectRatio })
  const customSizeDisabled = isGrok || compositionOnly || fixedSizesOnly || autoOnly
  const sizeDisabledReason = isGrok ? 'Grok 支持原生比例与 1K/2K 档位，不支持自定义像素和 4K' : compositionOnly ? '当前通道仅支持构图比例引导，像素由接口决定' : fixedSizesOnly ? '当前模型仅支持下方固定尺寸' : '当前模型尺寸能力尚未确认，使用接口自动尺寸'
  const [fixedSize, setFixedSize] = useState(FIXED_IMAGE_SIZES.includes(currentSize) ? currentSize : 'auto')
  const currentParsedSize = parseSize(currentSize)
  const [mode, setMode] = useState<Mode>(() => {
    if (isGrok) return grokAspectRatio === 'auto' ? 'auto' : 'ratio'
    if (autoOnly) return 'auto'
    if (compositionOnly) return currentRatio === 'auto' && allowAuto ? 'auto' : 'ratio'
    if (!currentSize || currentSize === 'auto') return allowAuto ? 'auto' : 'ratio'
    if (currentPreset) return 'ratio'
    return 'resolution'
  })

  // Ratio mode state
  const [tier, setTier] = useState<SizeTier>(isGrok ? grokResolution === '2k' ? '2K' : '1K' : currentPreset?.tier ?? '1K')
  // 受限通道禁用像素输入页，恢复非预设尺寸时用其原比例初始化，避免确认后变成方形。
  const [ratio, setRatio] = useState(isGrok ? grokAspectRatio : compositionOnly && currentRatio !== 'auto' ? RATIOS.some((item) => item.value === currentRatio) ? currentRatio : 'custom' : currentPreset?.ratio ?? (allowAuto ? '1:1' : '4:3'))
  const [customRatio, setCustomRatio] = useState(compositionOnly && currentRatio !== 'auto' ? currentRatio : currentParsedSize ? `${currentParsedSize.width}:${currentParsedSize.height}` : '16:9')

  // Resolution mode state
  const [customW, setCustomW] = useState(currentParsedSize?.width ?? '1024')
  const [customH, setCustomH] = useState(currentParsedSize?.height ?? '1024')

  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
  }, [])

  const normalizeSize = compositionOnly ? normalizeCodexCliImageSize : normalizeImageSize
  const sizeLimitText = SIZE_LIMIT_TEXT

  const activeRatio = ratio === 'custom' ? customRatio : ratio
  const parsedCustomRatio = parseRatio(customRatio)
  const customRatioValid = ratio !== 'custom' || Boolean(compositionOnly ? normalizeImageAspectRatio(customRatio) : parsedCustomRatio)
  const customRatioClamped = Boolean(
    ratio === 'custom' &&
    parsedCustomRatio &&
    Math.max(parsedCustomRatio.width, parsedCustomRatio.height) / Math.min(parsedCustomRatio.width, parsedCustomRatio.height) > 3,
  )

  const previewSize = useMemo(() => {
    if (isGrok) return mode === 'auto' ? 'auto' : grokRatios.includes(activeRatio) ? activeRatio : ''
    if (autoOnly) return 'auto'
    if (fixedSizesOnly) return fixedSize
    if (mode === 'auto') return 'auto'
    if (compositionOnly) return normalizeImageAspectRatio(activeRatio) ? getImageRatioSize({ size: currentSize, imageAspectRatio: activeRatio }) : ''
    
    if (mode === 'ratio') {
      const size = calculateImageSize(tier, activeRatio)
      return size ? normalizeSize(size) : ''
    }
    
    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return normalizeSize(`${w}x${h}`)
      }
      return ''
    }
    
    return ''
  }, [mode, tier, activeRatio, customW, customH, normalizeSize, fixedSizesOnly, fixedSize, autoOnly, isGrok, grokModel, compositionOnly, currentSize])

  /** 受限通道隐藏内部用于保存比例的像素值，只展示构图选择。 */
  const displaySize = (size: string) => {
    return compositionOnly ? size === 'auto' ? '自动' : normalizeImageAspectRatio(activeRatio) ?? '' : size
  }

  const isClamped = useMemo(() => {
    if (compositionOnly || !previewSize || previewSize === 'auto') return false
    if (mode === 'ratio' && ratio === 'custom') return customRatioClamped
    if (mode === 'resolution') {
      const w = parseInt(customW, 10)
      const h = parseInt(customH, 10)
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `${w}x${h}` !== previewSize
      }
    }
    return false
  }, [mode, ratio, customRatioClamped, customW, customH, previewSize, compositionOnly])

  const showHint = () => setHintVisible(true)
  const hideHint = () => {
    setHintVisible(false)
    clearHintTimer()
  }
  const clearHintTimer = () => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
  }
  const startHintTouch = () => {
    hintTimerRef.current = window.setTimeout(() => {
      setHintVisible(true)
      hintTimerRef.current = null
    }, 450)
  }

  /** 确认当前通道允许的参数；比例模式同时保存独立目标比例与内部建议尺寸。 */
  const applySize = () => {
    if (!previewSize) return
    if (isGrok) onGrokSelect?.({ resolution: tier === '2K' ? '2k' : '1k', aspect_ratio: previewSize })
    else if (compositionOnly) onSelect(previewSize, mode === 'auto' ? 'auto' : normalizeImageAspectRatio(activeRatio))
    else onSelect(previewSize)
    onClose()
  }

  const buttonClass = (active: boolean) => {
    return `rounded-xl border px-3 py-2 text-sm transition ${active
      ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
      : 'border-transparent bg-black/[0.04] text-gray-600 hover:bg-black/[0.07] dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
    }`
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{compositionOnly ? '设置图像比例' : '设置图像尺寸'}</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">当前：{isGrok ? `${grokResolution.toUpperCase()} · ${grokAspectRatio}` : compositionOnly ? currentRatio === 'auto' ? '自动' : currentRatio : currentSize || 'auto'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
            {(
              <button
                disabled={!allowAuto || fixedSizesOnly}
                title={!allowAuto ? '当前模式不支持自动尺寸' : fixedSizesOnly ? sizeDisabledReason : undefined}
                onClick={() => { if (allowAuto && !fixedSizesOnly) setMode('auto') }}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'auto' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                自动
              </button>
            )}
            <button
              disabled={fixedSizesOnly || autoOnly}
              title={fixedSizesOnly || autoOnly ? sizeDisabledReason : undefined}
              onClick={() => { if (!fixedSizesOnly && !autoOnly) setMode('ratio') }}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'ratio' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              按比例
            </button>
            <button
              disabled={customSizeDisabled}
              title={customSizeDisabled ? sizeDisabledReason : undefined}
              onClick={() => { if (!customSizeDisabled) setMode('resolution') }}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'resolution' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              自定义宽高
            </button>
          </div>

          <div role="region" aria-label="尺寸选项" className="h-[380px] max-h-[55vh] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10 pr-1 -mr-1 pb-2">
            <section className="mb-5">
              <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">基准分辨率</div>
              <div className="grid grid-cols-3 gap-2">
                {TIERS.map((item) => (
                  <button key={item} className={`${buttonClass(!compositionOnly && tier === item)} w-full disabled:opacity-40 disabled:cursor-not-allowed`} disabled={isGrok ? item === '4K' : customSizeDisabled} title={customSizeDisabled ? sizeDisabledReason : undefined} onClick={() => { if (isGrok ? item !== '4K' : !customSizeDisabled) setTier(item) }}>{item}</button>
                ))}
              </div>
            </section>
            {customSizeDisabled && <p className="mb-4 text-xs text-gray-500">{sizeDisabledReason}，灰色选项不可选择。</p>}
            {fixedSizesOnly && <div className="grid grid-cols-2 gap-2">{['auto', ...FIXED_IMAGE_SIZES].map((size) => <button key={size} className={buttonClass(fixedSize === size)} onClick={() => setFixedSize(size)}>{size === 'auto' ? '自动' : size}</button>)}</div>}
            {!fixedSizesOnly && mode === 'auto' && (
              <div className="flex h-full animate-fade-in items-center justify-center pt-8 pb-4 text-center">
                <div>
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-500/10">
                    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">自动尺寸</h4>
                  <p className="mt-2 text-xs text-gray-400 leading-relaxed dark:text-gray-500">
                    {isGrok ? '发送所选分辨率档位，比例由模型决定' : compositionOnly ? '由模型决定画布比例和实际尺寸' : '不向模型传递具体的分辨率参数'}
                    <br />
                    由模型自己决定生成尺寸
                  </p>
                </div>
              </div>
            )}

            {!fixedSizesOnly && mode === 'ratio' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">图像比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {visibleRatios.map((item) => {
                      const [w, h] = item.value.split(':').map(Number)
                      const isHorizontal = w > h
                      const isSquare = w === h
                      return (
                        <button
                          key={item.value}
                          disabled={isGrok && !grokRatios.includes(item.value)}
                          title={isGrok && !grokRatios.includes(item.value) ? '当前 Grok 模型不支持此比例' : undefined}
                          className={`${buttonClass(ratio === item.value)} disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5 !py-2.5`}
                          onClick={() => { if (!isGrok || grokRatios.includes(item.value)) setRatio(item.value) }}
                        >
                          <div className="flex h-5 w-5 items-center justify-center">
                            <div
                              className="border-[1.5px] border-current rounded-[3px] opacity-60"
                              style={{
                                width: isHorizontal || isSquare ? '100%' : `${(w / h) * 100}%`,
                                height: !isHorizontal || isSquare ? '100%' : `${(h / w) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs">{item.label}</span>
                        </button>
                      )
                    })}
                    <button disabled={isGrok} title={isGrok ? sizeDisabledReason : undefined} className={`${buttonClass(ratio === 'custom')} col-span-4 disabled:opacity-40 disabled:cursor-not-allowed`} onClick={() => { if (!isGrok) setRatio('custom') }}>
                      自定义比例
                    </button>
                  </div>
                </section>

                {ratio === 'custom' && (
                  <label className="block animate-fade-in">
                    <span className="mb-2 block text-xs font-medium text-gray-400 dark:text-gray-500">输入自定义比例</span>
                    <input
                      value={customRatio}
                      onChange={(e) => setCustomRatio(e.target.value)}
                      placeholder="例如 5:4 / 2.39:1"
                      className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                        customRatioValid
                          ? 'border-transparent bg-black/[0.04] text-gray-700 focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50'
                          : 'border-red-300 bg-white/60 text-gray-700 focus:border-red-400 dark:border-red-500/40 dark:bg-white/[0.03] dark:text-gray-200'
                      }`}
                    />
                  </label>
                )}
              </div>
            )}

            {!fixedSizesOnly && !compositionOnly && mode === 'resolution' && (
              <div className="space-y-5 animate-fade-in">
                <section>
                  <div className="mb-4 text-xs font-medium text-gray-400 dark:text-gray-500">输入具体像素值</div>
                  <div className="flex items-center gap-4">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">宽度 (Width)</span>
                      <input
                        type="number"
                        value={customW}
                        onChange={(e) => setCustomW(e.target.value)}
                        className="w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50"
                        placeholder="例如 1024"
                      />
                    </label>
                    <div className="mt-5 text-gray-300 dark:text-gray-600">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">高度 (Height)</span>
                      <input
                        type="number"
                        value={customH}
                        onChange={(e) => setCustomH(e.target.value)}
                        className="w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50"
                        placeholder="例如 1024"
                      />
                    </label>
                  </div>
                </section>
                <div className="rounded-xl border border-transparent bg-black/[0.04] p-3 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
                  <div className="flex items-start gap-2">
                    <svg className="mt-[2px] h-4 w-4 flex-shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="whitespace-pre-line leading-relaxed">{sizeLimitText}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-white/[0.03]">
            <div className="text-xs text-gray-400 dark:text-gray-500">将使用</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-gray-800 dark:text-gray-100">
                {isGrok && previewSize ? `${tier} · ${previewSize}` : displaySize(previewSize) || '尺寸无效'}
              </span>
              {isClamped && (
                <div
                  className="relative flex items-center"
                  onMouseEnter={showHint}
                  onMouseLeave={hideHint}
                  onTouchStart={startHintTouch}
                  onTouchEnd={clearHintTimer}
                  onTouchCancel={hideHint}
                  onClick={showHint}
                >
                  <svg className="w-5 h-5 text-yellow-500 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <ViewportTooltip visible={hintVisible} className="w-56 whitespace-pre-line text-center">
                    {CLAMPED_SIZE_TEXT}
                  </ViewportTooltip>
                </div>
              )}
            </div>
          </div>
          {compositionOnly && <p className="text-xs text-gray-500">按所选比例生成，实际分辨率由模型决定。生成后核对原图比例，偏差超过 1% 时标黄提示。</p>}
          {!compositionOnly && !fixedSizesOnly && isExperimentalImageSize(previewSize) && <p className="text-xs text-amber-600">此分辨率超过常规像素范围，属于实验支持，实际输出以接口返回为准。</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
          >
            取消
          </button>
          <button
            onClick={applySize}
            disabled={!previewSize}
            className="flex-1 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
