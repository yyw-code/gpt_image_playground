import type { TaskParams } from '../types'

const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/
const SIZE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_ASPECT_RATIO = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_1K_PIXELS = 1_572_864
const COMMON_ASPECT_RATIOS = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9], [9, 21]] as const

export type SizeTier = '1K' | '2K' | '4K'
export type ImageSizeMode = 'custom' | 'fixed' | 'composition' | 'auto' | 'grok'
export const FIXED_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536']
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

/** 根据模型尺寸契约规范当前参数；不改写历史任务，受限通道仅保留构图用尺寸。 */
export function normalizeModelImageSize(size: string, mode: ImageSizeMode): string {
  if (mode === 'auto' || mode === 'grok') return 'auto'
  if (mode === 'fixed') return FIXED_IMAGE_SIZES.includes(size.trim()) ? size.trim() : 'auto'
  const match = size.match(SIZE_PATTERN)
  if (!match || ![Number(match[1]), Number(match[2])].every((edge) => Number.isSafeInteger(edge) && edge > 0)) return 'auto'
  if (mode === 'composition') return normalizeCodexCliImageSize(size)
  return normalizeImageSize(size)
}

/** 标记超过常规像素预算的原生尺寸；实验支持不等于接口保证兑现。 */
export function isExperimentalImageSize(size: string): boolean {
  const match = size.match(SIZE_PATTERN)
  return Boolean(match && Number(match[1]) * Number(match[2]) > 2560 * 1440)
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple)
}

function normalizeDimensions(width: number, height: number) {
  let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE)
  let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE)

  const scaleToFit = (scale: number) => {
    normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  const scaleToFill = (scale: number) => {
    normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(normalizedWidth, normalizedHeight)
    if (maxEdge > MAX_EDGE) {
      scaleToFit(MAX_EDGE / maxEdge)
    }

    if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
      normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    } else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
      normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    }

    const pixels = normalizedWidth * normalizedHeight
    if (pixels > MAX_PIXELS) {
      scaleToFit(Math.sqrt(MAX_PIXELS / pixels))
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels))
    }
  }

  return { width: normalizedWidth, height: normalizedHeight }
}

export function normalizeImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]))
  return `${width}x${height}`
}

export function normalizeCodexCliImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const originalWidth = Number(match[1])
  const originalHeight = Number(match[2])
  const normalized = normalizeDimensions(originalWidth, originalHeight)
  if (normalized.width * normalized.height > MAX_1K_PIXELS) {
    return calculateImageSize('1K', `${normalized.width}:${normalized.height}`) ?? `${normalized.width}x${normalized.height}`
  }

  const { width, height } = normalized
  return `${width}x${height}`
}

export function prependCodexCliSizePrompt(prompt: string, size: string) {
  if (size === 'auto') return prompt
  const trimmed = prompt.trimStart()
  const hint = `Generate at ${size} resolution.`
  if (trimmed.startsWith(hint)) return trimmed
  return `${hint} ${trimmed}`
}

export function stripInjectedCodexCliSizePrompt(prompt: string, originalPrompt: string, size: string) {
  if (size === 'auto') return prompt
  const prefix = `Generate at ${size} resolution.`
  if (originalPrompt.trimStart().startsWith(prefix)) return prompt
  const trimmed = prompt.trimStart()
  if (!trimmed.startsWith(prefix)) return prompt
  return trimmed.slice(prefix.length).trimStart()
}

/** 计算整数宽高的最大公约数，用于展示和发送准确的自定义比例。 */
function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/** 校验外部保存的画布比例；保留用户的比例表达，非法值返回 undefined，auto 表示由模型决定。 */
export function normalizeImageAspectRatio(value: unknown): string | undefined {
  if (value === 'auto') return 'auto'
  if (typeof value !== 'string') return undefined
  const parsed = parseRatio(value)
  if (!parsed || Math.max(parsed.width, parsed.height) > Number.MAX_SAFE_INTEGER
    || Math.max(parsed.width, parsed.height) / Math.min(parsed.width, parsed.height) > MAX_ASPECT_RATIO) return undefined
  return `${parsed.width}:${parsed.height}`
}

/** 优先读取独立的目标比例；旧像素预设恢复原选择，自定义尺寸按真实宽高恢复，不修改历史记录。 */
export function getRequestedImageAspectRatio(params: Pick<TaskParams, 'size' | 'imageAspectRatio'>): string {
  if (params.imageAspectRatio !== undefined) return normalizeImageAspectRatio(params.imageAspectRatio) ?? 'auto'
  if (!SIZE_PATTERN.test(params.size)) return 'auto'
  const dimensions = parseRatio(params.size)
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)) return 'auto'
  for (const presets of Object.values(COMMON_SIZE_PRESETS)) {
    for (const [ratio, size] of Object.entries(presets)) if (size === params.size.trim()) return ratio
  }
  const ratio = dimensions.width / dimensions.height
  const nearest = COMMON_ASPECT_RATIOS.find(([width, height]) => Math.abs(ratio / (width / height) - 1) <= MAX_RATIO_ERROR)
  if (nearest) return `${nearest[0]}:${nearest[1]}`
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  return normalizeImageAspectRatio(`${dimensions.width / divisor}:${dimensions.height / divisor}`) ?? 'auto'
}

