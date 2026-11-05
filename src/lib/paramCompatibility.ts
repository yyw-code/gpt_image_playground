import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile, isOpenAICompatibleProvider } from './apiProfiles'
import { getImageParameterCapabilities } from './imageModels'
import { normalizeImageSize, normalizeModelImageSize } from './size'
import { getGrokAspectRatios, normalizeGrokResolution } from './grokImage'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

/** 返回单个画廊任务的目标张数上限；与拆分请求的并发数无关。 */
export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

/** 根据图片模型及通道规范参数，统一清理 OpenAI 和自定义 Codex 通道的隐藏字段。 */
export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const capabilities = getImageParameterCapabilities(activeProfile)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, Number.isFinite(params.n) ? Math.trunc(params.n) : 1)),
  }
  if (!capabilities.complexity || !['low', 'medium', 'high'].includes(params.complexity ?? '')) delete nextParams.complexity

  if (activeProfile.provider === 'grok') {
    return {
      ...nextParams,
      size: 'auto',
      resolution: normalizeGrokResolution(params.resolution) ?? '1k',
      aspect_ratio: getGrokAspectRatios(activeProfile.model).includes(params.aspect_ratio ?? '') ? params.aspect_ratio : '1:1',
      quality: capabilities.qualities.includes(params.quality) ? params.quality : 'auto',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      transparent_output: false,
    }
  }

  if (isOpenAICompatibleProvider(settings, activeProfile.provider) && activeProfile.codexCli) {
    nextParams.size = normalizeModelImageSize(nextParams.size, 'composition')
  }

  if (activeProfile.provider === 'fal') {
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (activeProfile.provider === 'openai') nextParams.size = normalizeModelImageSize(params.size, capabilities.sizeMode)
  if (!capabilities.qualities.includes(nextParams.quality)) {
    nextParams.quality = capabilities.qualities.includes('high') ? 'high' : 'auto'
  }
  if (!capabilities.nativeOutput) {
    nextParams.output_format = 'png'
    nextParams.output_compression = null
    nextParams.moderation = 'auto'
    // 受限通道只允许明确选择的本地去背景，不借用接口原生透明能力。
    if (activeProfile.transparentBackgroundMethod !== 'local' || capabilities.sizeMode === 'auto') nextParams.transparent_output = false
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

/** 提交变化及被移除的可选参数，避免隐藏选项残留或规范化 effect 重复更新。 */
export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)]) as Set<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
