import type { ApiProfile, AppSettings } from '../../types'
import { isPresetConfigOnlyEnabled, isPresetProfile } from '../../lib/presetConfig'
import { IS_SITE_MODE } from '../../lib/siteMode'
import { isSiteApiProfile } from '../../lib/siteProfiles'
import { getApiProviderLabel } from '../../lib/apiProfiles'
import Select from '../Select'
import { CHIP_BASE_CLASS, CHIP_IDLE_CLASS } from './paramPopoverChip'

/** 工作台只列出可见图片配置，本站沿用简化类型名称；临时复用项单独标记，不展示凭据或混入 Agent 配置池。 */
export default function ImageProfileSelect({ settings, activeProfile, temporary = false, onChange }: {
  settings: AppSettings
  activeProfile: ApiProfile
  temporary?: boolean
  onChange: (id: string) => void
}) {
  const profiles = settings.profiles.filter((profile) => (!IS_SITE_MODE || isSiteApiProfile(profile)) && (!isPresetConfigOnlyEnabled() || isPresetProfile(profile.id)))
  const options = profiles.map((profile) => {
    const providerLabel = IS_SITE_MODE && profile.provider === 'grok' ? 'Grok'
      : IS_SITE_MODE && profile.provider === 'openai' ? 'ChatGPT' : getApiProviderLabel(settings, profile.provider)
    return { value: profile.id, label: `${profile.name} · ${providerLabel}` }
  })
  const value = temporary ? `temporary:${activeProfile.id}` : activeProfile.id
  if (temporary) options.unshift({ value, label: `${activeProfile.name} · 临时复用` })
  return <Select value={value} options={options} onChange={(id) => { if (profiles.some((profile) => profile.id === id)) onChange(String(id)) }} prefix={<span className="mr-1.5 text-gray-400">配置</span>} className={`${CHIP_BASE_CLASS} ${CHIP_IDLE_CLASS} max-w-60`} showValueTooltips />
}