/** 为目标比例提供小画布请求建议；常见横竖版沿用真实接口验证值，不承诺返回这些像素。 */
export function getImageRatioSize(params: Pick<TaskParams, 'size' | 'imageAspectRatio'>): string {
  const ratio = getRequestedImageAspectRatio(params)
  if (ratio === 'auto') return 'auto'
  if (ratio === '16:9') return '1536x864'
  if (ratio === '9:16') return '864x1536'
  return calculateImageSize('1K', ratio) ?? 'auto'
}

/** 显式目标比例使用实测画布约束；无独立比例时保留旧构图尾注，兼容历史提示词清理。 */
export function getImageAspectRatioInstruction(size: string, aspectRatio?: string): string {
  if (aspectRatio !== undefined) {
    const ratio = normalizeImageAspectRatio(aspectRatio)
    const dimensions = ratio && parseRatio(ratio)
    if (!dimensions) return ''
    const orientation = dimensions.width === dimensions.height ? 'square' : dimensions.width > dimensions.height ? 'landscape' : 'portrait'
    return `The entire output image canvas must have exactly a ${ratio} width-to-height aspect ratio, ${orientation} orientation. Compose the image to fill that canvas edge to edge. Do not place a differently shaped picture inside a frame or add borders.`
  }
  if (!SIZE_PATTERN.test(size)) return ''
  const dimensions = parseRatio(size)
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)) return ''
  const ratio = dimensions.width / dimensions.height
  const nearest = COMMON_ASPECT_RATIOS.map(([width, height]) => ({
    label: `${width}:${height}`,
    ratio: width / height,
    delta: Math.abs(ratio / (width / height) - 1),
  })).sort((a, b) => a.delta - b.delta)[0]
  const divisor = greatestCommonDivisor(dimensions.width, dimensions.height)
  const label = nearest.delta <= MAX_RATIO_ERROR
    ? nearest.label
    : `${dimensions.width / divisor}:${dimensions.height / divisor}`
  const orientation = nearest.delta <= MAX_RATIO_ERROR && nearest.ratio === 1
    ? 'square'
    : ratio > 1 ? 'landscape' : 'portrait'
  return `Composition: ${label} aspect ratio, ${orientation} canvas.`
}

/** 在最终请求提示词中补充比例，兼容忽略 size 的上游；相同尾部指令只追加一次。 */
export function appendImageAspectRatioPrompt(prompt: string, size: string, aspectRatio?: string): string {
  const instruction = getImageAspectRatioInstruction(size, aspectRatio)
  if (!instruction || prompt.trimEnd().endsWith(instruction)) return prompt
  return `${prompt.trimEnd()}\n\n${instruction}`
}

/** 只清除本地追加的比例尾注用于改写比较，保留用户原文和上游的其他修改。 */
export function stripInjectedImageAspectRatioPrompt(prompt: string, originalPrompt: string, size: string, aspectRatio?: string): string {
  const instruction = getImageAspectRatioInstruction(size, aspectRatio)
  if (!instruction || originalPrompt.trimEnd().endsWith(instruction)) return prompt
  if (prompt === appendImageAspectRatioPrompt(originalPrompt, size, aspectRatio)) return originalPrompt
  const suffix = `\n\n${instruction}`
  const trimmed = prompt.trimEnd()
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length).trimEnd() : prompt
}

/** 比较请求与解码原图的宽高比；忽略 1% 内的规整误差，未知尺寸不作失败判断。 */
export function getImageAspectRatioWarning(requestedSize: string, actualSize: string): string {
  const requested = parseRatio(requestedSize)
  const actual = parseRatio(actualSize)
  if (!requested || !actual) return ''
  const difference = Math.abs((actual.width / actual.height) / (requested.width / requested.height) - 1)
  return difference > MAX_RATIO_ERROR ? `返回原图的比例与请求不符：请求 ${requestedSize}，实际 ${actualSize}。` : ''
}

export function parseRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

