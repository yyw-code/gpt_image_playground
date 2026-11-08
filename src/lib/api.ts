import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { getGrokImageInputError } from './grokImage'
import { normalizeParamsForSettings } from './paramCompatibility'
import { getSiteProfileError } from './siteProfiles'
import { getImageParameterCapabilities } from './imageModels'
import { getBase64ImageFormat, normalizeBase64Image } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

/** 校验连接与供应商限制，按当前通道能力过滤原生透明背景，并保留真实返回格式、张数。 */
export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  const siteError = getSiteProfileError(profile)
  if (siteError) throw new Error(siteError)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)
  if (profile.provider === 'grok') {
    const error = getGrokImageInputError(profile, opts.inputImageDataUrls.length, Boolean(opts.maskDataUrl))
    if (error) throw new Error(error)
    if (!opts.prompt.trim()) throw new Error('请输入提示词')
  }
  const params = normalizeParamsForSettings(opts.params, opts.settings, { hasInputImages: opts.inputImageDataUrls.length > 0 })
  let delivered = false
  const result = await callOpenAICompatibleImageApi({
    ...opts,
    params,
    onImageResult: opts.onImageResult ? async (event) => {
      delivered = true
      await opts.onImageResult?.({ ...event, result: profile.provider === 'openai' ? normalizeFinalImageResult(event.result) : event.result })
    } : undefined,
    nativeTransparentBackground: getImageParameterCapabilities(profile).transparency
      && (profile.provider !== 'openai' || params.output_format !== 'jpeg') && opts.nativeTransparentBackground,
  }, profile, getCustomProviderDefinition(opts.settings, profile.provider))
  if (!delivered) await opts.onImageResult?.({ requestIndex: 0, result: profile.provider === 'openai' ? normalizeFinalImageResult(result) : result })
  if (profile.provider !== 'openai') return result
  return normalizeFinalImageResult(result)
}

/** 最终回调与整批返回使用相同的 MIME 和实际格式，避免逐张保存丢失元数据。 */
function normalizeFinalImageResult(result: CallApiResult): CallApiResult {
  const actualParamsList = result.images.map((image, index) => {
    const format = getBase64ImageFormat(image)
    return { ...(result.actualParamsList?.[index] ?? result.actualParams), ...(format ? { output_format: format } : {}) }
  })
  return {
    ...result,
    images: result.images.map((image) => normalizeBase64Image(image, 'image/png')),
    actualParams: { ...result.actualParams, ...actualParamsList[0], n: result.images.length },
    actualParamsList,
  }
}
