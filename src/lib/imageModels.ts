import type { ApiProfile, TaskParams, TaskRecord } from '../types'
import { getImageRatioSize, normalizeModelImageSize, type ImageSizeMode } from './size'
import { IS_SITE_MODE } from './siteMode'
import { isSiteApiProfile } from './siteProfiles'

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

interface ModelImageCapabilities {
  sizeMode: ImageSizeMode
  qualities: TaskParams['quality'][]
  /** 是否具备原生参数协议；具体输出字段须分别检查能力。 */
  nativeOutput: boolean
  /** 仅已确认支持的原生 Images 通道开放构图复杂度。 */
  complexity?: boolean
}

/** 按供应商、已知通道和图片模型提供统一能力；不根据密钥或域名猜测上游身份。 */
function getModelImageCapabilities(profile: ApiProfile): ModelImageCapabilities {
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

interface ImageParameterCapabilities extends ModelImageCapabilities {
  formats: TaskParams['output_format'][]
  compression: boolean
  transparency: boolean
  moderation: boolean
  /** 本站验证策略不外溢到外站或自定义供应商。 */
  siteRestricted: boolean
  formatReasons: Partial<Record<TaskParams['output_format'], string>>
  qualityReason: string
  outputReason: string
}

/** 本站六组合实测通过的非流式模型组合；其他模型、CLI 或流式不能借用此验证结果。 */
export function supportsSiteResponsesFormats(profile: ApiProfile): boolean {
  return IS_SITE_MODE && isSiteApiProfile(profile) && profile.provider === 'openai'
    && profile.apiMode === 'responses' && !profile.codexCli && !profile.streamImages
    && profile.model.trim() === 'gpt-6.1-sol' && getImageGenerationModel(profile) === 'gpt-image-2.5-sunburst'
}

/** 合并模型协议与本站实测边界；已验证的 Responses 组合开放三格式，不改变 Images 的限制。 */
export function getImageParameterCapabilities(profile: ApiProfile): ImageParameterCapabilities {
  const model = getModelImageCapabilities(profile)
  const siteRestricted = IS_SITE_MODE && profile.provider === 'openai' && isSiteApiProfile(profile)
  const outputReason = siteRestricted
    ? '当前本站通道尚未验证此参数，暂不可用'
    : '当前模型或通道不支持此参数，使用接口默认值'
  const formats: TaskParams['output_format'][] = !model.nativeOutput ? [] : siteRestricted && !supportsSiteResponsesFormats(profile) ? ['png'] : ['png', 'jpeg', 'webp']
  return {
    ...model,
    ...(siteRestricted ? { qualities: ['auto'] as TaskParams['quality'][], complexity: false } : {}),
    formats,
    compression: model.nativeOutput && !siteRestricted && profile.provider !== 'fal',
    transparency: model.nativeOutput && !siteRestricted,
    moderation: model.nativeOutput && !siteRestricted && profile.provider !== 'fal',
    siteRestricted,
    formatReasons: Object.fromEntries((['png', 'jpeg', 'webp'] as const).filter((format) => !formats.includes(format)).map((format) => [format,
      siteRestricted && format !== 'png'
        ? profile.apiMode === 'images' && format === 'webp'
          ? '当前本站 Images 通道请求 WebP 实际返回 PNG，暂不可用'
          : profile.apiMode === 'responses'
            ? '此组合尚未验证；三格式需 gpt-6.1-sol + gpt-image-2.5-sunburst，并关闭 CLI 和流式'
            : `当前本站 Images 通道的 ${format.toUpperCase()} 与比例组合尚未验证，暂不可用`
        : outputReason,
    ])),
    qualityReason: siteRestricted ? '当前本站通道未确认可控制质量，仅开放接口自动' : outputReason,
    outputReason,
  }
}

/** 检查输出约束并返回字段错误；保留草稿供用户修正，PNG 在无原生格式参数时仅作为默认占位。 */
export function getImageOutputIssues(params: TaskParams, profile: ApiProfile) {
  const capabilities = getImageParameterCapabilities(profile)
  const issues: Partial<Record<'quality' | 'output_format' | 'output_compression' | 'transparent_output' | 'moderation' | 'complexity', string>> = {}
  if (!capabilities.qualities.includes(params.quality)) issues.quality = `质量不可用：${capabilities.qualityReason}`
  if (!capabilities.formats.includes(params.output_format) && !(capabilities.formats.length === 0 && params.output_format === 'png')) issues.output_format = `格式不可用：${capabilities.formatReasons[params.output_format] ?? capabilities.outputReason}`
  if (params.output_compression != null && (!capabilities.compression || params.output_format === 'png' || !Number.isInteger(params.output_compression) || params.output_compression < 0 || params.output_compression > 100)) issues.output_compression = '压缩率不可用：仅支持可用通道的 JPEG / WebP，范围为 0–100 的整数'
  const localBackground = profile.provider !== 'grok' && capabilities.sizeMode !== 'auto' && profile.transparentBackgroundMethod === 'local'
  if (params.transparent_output && (params.output_format === 'jpeg' || !(capabilities.transparency || localBackground))) issues.transparent_output = `透明背景不可用：${params.output_format === 'jpeg' ? 'JPEG 不支持透明背景' : capabilities.outputReason}`
  if (params.moderation !== 'auto' && !capabilities.moderation) issues.moderation = `审核参数不可用：${capabilities.outputReason}`
  if (params.complexity && (!capabilities.complexity || !['low', 'medium', 'high'].includes(params.complexity))) issues.complexity = `构图复杂度不可用：${capabilities.outputReason}`
  return issues
}

/** 记录任务使用的参数模式，供历史结果核对；Grok 沿用独立原生参数规则，未知通道不声称发送了参数。 */
export function getImageParameterMode(profile: ApiProfile): NonNullable<TaskRecord['imageParameterMode']> {
  const capabilities = getImageParameterCapabilities(profile)
  if (capabilities.sizeMode === 'composition') return 'composition'
  return capabilities.nativeOutput || profile.provider === 'grok' ? 'native' : 'default'
}

/** 本站已识别的 ChatGPT 模型及兼容通道使用目标比例；不依据密钥或域名猜测上游身份。 */
export function usesImageAspectRatio(profile: ApiProfile): boolean {
  if (profile.provider === 'grok' || profile.provider === 'fal') return false
  return profile.codexCli || IS_SITE_MODE && profile.provider === 'openai' && getImageParameterCapabilities(profile).sizeMode !== 'auto'
}

/** 只组装当前通道支持的字段；本站无效参数抛错，画廊和 Agent 均不得静默降级或绕过限制。 */
export function getImageRequestParameters(params: TaskParams, profile: ApiProfile): Partial<TaskParams> {
  const capabilities = getImageParameterCapabilities(profile)
  if (capabilities.siteRestricted) {
    const error = Object.values(getImageOutputIssues(params, profile))[0]
    if (error) throw new Error(error)
  }
  if (!capabilities.nativeOutput) return {}
  return {
    size: normalizeModelImageSize(usesImageAspectRatio(profile) ? getImageRatioSize(params) : params.size, capabilities.sizeMode),
    quality: capabilities.qualities.includes(params.quality) ? params.quality : 'high',
    ...(capabilities.formats.includes(params.output_format) ? { output_format: params.output_format } : {}),
    ...(capabilities.moderation ? { moderation: params.moderation } : {}),
    ...(capabilities.complexity && ['low', 'medium', 'high'].includes(params.complexity ?? '') ? { complexity: params.complexity } : {}),
    ...(capabilities.compression && params.output_format !== 'png' && params.output_compression != null ? { output_compression: params.output_compression } : {}),
  }
}
