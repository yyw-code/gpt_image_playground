import type { ApiProfile, AppSettings, CustomProviderDefinition, PresetAgentConfig, PresetConfig } from '../types'
import { createDefaultOpenAIProfile, getPresetAgentSettings, normalizeSettings } from './apiProfiles'
import { readRuntimeEnv } from './runtimeEnv'
import { IS_SITE_MODE } from './siteMode'
import { getSiteConnection, isSiteApiProfile, setSiteConnection } from './siteProfiles'

const RAW_SHOW_PRESET_CONFIG_ONLY = readRuntimeEnv(import.meta.env.VITE_SHOW_PRESET_CONFIG_ONLY, 'VITE_SHOW_PRESET_CONFIG_ONLY')
const SHOW_PRESET_CONFIG_ONLY = (RAW_SHOW_PRESET_CONFIG_ONLY || readRuntimeEnv(import.meta.env.VITE_SHOW_DEFAULT_CONFIG_ONLY, 'VITE_SHOW_DEFAULT_CONFIG_ONLY')) === 'true'
const LOCK_PRESET_CONFIG_PARAMS = readRuntimeEnv(import.meta.env.VITE_LOCK_PRESET_CONFIG_PARAMS, 'VITE_LOCK_PRESET_CONFIG_PARAMS') === 'true'
const PREVENT_PRESET_CONFIG_DELETION = readRuntimeEnv(import.meta.env.VITE_PREVENT_PRESET_CONFIG_DELETION, 'VITE_PREVENT_PRESET_CONFIG_DELETION') === 'true'

let presetProfiles: ApiProfile[] = []
let presetProviders: CustomProviderDefinition[] = []
let presetProfileFields: Record<string, string[]> | undefined
let presetAgent: PresetAgentConfig | undefined
let defaultPresetProfileId: string | null = null

/** 注册部署预置及本站连接；用户备份导入不能调用此入口改变站点地址。 */
export function setPresetConfig(settings: PresetConfig & {
  presetProfileFields?: Record<string, string[]>
} | null) {
  presetProfiles = settings?.profiles.map((profile) => ({ ...profile })) ?? []
  presetProviders = settings?.customProviders.map((provider) => ({ ...provider })) ?? []
  presetProfileFields = settings?.presetProfileFields
  presetAgent = settings?.agent ? { ...settings.agent } : undefined
  defaultPresetProfileId = presetProfiles.length === 1
    ? presetProfiles[0].id
    : presetProfiles.find((profile) => profile.isDefault === true)?.id ?? null
  setSiteConnection(presetProfiles.find((profile) => profile.id === defaultPresetProfileId && profile.provider === 'openai')
    ?? presetProfiles.find((profile) => profile.provider === 'openai'))
}

export function getPresetProfileIds() {
  return new Set(presetProfiles.map((profile) => profile.id))
}

/** 读取预置说明，兼容本站为保留旧地址而创建的预置别名。 */
export function getPresetProfileDescription(id: string) {
  return presetProfiles.find((profile) => profile.id === getPresetProfileSourceId(id))?.description
}

export function getPresetProviderIds() {
  return new Set(presetProviders.map((provider) => provider.id))
}

export function getPresetConfig() {
  if (presetProfiles.length === 0 && presetProviders.length === 0) return null
  return {
    customProviders: presetProviders.map((provider) => ({ ...provider })),
    profiles: presetProfiles.map((profile) => ({ ...profile })),
    presetProfileFields,
    ...(presetAgent ? { agent: { ...presetAgent } } : {}),
  }
}

export function getDefaultPresetProfileId() {
  return defaultPresetProfileId
}

export function getDefaultPresetBaseUrl() {
  const profile = presetProfiles.find((profile) => profile.id === defaultPresetProfileId)
  if (!profile || profile.provider === 'fal') return ''
  return profile.baseUrl
}

/** 将本站冲突预置的保留后缀还原为部署 ID，确保删除记录和参数锁定可跨刷新恢复。 */
export function getPresetProfileSourceId(id: string) {
  return presetProfiles.find((profile) => profile.id === id)?.id
    ?? (IS_SITE_MODE ? presetProfiles.find((profile) => id.startsWith(profile.id) && /^(?:-site)+$/.test(id.slice(profile.id.length)))?.id : undefined)
    ?? id
}

