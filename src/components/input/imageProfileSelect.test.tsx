// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from '../../lib/apiProfiles'
import { setSiteConnection } from '../../lib/siteProfiles'
import ImageProfileSelect from './imageProfileSelect'

const siteMode = vi.hoisted(() => ({ IS_SITE_MODE: false }))
vi.mock('../../lib/siteMode', () => siteMode)
afterEach(() => { siteMode.IS_SITE_MODE = false; setSiteConnection() })
describe('工作台配置选择', () => {
  it.each([true, false])('本站=%s 使用对应显示名称而不改写协议', (site) => {
    siteMode.IS_SITE_MODE = site
    const profile = createDefaultOpenAIProfile({ id: 'site', name: '图片配置', baseUrl: 'https://site.example/v1' })
    setSiteConnection(profile)
    const grok = { ...profile, id: 'grok', provider: 'grok' as const, name: 'Grok 配置', model: 'grok-imagine-image-2.0', codexCli: false }
    const settings = normalizeSettings({ profiles: [profile, grok, { ...grok, id: 'foreign', name: '外站配置', baseUrl: 'https://other.example/v1' }], activeProfileId: grok.id })
    const html = renderToStaticMarkup(<ImageProfileSelect settings={settings} activeProfile={grok} onChange={vi.fn()} />)
    expect(html).toContain(site ? 'Grok 配置 · Grok' : 'Grok 配置 · Grok（Sub2API）')
    if (site) expect(html).not.toContain('Sub2API')
    expect(settings.profiles.find((item) => item.id === grok.id)?.provider).toBe('grok')
    const openai = renderToStaticMarkup(<ImageProfileSelect settings={settings} activeProfile={profile} onChange={vi.fn()} />)
    expect(openai).toContain(site ? '图片配置 · ChatGPT' : '图片配置 · OpenAI')
  })

  it('显示当前生效名称和供应商，不包含凭据或 Agent 普通候选', () => {
    const profile = createDefaultOpenAIProfile({ id: 'a', name: '图片配置 A', apiKey: 'secret-not-in-ui' })
    const settings = normalizeSettings({ profiles: [profile], agentProfiles: [{ ...profile, id: 'agent', name: 'Agent 私有配置' }], activeProfileId: 'a' })
    const html = renderToStaticMarkup(<ImageProfileSelect settings={settings} activeProfile={profile} onChange={vi.fn()} />)
    expect(html).toContain('图片配置 A')
    expect(html).toContain('配置')
    expect(html).not.toContain('secret-not-in-ui')
    expect(html).not.toContain('Agent 私有配置')
  })
})