/** 根据原图宽高展示比例；近似常用比例带约等号，避免把规整像素误称为精确比例。 */
export function formatImageRatio(width: number, height: number) {
  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return ''
  }

  const divisor = greatestCommonDivisor(roundedWidth, roundedHeight)
  const simplifiedWidth = roundedWidth / divisor
  const simplifiedHeight = roundedHeight / divisor
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`
  const commonRatios = COMMON_ASPECT_RATIOS

  for (const [commonWidth, commonHeight] of commonRatios) {
    if (simplifiedWidth === commonWidth && simplifiedHeight === commonHeight) {
      return simplified
    }
  }

  const actualRatio = roundedWidth / roundedHeight
  const nearest = commonRatios
    .map(([commonWidth, commonHeight]) => {
      const ratio = commonWidth / commonHeight
      return {
        label: `${commonWidth}:${commonHeight}`,
        delta: Math.abs(actualRatio - ratio) / ratio,
      }
    })
    .sort((a, b) => a.delta - b.delta)[0]

  if (nearest && nearest.delta <= 0.01) return `≈${nearest.label}`

  const friendlyNearest = Array.from({ length: 12 }, (_, widthIndex) => widthIndex + 1)
    .flatMap((friendlyWidth) =>
      Array.from({ length: 12 }, (_, heightIndex) => heightIndex + 1).map((friendlyHeight) => {
        const ratio = friendlyWidth / friendlyHeight
        const delta = Math.abs(actualRatio - ratio) / ratio
        return {
          label: `${friendlyWidth}:${friendlyHeight}`,
          delta,
          // 在误差接近时偏向更短、更好读的比例，例如 7:6 优于 8:7。
          score: delta + (friendlyWidth + friendlyHeight) * 0.002,
        }
      }),
    )
    .filter((item) => item.label !== simplified)
    .sort((a, b) => a.score - b.score)[0]

  return friendlyNearest && friendlyNearest.delta <= MAX_RATIO_ERROR ? `≈${friendlyNearest.label}` : simplified
}

/**
 * 每个档位的像素预算上限。
 * 在该预算内、满足所有 OpenAI 约束的前提下，选取总像素最大的候选尺寸。
 */
const TIER_PIXEL_BUDGET: Record<SizeTier, number> = {
  '1K': MAX_1K_PIXELS, // 1024 × 1536
  '2K': 4_194_304,   // 2048 × 2048
  '4K': MAX_PIXELS,  // 8_294_400
}

/**
 * 常用比例优先使用官方示例或通用显示标准，避免按像素预算计算出不常见尺寸。
 * 其中 21:9 的常见显示器尺寸会按 16 倍数约束做轻微规整。
 */
const COMMON_SIZE_PRESETS: Record<SizeTier, Record<PresetRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1280x544',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '21:9': '2560x1088',
  },
  '4K': {
    '1:1': '2880x2880',
    '3:2': '3456x2304',
    '2:3': '2304x3456',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3200x2400',
    '3:4': '2400x3200',
    '21:9': '3840x1600',
  },
}

function getPresetRatioKey(ratioWidth: number, ratioHeight: number): PresetRatio | null {
  if (!Number.isInteger(ratioWidth) || !Number.isInteger(ratioHeight)) return null

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(ratioWidth, ratioHeight)
  const key = `${ratioWidth / divisor}:${ratioHeight / divisor}`

  return key in COMMON_SIZE_PRESETS['1K'] ? key as PresetRatio : null
}

const MAX_RATIO_ERROR = 0.01

export function calculateImageSize(tier: SizeTier, ratio: string) {
  const parsed = parseRatio(ratio)
  if (!parsed) return null

  const { width: ratioWidth, height: ratioHeight } = parsed
  const presetRatioKey = getPresetRatioKey(ratioWidth, ratioHeight)
  if (presetRatioKey) return COMMON_SIZE_PRESETS[tier][presetRatioKey]

  const targetRatio = ratioWidth / ratioHeight
  const pixelBudget = TIER_PIXEL_BUDGET[tier]

  let bestWidth = 0
  let bestHeight = 0
  let bestPixels = 0

  for (let w = SIZE_MULTIPLE; w <= MAX_EDGE; w += SIZE_MULTIPLE) {
    const idealH = w / targetRatio
    // 尝试 floor 和 ceil 对齐到 16 的倍数，取像素更大且合法的那个
    const candidates = [
      Math.floor(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
      Math.ceil(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
    ]

    for (const h of candidates) {
      if (h < SIZE_MULTIPLE || h > MAX_EDGE) continue

      const pixels = w * h
      if (pixels > pixelBudget || pixels < MIN_PIXELS) continue
      if (Math.max(w / h, h / w) > MAX_ASPECT_RATIO) continue

      const actualRatio = w / h
      const ratioError = Math.abs(actualRatio - targetRatio) / targetRatio
      if (ratioError > MAX_RATIO_ERROR) continue

      if (pixels > bestPixels) {
        bestPixels = pixels
        bestWidth = w
        bestHeight = h
      }
    }
  }

  if (bestPixels === 0) return null
  return `${bestWidth}x${bestHeight}`
}
