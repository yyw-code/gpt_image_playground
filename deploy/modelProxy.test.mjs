import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Docker 模型查询代理', () => {
  it('在现有 API 代理中允许 GET，继续限制 PATCH、DELETE 等写入方法', () => {
    const nginx = readFileSync(new URL('./nginx.conf', import.meta.url), 'utf8')
    const proxy = nginx.slice(nginx.indexOf('# BEGIN API PROXY'), nginx.indexOf('# END API PROXY'))
    const allowed = proxy.match(/limit_except\s+([^\{]+)\{\s*deny all;/)?.[1].trim().split(/\s+/)
    expect(allowed).toEqual(['GET', 'POST', 'OPTIONS'])
    expect(proxy).toContain('proxy_pass ${API_PROXY_URL}/;')
    expect(proxy).toContain('Forbidden: API Proxy path required')
  })
})
