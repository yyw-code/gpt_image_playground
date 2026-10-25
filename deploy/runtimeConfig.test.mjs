import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

const directories = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

/** 将真实入口脚本的容器绝对目录映射到临时目录，再执行完整配置生成逻辑。 */
function createDeployment() {
  const directory = mkdtempSync(join(tmpdir(), 'draw-runtime-'))
  directories.push(directory)
  const html = join(directory, 'html')
  mkdirSync(join(html, 'assets'), { recursive: true })
  writeFileSync(join(html, 'assets', 'app-hash.js'), 'const config="__VITE_DEFAULT_API_URL_PLACEHOLDER__"')
  const nginx = join(directory, 'nginx.conf')
  writeFileSync(nginx, '# BEGIN API PROXY\nproxy\n# END API PROXY\n')
  const script = join(directory, 'entrypoint.sh')
  writeFileSync(script, readFileSync(new URL('./inject-api-url.sh', import.meta.url), 'utf8')
    .split('/usr/share/nginx/html').join(html).split('/etc/nginx/conf.d/default.conf').join(nginx))

  /** 执行生成脚本并读取浏览器实际会执行的配置，失败时保留退出码供断言。 */
  function run(overrides = {}) {
    return spawnSync('sh', [script], {
      encoding: 'utf8', env: { ...process.env, ENABLE_API_PROXY: 'false', DEFAULT_API_URL: '', SITE_MODE: 'true', ...overrides },
    })
  }

  /** 执行配置文件，验证浏览器获得的解码值及语法，而非仅检查输出字符串。 */
  function config() {
    const window = {}
    runInNewContext(readFileSync(join(html, 'runtime-config.js'), 'utf8'), { window, atob, TextDecoder, Uint8Array })
    return window.__GPT_IMAGE_RUNTIME_CONFIG__
  }
  return { html, run, config }
}

describe('Docker 的独立运行时配置', () => {
  it('配置包含中文、引号、换行等内容时仍可正确读取，编译代码保持不变', () => {
    const deployment = createDeployment()
    const value = 'https://site.example/v1?label=中文"\\\n\t&x=1'
    expect(deployment.run({ DEFAULT_API_URL: value, SITE_MODE: 'false' }).status).toBe(0)
    expect(deployment.config()).toMatchObject({ VITE_DEFAULT_API_URL: value, VITE_SITE_MODE: 'false', VITE_DOCKER_DEPLOYMENT: 'true' })
    expect(readFileSync(join(deployment.html, 'assets/app-hash.js'), 'utf8')).toBe('const config="__VITE_DEFAULT_API_URL_PLACEHOLDER__"')
  })

  it('同一份代码再次加载配置会生成新值，支持 file:// 预置 JSON 与显式空值', () => {
    const deployment = createDeployment()
    const path = join(deployment.html, 'preset.json')
    const json = '{"profiles":[{"id":"站点","apiKey":""}]}'
    writeFileSync(path, json)
    expect(deployment.run({ DEFAULT_API_URL: `file://${path}` }).status).toBe(0)
    const embedded = deployment.config().VITE_DEFAULT_API_URL
    expect(Buffer.from(embedded.replace('embedded-config:', ''), 'base64').toString('utf8')).toBe(json)
    expect(deployment.run({ DEFAULT_API_URL: '' }).status).toBe(0)
    expect(deployment.config().VITE_DEFAULT_API_URL).toBe('')
  })

  it('预置文件不存在时启动失败，不静默回退到其他接口', () => {
    const deployment = createDeployment()
    expect(deployment.run({ DEFAULT_API_URL: `file://${deployment.html}/missing.json` }).status).not.toBe(0)
  })
})