/** 判断当前配置是否为部署预置，包含本站保留旧连接后产生的别名。 */
export function isPresetProfile(id: string) {
  return presetProfiles.some((profile) => profile.id === getPresetProfileSourceId(id))
}

export function isPresetProvider(id: string) {
  return presetProviders.some((provider) => provider.id === id)
}

/** 仅显式部署限制才禁用配置管理；站点模式本身允许保存多套本站配置。 */
export function isPresetConfigOnlyEnabled() {
  return SHOW_PRESET_CONFIG_ONLY && presetProfiles.length > 0
}

export function isPresetConfigParamsLocked() {
  return LOCK_PRESET_CONFIG_PARAMS && presetProfiles.length > 0
}

/** 仅在部署明确要求时阻止删除预置配置。 */
export function isPresetConfigDeletionPrevented() {
  return (PREVENT_PRESET_CONFIG_DELETION || SHOW_PRESET_CONFIG_ONLY) && presetProfiles.length > 0
}

export function isPresetProfileLocked(id: string) {
  return isPresetConfigParamsLocked() && isPresetProfile(id)
}

export function isPresetAgentFieldLocked(field: keyof PresetAgentConfig) {
  return isPresetConfigParamsLocked() && presetAgent?.[field] !== undefined
}

/** 站点供应商定义由部署端管理；普通模式沿用完整参数锁定选项。 */
export function isPresetProviderLocked(id: string) {
  return (IS_SITE_MODE || isPresetConfigParamsLocked()) && isPresetProvider(id)
}

export function isPresetProviderDeletionPrevented(id: string, profiles: ApiProfile[]) {
  if (!isPresetProvider(id)) return false
  if (isPresetConfigDeletionPrevented()) return true
  return profiles.some((profile) => profile.provider === id && isPresetProfileLocked(profile.id))
}

/** 保留外站数据并限制活动引用；启动时安全加入部署预置，ID 冲突时另建空密钥配置。 */
function enforceSiteConfigPolicy(settings: AppSettings, options: { restoreSitePresets?: boolean; dismissedPresetProfileIds?: string[] }): AppSettings {
  const connection = getSiteConnection()
  const profiles = [...settings.profiles]
  const presetIdMap = new Map<string, string>()
  for (const preset of presetProfiles.filter(isSiteApiProfile)) {
    let id = preset.id
    while (profiles.some((profile) => profile.id === id && !isSiteApiProfile(profile))) id = `${id}-site`
    const existingIdx = profiles.findIndex((profile) => profile.id === id && isSiteApiProfile(profile))
    if (existingIdx >= 0) {
      if (isPresetConfigParamsLocked()) {
        profiles[existingIdx] = { ...preset, id, apiKey: profiles[existingIdx].apiKey, selectedModel: profiles[existingIdx].selectedModel }
      }
      presetIdMap.set(preset.id, id)
      continue
    }
    if (!options.restoreSitePresets && !isPresetConfigDeletionPrevented()) continue
    if (!isPresetConfigDeletionPrevented() && options.dismissedPresetProfileIds?.includes(preset.id)) continue
    // 同名旧配置即使来自旧部署，也不能把旧 Key 迁移给新的连接。
    profiles.push({ ...preset, id, apiKey: '', isDefault: undefined })
    presetIdMap.set(preset.id, id)
  }
  if (!profiles.some(isSiteApiProfile)) {
    let id = 'site-openai'
    while (profiles.some((profile) => profile.id === id)) id = `${id}-site`
    profiles.push(createDefaultOpenAIProfile({ id, name: 'NorthByteHub', ...connection, apiKey: '' }))
  }
  const available = profiles.filter((profile) => isSiteApiProfile(profile) &&
    (!isPresetConfigOnlyEnabled() || [...presetIdMap.values()].includes(profile.id)))
  const fallback = available[0] ?? profiles.find(isSiteApiProfile)!
  const activeProfileId = available.some((profile) => profile.id === settings.activeProfileId) ? settings.activeProfileId : fallback.id
  const textProfiles = available.filter((profile) => profile.apiMode === 'responses')
  const presetSettings = isPresetConfigParamsLocked() && presetAgent
    ? getPresetAgentSettings(presetAgent) : {}
  const textId = presetIdMap.get(presetSettings.agentTextProfileId ?? '') ?? presetSettings.agentTextProfileId ?? settings.agentTextProfileId
  const imageId = presetIdMap.get(presetSettings.agentImageProfileId ?? '') ?? presetSettings.agentImageProfileId ?? settings.agentImageProfileId
  return {
    ...settings,
    ...presetSettings,
    profiles,
    activeProfileId,
    agentTextProfileId: textProfiles.find((profile) => profile.id === textId)?.id ?? textProfiles[0]?.id ?? null,
    agentImageProfileId: available.find((profile) => profile.id === imageId)?.id ?? fallback.id,
  }
}

