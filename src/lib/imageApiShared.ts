import type { AppSettings, ResponsesOutputItem, TaskParams } from '../types'
import { blobToDataUrl } from './dataUrl'
import { apiFetch, isTauri } from './platform'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024
export const PROMPT_REWRITE_GUARD_PREFIX = 'Treat everything after this line as one complete image-generation prompt, including the resolution instruction. Follow it exactly without rewriting or omitting anything:'

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  nativeTransparentBackground?: boolean
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  skipCodexCliSizePrompt?: boolean
  /** 返回任务是否已失效；分批生成在提交下一批前检查，避免继续产生费用。 */
  isCancelled?: () => boolean
  /** 外部任务取消信号；等待中的图片请求可立即退出队列。 */
  signal?: AbortSignal
  /** 单图请求进入队列或实际执行时通知页面，序号相对于本次请求。 */
  onRequestState?: (event: { requestIndex: number; state: 'queued' | 'running' | 'finished'; position: number }) => void
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 并发多图请求中失败的单张请求 */
  failedRequests?: Array<{ requestIndex: number; error: string }>
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

/** 依据图片文件头识别原始格式；未知内容不把请求格式当成已核实的实际格式。 */
export function getBase64ImageFormat(value: string): TaskParams['output_format'] | undefined {
  const encoded = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
  if (encoded.startsWith('iVBORw0KGgo')) return 'png'
  if (encoded.startsWith('/9j/')) return 'jpeg'
  if (encoded.startsWith('UklGR') && /^[A-Za-z0-9+/]{16}/.test(encoded) && atob(encoded.slice(0, 16)).slice(8, 12) === 'WEBP') return 'webp'
  return undefined
}

/** 用可识别的文件头修正 MIME；无法识别时保留接口 data URL 或调用方缺省格式。 */
export function normalizeBase64Image(value: string, fallbackMime: string): string {
  const format = getBase64ImageFormat(value)
  const encoded = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
  if (format) return `data:${MIME_MAP[format]};base64,${encoded}`
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

export function getResponsesImageResultBase64(result: ResponsesOutputItem['result']): string | undefined {
  const b64 = typeof result === 'string'
    ? result
    : result && typeof result === 'object'
    ? typeof result.b64_json === 'string'
      ? result.b64_json
      : typeof result.base64 === 'string'
      ? result.base64
      : typeof result.image === 'string'
      ? result.image
      : typeof result.data === 'string'
      ? result.data
      : ''
    : ''

  return b64.trim() ? b64 : undefined
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

const IMAGE_TOOL_DROPPED_ERROR = /Tool choice 'required' must be specified with 'tools' parameter\./i
export const IMAGE_TOOL_DROPPED_HINT = '提示：当前使用的 API 可能未正确转发图像生成工具，请尝试更换支持该工具的接口或模型。'
export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'
export const TRANSPARENT_BACKGROUND_UNSUPPORTED_HINT = '提示：当前使用的 API 不支持为该模型使用原生透明背景，请将「透明背景实现方式」切换为「本地后处理」。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

export function maybeAppendTransparentBackgroundHint(message: string): string {
  if (!/transparent background is not supported for this model\.?/i.test(message)) return message
  return `${message}\n${TRANSPARENT_BACKGROUND_UNSUPPORTED_HINT}`
}

/** 部分 API 转发 Responses 请求时会丢弃 image_generation 工具，却保留 tool_choice，服务端因此报错 */
export function maybeAppendImageToolDroppedHint(message: string): string {
  if (!IMAGE_TOOL_DROPPED_ERROR.test(message)) return message
  return `${message}\n${IMAGE_TOOL_DROPPED_HINT}`
}

/** 请求超时中止时使用的原因，替代浏览器默认的英文“signal is aborted without reason”；仍为 AbortError，不改变错误分类 */
export function createRequestTimeoutError(timeoutSeconds: number) {
  return new DOMException(`请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。`, 'AbortError')
}

/** 排除明确与流式无关的状态码后追加提示 */
export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  const transparentMessage = maybeAppendTransparentBackgroundHint(message)
  if (transparentMessage !== message) return transparentMessage
  if (IMAGE_TOOL_DROPPED_ERROR.test(message)) return message
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500) {
    return message
  }
  return appendStreamingUnsupportedHint(message)
}

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await apiFetch(url, {
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      // 客户端由 Rust 侧发出请求，不存在跨域问题，也不需要 no-cors 探测
      if (isTauri) throw new Error(`图片链接下载失败（可能因链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`)
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`)
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

/** 读取接口错误；图片网关并发限制补充中文说明，并保留原始消息便于排查。 */
export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  const textResponse = response.clone()
  try {
    const errJson = await response.json()
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail)) errorMsg = errJson.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
    if (errJson.error?.code === 'gateway_concurrency_limit' && String(errorMsg).includes('Image generation concurrency')) {
      errorMsg = `图片生成通道繁忙，等待后仍未获得空位，请稍后手动重试。\n原始错误：${errorMsg}`
    }
  } catch {
    try {
      errorMsg = await textResponse.text()
    } catch {
      /* ignore */
    }
  }
  return errorMsg
}

/** 提取接口回显；已识别的图片文件格式优先于文字元数据，不伪造缺失的质量值。 */
export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.complexity === 'low' || record.complexity === 'medium' || record.complexity === 'high') actualParams.complexity = record.complexity
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high' || record.quality === 'xhigh' || record.quality === 'max') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n
  const b64 = typeof record.b64_json === 'string' ? record.b64_json : getResponsesImageResultBase64(record.result as ResponsesOutputItem['result'])
  const format = b64 ? getBase64ImageFormat(b64) : undefined
  if (format) actualParams.output_format = format

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
