import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, getAgentTextApiProfile, getAgentImageApiProfile, normalizeSettings, mergeImportedSettings, mergePresetImportedSettings, DEFAULT_SETTINGS } from './apiProfiles'

const text = createDefaultOpenAIProfile({ id: 'text', apiMode: 'responses', model: 'text-a, text-b', selectedModel: 'text-b', apiKey: 'fixture-text' })
const image = createDefaultOpenAIProfile({ id: 'image', model: 'image-a', apiKey: 'fixture-image' })

describe('工作区配置隔离', () => {
  it('旧版跟随配置迁移为独立副本，保留原模型选择且不修改输入', () => {
    const legacy = { profiles: [text, image], activeProfileId: 'text', agentApiConfigMode: 'off' }
    const settings = normalizeSettings(legacy)
    expect(settings.agentApiConfigMode).toBe('native')
    expect(getAgentTextApiProfile(settings)?.model).toBe('text-b')
    expect(settings.agentProfiles).toEqual(settings.profiles)
    expect(settings.agentProfiles[0]).not.toBe(text)
    expect(legacy).not.toHaveProperty('agentProfiles')
    const changed = normalizeSettings({ ...settings, profiles: settings.profiles.map((profile) => ({ ...profile, apiKey: 'fixture-changed', selectedModel: 'text-a' })) })
    expect(getAgentTextApiProfile(changed)).toMatchObject({ apiKey: 'fixture-text', model: 'text-b' })
    expect(normalizeSettings(JSON.parse(JSON.stringify(changed)))).toEqual(changed)
  })

  it('旧图片配置不猜测文本模型；显式空配置和失效引用不回退到画廊', () => {
    expect(getAgentTextApiProfile(normalizeSettings({ profiles: [image] }))).toBeNull()
    const settings = normalizeSettings({ profiles: [text, image], agentProfiles: [], agentTextProfileId: 'text', agentImageProfileId: 'image', agentApiConfigMode: 'hybrid' })
    expect(getAgentTextApiProfile(settings)).toBeNull()
    expect(getAgentImageApiProfile(settings)).toBeNull()
    expect(normalizeSettings({ ...settings, agentProfiles: [text], agentTextProfileId: null }).agentTextProfileId).toBeNull()
    for (const invalid of [null, 'invalid', {}]) {
      expect(getAgentTextApiProfile(normalizeSettings({ profiles: [text], agentProfiles: invalid }))).toBeNull()
    }
  })

  it('混合模式分别读取 Agent 自己的文本和图片配置', () => {
    const settings = normalizeSettings({ profiles: [{ ...image, apiKey: 'fixture-gallery' }], agentProfiles: [text, image], agentApiConfigMode: 'hybrid', agentTextProfileId: 'text', agentImageProfileId: 'image' })
    expect(getAgentTextApiProfile(settings)?.apiKey).toBe('fixture-text')
    expect(getAgentImageApiProfile(settings)?.apiKey).toBe('fixture-image')
  })

  it('备份导入恢复两套配置和 Agent 选择，普通图片导入不改 Agent', () => {
    const backup = normalizeSettings({ profiles: [image], agentProfiles: [text], agentTextProfileId: 'text', agentApiConfigMode: 'native' })
    const restored = mergeImportedSettings(DEFAULT_SETTINGS, backup, { preserveInternalIds: true })
    expect(getAgentTextApiProfile(restored)).toMatchObject({ id: 'text', apiKey: 'fixture-text' })
    const imported = mergeImportedSettings(restored, { profiles: [{ ...image, id: 'new-image' }] })
    expect(imported.agentProfiles).toEqual(restored.agentProfiles)
    expect(imported.agentTextProfileId).toBe('text')
  })

  it('空 Agent 配置池合并备份或预置时，不会隐式复制画廊密钥', () => {
    const current = normalizeSettings({ profiles: [image], agentProfiles: [] })
    const backup = normalizeSettings({ profiles: [image], agentProfiles: [text], agentTextProfileId: 'text' })
    expect(mergeImportedSettings(current, backup, { preserveInternalIds: true }).agentProfiles).toEqual([{ ...text, isDefault: undefined }])
    const preset = { profiles: [{ ...image, apiKey: '', isDefault: true }, { ...text, apiKey: '' }], customProviders: [] }
    const merged = mergePresetImportedSettings(current, preset).settings
    expect(merged.agentProfiles.every((profile) => profile.apiKey === '')).toBe(true)
    expect(merged.profiles.find((profile) => profile.id === image.id)?.apiKey).toBe('fixture-image')
  })

  it('Agent 专用备份中的旧自定义 Grok 与图片配置一起迁移协议', () => {
    const settings = normalizeSettings({
      customProviders: [{ id: 'grok', name: '旧协议', submit: { path: 'legacy/image' } }],
      profiles: [image],
      agentProfiles: [{ ...image, id: 'legacy-agent', provider: 'grok', providerDrafts: { grok: { model: 'legacy-model' } } }],
      agentApiConfigMode: 'hybrid', agentImageProfileId: 'legacy-agent',
    })
    const provider = settings.customProviders[0]
    expect(provider.id).not.toBe('grok')
    expect(settings.agentProfiles[0].provider).toBe(provider.id)
    expect(settings.agentProfiles[0].providerDrafts?.[provider.id]?.model).toBe('legacy-model')
  })
})
