// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from '../../lib/apiProfiles'
import ImageProfileSelect from './imageProfileSelect'

vi.mock('../../lib/siteMode', () => ({ IS_SITE_MODE: false }))
describe('工作台配置选择', () => {
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
