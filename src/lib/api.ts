import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { getGrokImageInputError } from './grokImage'
import { normalizeParamsForSettings } from './paramCompatibility'
import { getSiteProfileError } from './siteProfiles'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

/** 按配置分派图片请求；先校验本站连接，再校验及适配 Grok 参数和图片格式。 */
export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  const siteError = getSiteProfileError(profile)
  if (siteError) throw new Error(siteError)
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)
  if (profile.provider === 'grok') {
    const error = getGrokImageInputError(profile, opts.inputImageDataUrls.length, Boolean(opts.maskDataUrl))
    if (error) throw new Error(error)
    if (!opts.prompt.trim()) throw new Error('请输入提示词')
    return callOpenAICompatibleImageApi({
      ...opts,
      params: normalizeParamsForSettings(opts.params, opts.settings),
      nativeTransparentBackground: false,
    }, profile, getCustomProviderDefinition(opts.settings, profile.provider))
  }

  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
