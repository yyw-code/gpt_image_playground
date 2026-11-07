import type { ApiProfile, TaskParams, TaskRecord } from '../types'
import { normalizeModelImageSize, type ImageSizeMode } from './size'

export const DEFAULT_IMAGES_MODEL = 'gpt-image-2.5-sunburst'

/** 获取真正的图片模型；Responses 顶层 model 是文本模型，不能用于图片能力判断。 */
export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

/** 保留第三方供应商既有的 2.5 别名识别；OpenAI 原生能力使用下方精确匹配。 */
export function isGptImage25Model(model: string) {
  return model.trim().toLowerCase().includes('gpt-image-2.5')
}

interface ImageParameterCapabilities {
  sizeMode: ImageSizeMode
  qualities: TaskParams['quality'][]
  /** 是否能够向接口发送格式、压缩和审核等原生参数。 */
  nativeOutput: boolean
  /** 仅已确认支持的原生 Images 通道开放构图复杂度。 */
  complexity?: boolean
}

/** 按供应商、已知通道和图片模型提供统一能力；不根据密钥或域名猜测上游身份。 */
export function getImageParameterCapabilities(profile: ApiProfile): ImageParameterCapabilities {
  if (profile.provider === 'grok') return {
    sizeMode: 'grok',
    qualities: profile.model === 'grok-imagine-image-2.0' ? ['auto', 'low', 'medium'] : ['auto'],
    nativeOutput: false,
  }
  if (profile.codexCli && profile.provider !== 'fal') return { sizeMode: 'composition', qualities: ['auto'], nativeOutput: false }
  const model = getImageGenerationModel(profile).trim().toLowerCase()
  const standardQuality: TaskParams['quality'][] = ['auto', 'low', 'medium', 'high']
  if (profile.provider === 'openai') {
    if (['gpt-image-1.5', 'gpt-image-1.5-2025-12-16'].includes(model)) return { sizeMode: 'fixed', qualities: standardQuality, nativeOutput: true }
    if (['gpt-image-2', 'gpt-image-2-2026-04-21'].includes(model)) return { sizeMode: 'custom', qualities: standardQuality, nativeOutput: true }
    if (/^gpt-image-2\.5-(sunburst|flare)(-2026-09-08)?$/.test(model)) return { sizeMode: 'custom', qualities: [...standardQuality, 'xhigh', 'max'], nativeOutput: true }
    if (/^gpt-image-2\.6-(sunburst|flare)$/.test(model)) return {
      sizeMode: 'custom', qualities: [...standardQuality, 'xhigh', 'max'], nativeOutput: true,
      complexity: profile.apiMode === 'images',
    }
    return { sizeMode: 'auto', qualities: ['auto'], nativeOutput: false }
  }
  return { sizeMode: 'custom', qualities: isGptImage25Model(model) ? [...standardQuality, 'xhigh', 'max'] : standardQuality, nativeOutput: true }
}

/** 记录任务使用的参数模式，供历史结果核对；Grok 沿用独立原生参数规则，未知通道不声称发送了参数。 */
export function getImageParameterMode(profile: ApiProfile): NonNullable<TaskRecord['imageParameterMode']> {
  const capabilities = getImageParameterCapabilities(profile)
  if (capabilities.sizeMode === 'composition') return 'composition'
  return capabilities.nativeOutput || profile.provider === 'grok' ? 'native' : 'default'
}

/** 只组装当前通道支持的原生字段；画廊和 Agent 发送前复用，防止隐藏参数残留。 */
export function getImageRequestParameters(params: TaskParams, profile: ApiProfile): Partial<TaskParams> {
  const capabilities = getImageParameterCapabilities(profile)
  if (!capabilities.nativeOutput) return {}
  return {
    size: normalizeModelImageSize(params.size, capabilities.sizeMode),
    quality: capabilities.qualities.includes(params.quality) ? params.quality : 'high',
    output_format: params.output_format,
    moderation: params.moderation,
    ...(capabilities.complexity && ['low', 'medium', 'high'].includes(params.complexity ?? '') ? { complexity: params.complexity } : {}),
    ...(params.output_format !== 'png' && params.output_compression != null ? { output_compression: params.output_compression } : {}),
  }
}