/** 应用部署策略；本站仅限制连接归属，普通模式沿用原有预置参数锁定规则。 */
export function enforcePresetConfigPolicy(
  settings: AppSettings,
  options: { dismissedPresetProviderIds?: string[]; dismissedPresetProfileIds?: string[]; restoreSitePresets?: boolean } = {},
): AppSettings {
  if (IS_SITE_MODE) return enforceSiteConfigPolicy(settings, options)
  const presetConfigOnly = isPresetConfigOnlyEnabled()
  const paramsLocked = isPresetConfigParamsLocked()
  if (presetProfiles.length === 0) return settings

  const dismissedProviderIds = new Set(options.dismissedPresetProviderIds ?? [])
  const profileIds = getPresetProfileIds()
  const presetProfilesById = new Map(presetProfiles.map((profile) => [profile.id, profile]))
  const presetProvidersById = new Map(presetProviders.map((provider) => [provider.id, provider]))
  const profiles = settings.profiles.map((profile) => {
    const preset = presetProfilesById.get(profile.id)
    if (!preset) return profile.isDefault ? { ...profile, isDefault: undefined } : profile
    return {
      ...(paramsLocked ? preset : profile),
      apiKey: profile.apiKey,
      selectedModel: profile.selectedModel,
      provider: paramsLocked || presetConfigOnly ? preset.provider : profile.provider,
      isDefault: profile.id === defaultPresetProfileId ? true : undefined,
    }
  })
  if (isPresetConfigDeletionPrevented()) {
    for (const profile of presetProfiles) {
      if (!profiles.some((item) => item.id === profile.id)) profiles.push({ ...profile, isDefault: profile.id === defaultPresetProfileId ? true : undefined })
    }
  }
  const customProviders = settings.customProviders.filter((provider) => !dismissedProviderIds.has(provider.id)).map((provider) => {
    const preset = presetProvidersById.get(provider.id)
    return preset && (paramsLocked || IS_SITE_MODE) ? preset : provider
  })
  for (const provider of presetProviders) {
    if (dismissedProviderIds.has(provider.id)) continue
    if (!customProviders.some((item) => item.id === provider.id)) customProviders.push(provider)
  }
  const activeProfileId = presetConfigOnly && !profileIds.has(settings.activeProfileId)
    ? defaultPresetProfileId ?? presetProfiles[0]?.id ?? settings.activeProfileId
    : settings.activeProfileId
  const agentTextProfileId = presetConfigOnly && (!settings.agentTextProfileId || !profileIds.has(settings.agentTextProfileId))
    ? presetProfiles.find((profile) => profile.provider === 'openai' && profile.apiMode === 'responses')?.id ?? null
    : settings.agentTextProfileId
  const agentImageProfileId = presetConfigOnly && (!settings.agentImageProfileId || !profileIds.has(settings.agentImageProfileId))
    ? defaultPresetProfileId ?? presetProfiles[0]?.id ?? null
    : settings.agentImageProfileId

  // 配置删除后的引用回退沿用归一化逻辑，不恢复已删除的配置。
  const agentSettings = paramsLocked && presetAgent
    ? normalizeSettings({ ...settings, profiles, ...getPresetAgentSettings(presetAgent) })
    : null

  return {
    ...settings,
    ...(agentSettings ? { agentApiConfigMode: agentSettings.agentApiConfigMode } : {}),
    customProviders,
    profiles,
    activeProfileId,
    agentTextProfileId: agentSettings && presetAgent?.textProfileId !== undefined ? agentSettings.agentTextProfileId : agentTextProfileId,
    agentImageProfileId: agentSettings && presetAgent?.imageProfileId !== undefined ? agentSettings.agentImageProfileId : agentImageProfileId,
  }
}
