import type { ApiProfile, AppSettings, CustomProviderDefinition, PresetAgentConfig, PresetConfig } from '../types'
import { getPresetAgentSettings, normalizeSettings } from './apiProfiles'
import { readRuntimeEnv } from './runtimeEnv'
import { IS_SITE_MODE } from './siteMode'

const RAW_SHOW_PRESET_CONFIG_ONLY = readRuntimeEnv(import.meta.env.VITE_SHOW_PRESET_CONFIG_ONLY)
const SHOW_PRESET_CONFIG_ONLY = (RAW_SHOW_PRESET_CONFIG_ONLY || readRuntimeEnv(import.meta.env.VITE_SHOW_DEFAULT_CONFIG_ONLY)) === 'true'
const LOCK_PRESET_CONFIG_PARAMS = readRuntimeEnv(import.meta.env.VITE_LOCK_PRESET_CONFIG_PARAMS) === 'true'
const PREVENT_PRESET_CONFIG_DELETION = readRuntimeEnv(import.meta.env.VITE_PREVENT_PRESET_CONFIG_DELETION) === 'true'

let presetProfiles: ApiProfile[] = []
let presetProviders: CustomProviderDefinition[] = []
let presetProfileFields: Record<string, string[]> | undefined
let presetAgent: PresetAgentConfig | undefined
let defaultPresetProfileId: string | null = null

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
}

export function getPresetProfileIds() {
  return new Set(presetProfiles.map((profile) => profile.id))
}

export function getPresetProfileDescription(id: string) {
  return presetProfiles.find((profile) => profile.id === id)?.description
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

export function isPresetProfile(id: string) {
  return presetProfiles.some((profile) => profile.id === id)
}

export function isPresetProvider(id: string) {
  return presetProviders.some((provider) => provider.id === id)
}

/** 站点有预置配置时，仅展示部署提供的配置；未配置时保留手动接入能力。 */
export function isPresetConfigOnlyEnabled() {
  return (IS_SITE_MODE || SHOW_PRESET_CONFIG_ONLY) && presetProfiles.length > 0
}

export function isPresetConfigParamsLocked() {
  return LOCK_PRESET_CONFIG_PARAMS && presetProfiles.length > 0
}

/** 阻止删除部署要求保留的预置配置，站点模式自动保留。 */
export function isPresetConfigDeletionPrevented() {
  return (IS_SITE_MODE || PREVENT_PRESET_CONFIG_DELETION || SHOW_PRESET_CONFIG_ONLY) && presetProfiles.length > 0
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

/** 应用部署策略；站点锁定连接地址与供应商，保留用户密钥、模型参数及旧配置数据。 */
export function enforcePresetConfigPolicy(
  settings: AppSettings,
  options: { dismissedPresetProviderIds?: string[] } = {},
): AppSettings {
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
      ...(IS_SITE_MODE ? { baseUrl: preset.baseUrl, apiMode: preset.apiMode, apiProxy: preset.apiProxy } : {}),
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
