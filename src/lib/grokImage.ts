import type { ApiProfile, CustomProviderDefinition, TaskParams } from '../types'
import type { CallApiResult } from './imageApiShared'

export const GROK_IMAGE_MODELS = ['grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality']
export const GROK_IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20']
export const MAX_GROK_INPUT_IMAGES = 3

const GROK_IMAGE_BODY = {
  model: '$profile.model',
  prompt: '$prompt',
  n: '$params.n',
  response_format: 'b64_json',
  resolution: '$params.resolution',
  aspect_ratio: '$params.aspect_ratio',
}
const GROK_IMAGE_RESULT = { imageUrlPaths: ['data.*.url'], b64JsonPaths: ['data.*.b64_json'] }

// 复用同步 HTTP 供应商链路；Sub2API 会把编辑请求中的 data URL 规范化为上游图片对象。
export const GROK_IMAGE_PROVIDER: CustomProviderDefinition = {
  id: 'grok',
  name: 'Grok（Sub2API）',
  template: 'http-image',
  submit: { path: 'images/generations', contentType: 'json', body: GROK_IMAGE_BODY, result: GROK_IMAGE_RESULT },
  editSubmit: { path: 'images/edits', contentType: 'json', body: { ...GROK_IMAGE_BODY, images: '$inputImages.dataUrls' }, result: GROK_IMAGE_RESULT },
}

/** 校验外部配置或历史记录中的 Grok 分辨率；不认识的值不恢复。 */
export function normalizeGrokResolution(value: unknown): TaskParams['resolution'] {
  return value === '1k' || value === '2k' ? value : undefined
}

/** 校验 Grok 原生比例；保留合法比例原值，不按 GPT 的像素规则规整。 */
export function normalizeGrokAspectRatio(value: unknown): string | undefined {
  return typeof value === 'string' && GROK_IMAGE_ASPECT_RATIOS.includes(value) ? value : undefined
}

/** 在画廊、Agent 和历史重试共用入口检查 Grok 能力；不改变或截断输入草稿。 */
export function getGrokImageInputError(profile: ApiProfile, inputCount: number, hasMask: boolean): string | null {
  if (profile.provider !== 'grok') return null
  if (!GROK_IMAGE_MODELS.includes(profile.model)) return '请选择 Grok 图片生成模型'
  if (hasMask) return 'Grok 暂不支持遮罩编辑，请移除遮罩或切换图片配置；现有草稿已保留。'
  if (inputCount > MAX_GROK_INPUT_IMAGES) return `Grok 最多支持 ${MAX_GROK_INPUT_IMAGES} 张参考图，请移除多余图片后重试。`
  return null
}

/** 根据返回图片的文件头修正 MIME 和实际格式，避免把 Grok JPEG 数据误标成 PNG。 */
export function normalizeGrokImageResult(result: CallApiResult): CallApiResult {
  const formats = result.images.map((image) => {
    const encoded = image.slice(image.indexOf(',') + 1)
    if (encoded.startsWith('iVBORw0KGgo')) return 'png' as const
    if (encoded.startsWith('/9j/')) return 'jpeg' as const
    if (encoded.startsWith('UklGR') && encoded.length >= 16 && atob(encoded.slice(0, 16)).slice(8, 12) === 'WEBP') return 'webp' as const
    throw new Error('Grok 返回的图片格式无法识别，支持 PNG、JPEG 和 WebP。')
  })
  return {
    ...result,
    actualParams: { ...result.actualParams, ...(formats[0] ? { output_format: formats[0] } : {}) },
    images: result.images.map((image, index) => formats[index] ? image.replace(/^data:[^;]+;/, `data:image/${formats[index]};`) : image),
    actualParamsList: result.images.map((_, index) => ({
      ...(result.actualParamsList?.[index] ?? result.actualParams),
      ...(formats[index] ? { output_format: formats[index] } : {}),
    })),
  }
}
