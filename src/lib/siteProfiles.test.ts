import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/** 每个场景独立加载站点策略，模拟部署提供固定连接，不访问真实接口。 */
async function setupSite() {
  vi.stubEnv('VITE_SITE_MODE', 'true')
  const profiles = await import('./apiProfiles')
  const policy = await import('./presetConfig')
  const site = profiles.createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1', apiKey: '' })
  policy.setPresetConfig({ profiles: [site], customProviders: [] })
  return { ...profiles, ...policy, site, ...await import('./siteProfiles') }
}

describe('本站配置连接策略', () => {
  it('创建、复制和持久化后的多配置保留独立密钥、模型、顺序及 Agent 引用', async () => {
    const p = await setupSite()
    const image = { ...p.site, id: 'image', apiKey: 'image-key', model: 'image-model' }
    const text = p.createDefaultOpenAIProfile({ ...p.getSiteConnection(), id: 'text', apiMode: 'responses', apiKey: 'text-key', model: 'text-model' })
    const copy = { ...image, id: 'copy', name: '图像副本', apiKey: 'copy-key' }
    const settings = p.normalizeSettings({ profiles: [copy, text, image], activeProfileId: 'copy', agentApiConfigMode: 'hybrid', agentTextProfileId: 'text', agentImageProfileId: 'image' })
    const restored = p.normalizeSettings(p.enforcePresetConfigPolicy(p.normalizeSettings(JSON.parse(JSON.stringify(settings)))))
    expect(restored.profiles.map((profile) => profile.id)).toEqual(['copy', 'text', 'image'])
    expect(restored.profiles.map((profile) => profile.apiKey)).toEqual(['copy-key', 'text-key', 'image-key'])
    expect(p.getAgentTextApiProfile(restored)).toMatchObject({ id: 'text', model: 'text-model' })
    expect(p.getAgentImageApiProfile(restored)).toMatchObject({ id: 'image', model: 'image-model' })
    const removed = p.enforcePresetConfigPolicy({ ...restored, profiles: restored.profiles.filter((profile) => profile.id !== 'copy') })
    expect(removed.activeProfileId).toBe('text')
    expect(removed.profiles).toHaveLength(2)
  })

  it('备份同 ID 的外站配置另存原数据，不覆盖本站密钥，导入本站配置可以正常启用', async () => {
    const p = await setupSite()
    const current = p.normalizeSettings({ profiles: [{ ...p.site, apiKey: 'site-key' }] })
    const foreign = { ...p.site, baseUrl: 'https://other.example/v1', apiKey: 'foreign-key' }
    const own = { ...p.site, id: 'imported-own', apiKey: 'own-key' }
    const settings = p.enforcePresetConfigPolicy(p.mergeImportedSettings(current, { profiles: [foreign, own] }, { preserveInternalIds: true }))
    expect(settings.profiles.find((profile) => profile.id === 'site')?.apiKey).toBe('site-key')
    expect(settings.profiles.find((profile) => profile.baseUrl === foreign.baseUrl)).toMatchObject({ apiKey: 'foreign-key' })
    expect(p.enforcePresetConfigPolicy({ ...settings, activeProfileId: own.id }).activeProfileId).toBe(own.id)
    const importedForeign = settings.profiles.find((profile) => profile.baseUrl === foreign.baseUrl)!
    expect(p.enforcePresetConfigPolicy({ ...settings, activeProfileId: importedForeign.id }).activeProfileId).toBe('site')
  })

  it('同站点的部署模型更新沿用原合并规则，旧密钥和用户模型编辑保持兼容', async () => {
    const p = await setupSite()
    const previous = { customProviders: [], profiles: [{ ...p.site, model: 'old-model' }] }
    const current = p.normalizeSettings({ profiles: [{ ...previous.profiles[0], apiKey: 'personal-key' }] })
    const next = { customProviders: [], profiles: [{ ...p.site, model: 'new-model' }] }
    const merged = p.enforcePresetConfigPolicy(p.mergePresetImportedSettings(current, next, { previousPresetConfig: previous }).settings)
    expect(merged.profiles.find((profile) => profile.id === 'site')).toMatchObject({ model: 'new-model', apiKey: 'personal-key' })
    const edited = p.normalizeSettings({ profiles: [{ ...p.site, model: 'user-model', apiKey: 'personal-key' }] })
    const unchanged = p.enforcePresetConfigPolicy(p.mergePresetImportedSettings(edited, previous, { previousPresetConfig: previous }).settings)
    expect(unchanged.profiles.find((profile) => profile.id === 'site')).toMatchObject({ model: 'user-model', apiKey: 'personal-key' })
  })

  it('部署地址变更时合并入口也保留旧连接与旧密钥，另建本站配置', async () => {
    const p = await setupSite()
    const foreign = { ...p.site, baseUrl: 'https://old.example/v1', apiKey: 'old-key' }
    const previous = { customProviders: [], profiles: [foreign] }
    const current = p.normalizeSettings({ profiles: [foreign] })
    const merged = p.mergePresetImportedSettings(current, { customProviders: [], profiles: [p.site] }, { previousPresetConfig: previous })
    const settings = p.enforcePresetConfigPolicy(merged.settings, { restoreSitePresets: true })
    expect(settings.profiles.find((profile) => profile.id === foreign.id)).toMatchObject({ baseUrl: foreign.baseUrl, apiKey: foreign.apiKey })
    const active = settings.profiles.find((profile) => profile.id === settings.activeProfileId)!
    expect(active).toMatchObject({ baseUrl: p.site.baseUrl, apiKey: '' })
  })

  it('显式的仅预置与参数锁定继续生效，冲突别名也识别为预置', async () => {
    vi.stubEnv('VITE_SHOW_PRESET_CONFIG_ONLY', 'true')
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const p = await setupSite()
    const foreign = { ...p.site, baseUrl: 'https://old.example/v1', apiKey: 'old-key' }
    const settings = p.enforcePresetConfigPolicy(p.normalizeSettings({ profiles: [foreign] }), { restoreSitePresets: true })
    const active = settings.profiles.find((profile) => profile.id === settings.activeProfileId)!
    expect(p.isPresetProfile(active.id)).toBe(true)
    expect(p.getPresetProfileSourceId(active.id)).toBe('site')
    expect(p.isPresetProfileLocked(active.id)).toBe(true)
    const edited = p.enforcePresetConfigPolicy({ ...settings, profiles: settings.profiles.map((profile) => profile.id === active.id ? { ...profile, model: 'edited', apiKey: 'personal-key' } : profile) })
    expect(edited.profiles.find((profile) => profile.id === active.id)).toMatchObject({ model: p.site.model, apiKey: 'personal-key' })
    const own = { ...p.site, id: 'new-own' }
    expect(p.enforcePresetConfigPolicy({ ...edited, profiles: [...edited.profiles, own], activeProfileId: own.id }).activeProfileId).toBe(active.id)
  })

  it.each([
    { baseUrl: 'https://other.example/v1' },
    { baseUrl: 'https://site.example/other' },
    { baseUrl: 'https://site.example/v1?redirect=elsewhere' },
    { baseUrl: 'https://user:password@site.example/v1' },
    { baseUrl: '' },
    { provider: 'fal' },
    { apiProxy: true },
  ])('拒绝外站、不同路径、含凭据/查询参数或非部署代理的连接 %j', async (patch) => {
    const p = await setupSite()
    expect(p.getSiteProfileError({ ...p.site, ...patch })).toContain('不属于本站')
  })

  it('部署没有可用地址时拒绝请求，恢复原模式后保留上游兼容能力', async () => {
    const p = await setupSite()
    p.setPresetConfig({ customProviders: [], profiles: [{ ...p.site, baseUrl: 'file:///invalid' }] })
    expect(p.getSiteProfileError(p.site)).toContain('尚未配置')
    vi.stubEnv('VITE_SITE_MODE', 'false')
    vi.resetModules()
    const upstream = await import('./siteProfiles')
    expect(upstream.getSiteProfileError({ ...p.site, baseUrl: 'https://other.example/v1' })).toBeNull()
  })
})
