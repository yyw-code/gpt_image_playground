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
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

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

/** 将请求像素转为构图指令；常见比例允许规整误差，auto 或无效尺寸不追加要求。 */
export function getImageAspectRatioInstruction(size: string): string {
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
export function appendImageAspectRatioPrompt(prompt: string, size: string): string {
  const instruction = getImageAspectRatioInstruction(size)
  if (!instruction || prompt.trimEnd().endsWith(instruction)) return prompt
  return `${prompt.trimEnd()}\n\n${instruction}`
}

/** 只清除本地追加的比例尾注用于改写比较，保留用户原文和上游的其他修改。 */
export function stripInjectedImageAspectRatioPrompt(prompt: string, originalPrompt: string, size: string): string {
  const instruction = getImageAspectRatioInstruction(size)
  if (!instruction || originalPrompt.trimEnd().endsWith(instruction)) return prompt
  if (prompt === appendImageAspectRatioPrompt(originalPrompt, size)) return originalPrompt
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
  const squareDelta = Math.abs(actualRatio - 1)
  if (squareDelta <= 0.18) return '≈1:1'

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

  return friendlyNearest && friendlyNearest.delta <= 0.04 ? `≈${friendlyNearest.label}` : simplified
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
