import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import type { TaskParams } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { callAgentResponsesApi, callBatchImageSingle } from './agentApi'
import { setSiteConnection } from './siteProfiles'
import { PROMPT_REWRITE_GUARD_PREFIX } from './imageApiShared'

const mocks = vi.hoisted(() => ({ siteMode: { IS_SITE_MODE: true } }))
vi.mock('./siteMode', () => mocks.siteMode)

const profile = createDefaultOpenAIProfile({ id: 'site', baseUrl: 'https://site.example/v1', apiKey: 'test-key', codexCli: false })
const params: TaskParams = Object.freeze({ ...DEFAULT_PARAMS, size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80, n: 3 })
const prompt = 'Draw a cat.'
const composition = 'Composition: 21:9 aspect ratio, landscape canvas.'
const referenceImage = 'data:image/png;base64,aW1hZ2U='

describe('站点目标比例发送', () => {
  it.each([false, true])('CLI=%s 时普通生成及参考图都发送明确的目标画布比例', async (codexCli) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [{ ...profile, codexCli }], activeProfileId: profile.id, allowPromptRewrite: true })
    for (const edit of [false, true]) {
      await callImageApi({ settings, params: { ...DEFAULT_PARAMS, n: 1, imageAspectRatio: '9:16' }, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })
    }
    const submits = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(profile.baseUrl))
    expect(submits).toHaveLength(2)
    for (const [, init] of submits) {
      const body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body))
      expect(body.prompt).toContain('entire output image canvas must have exactly a 9:16 width-to-height aspect ratio, portrait orientation')
      expect(body.prompt).toContain('Do not place a differently shaped picture inside a frame or add borders.')
      expect(body.size).toBe(codexCli ? undefined : '864x1536')
    }
  })

  it('Responses 与 Agent 单图/批量保留显式比例，不被旧 size 覆盖', async () => {
    const fetchMock = mockImageResponse()
    const responsesProfile = { ...profile, apiMode: 'responses' as const, imageGenerationModel: profile.model }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id })
    const requested = { ...DEFAULT_PARAMS, n: 1, imageAspectRatio: '16:9' }
    await callImageApi({ settings, params: requested, prompt, inputImageDataUrls: [] })
    await callAgentResponsesApi({ settings, profile: responsesProfile, params: requested, input: prompt })
    await callBatchImageSingle({ profile: responsesProfile, params: requested, prompt, batchItemId: 'cover', referenceImageDataUrls: [referenceImage], referenceIds: ['original'], allowPromptRewrite: false })
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies[0].input).toContain('exactly a 16:9 width-to-height aspect ratio')
    expect(bodies[1].instructions).toContain('exactly a 16:9 width-to-height aspect ratio')
    expect(bodies[2].input[0].content[0].text).toContain('exactly a 16:9 width-to-height aspect ratio')
    for (const body of bodies) expect(body.tools[0].size).toBe('1536x864')
  })
})

beforeEach(() => {
  mocks.siteMode.IS_SITE_MODE = true
  setSiteConnection(profile)
})

afterEach(() => {
  vi.restoreAllMocks()
  setSiteConnection()
})

/** 模拟本地参考图读取及生成响应；所有网络请求均拦截，不访问真实模型或产生费用。 */
function mockImageResponse() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).startsWith('data:')) return new Response('image', { headers: { 'Content-Type': 'image/png' } })
    return new Response(JSON.stringify({
      size: '1915x821', quality: 'medium', output_format: 'png',
      data: [{ b64_json: 'aW1hZ2U=', revised_prompt: `${prompt}\n\n${composition}` }],
      output: [{ type: 'image_generation_call', result: 'aW1hZ2U=', size: '1915x821', quality: 'medium', output_format: 'png' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

describe('外部原生参数与兼容构图分离', () => {
  beforeEach(() => { mocks.siteMode.IS_SITE_MODE = false })
  it('关闭 CLI 后完整发送 3840x1648/WebP；上游返回不同值时保留真实结果，不改写设置', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, _init) => new Response(JSON.stringify({
      size: '1536x1024', output_format: 'png', data: [{ b64_json: 'aW1hZ2U=' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const requested: TaskParams = { ...params, size: '3840x1648', output_format: 'webp', quality: 'medium', n: 2 }
    const result = await callImageApi({ settings, params: requested, prompt, inputImageDataUrls: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ size: '3840x1648', output_format: 'webp', quality: 'medium' })
    }
    expect(result.actualParams).toMatchObject({ size: '1536x1024', output_format: 'png' })
    expect(requested.size).toBe('3840x1648')
    expect(requested.output_format).toBe('webp')
  })

  it.each([false, true])('Images 参考图=%s 时保留原提示词及尺寸、质量、格式、压缩率和数量', async (edit) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const originalParams = { ...params }
    const result = await callImageApi({ settings, params, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })
    const submits = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(profile.baseUrl))
    expect(submits).toHaveLength(1)
    const [url, init] = submits[0]
    expect(url).toBe(`${profile.baseUrl}/images/${edit ? 'edits' : 'generations'}`)
    if (edit) {
      const body = (init as RequestInit).body as FormData
      expect(body.get('prompt')).toBe(prompt)
      expect(body.get('size')).toBe('2016x864')
      expect(body.get('quality')).toBe('high')
      expect(body.get('output_format')).toBe('webp')
      expect(body.get('output_compression')).toBe('80')
      expect(body.get('n')).toBe('3')
      expect(body.get('image[]')).toBeInstanceOf(Blob)
    } else {
      expect({ ...JSON.parse(String((init as RequestInit).body)), n: JSON.parse(String((init as RequestInit).body)).n ?? 1 }).toMatchObject({
        prompt, size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80, n: 3,
      })
    }
    expect(params).toEqual(originalParams)
    expect(result.actualParams).toMatchObject({ size: '1915x821', quality: 'medium', output_format: 'png' })
  })

  it.each([false, true])('Responses 参考图=%s 时不自动拼比例，每张图保留工具参数', async (edit) => {
    const fetchMock = mockImageResponse()
    const responsesProfile = { ...profile, apiMode: 'responses' as const }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id, allowPromptRewrite: false })
    const result = await callImageApi({ settings, params, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`${profile.baseUrl}/responses`)
      const body = JSON.parse(String((init as RequestInit).body))
      const expectedPrompt = `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}`
      if (edit) expect(body.input[0].content).toEqual([{ type: 'input_text', text: expectedPrompt }, { type: 'input_image', image_url: referenceImage }])
      else expect(body.input).toBe(expectedPrompt)
      expect(body.tools[0]).toMatchObject({ size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80, action: edit ? 'edit' : 'generate' })
    }
    expect(result.images).toHaveLength(3)
    expect(result.actualParamsList?.every((actual) => actual?.size === '1915x821' && actual.quality === 'medium')).toBe(true)
    expect(params.n).toBe(3)
  })

  it('自动尺寸不追加比例，普通外部 API 不改变提示词', async () => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    await callImageApi({ settings, params: { ...params, size: 'auto', n: 1 }, prompt, inputImageDataUrls: [] })
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ prompt, size: 'auto' })
    mocks.siteMode.IS_SITE_MODE = false
    await callImageApi({ settings, params, prompt, inputImageDataUrls: [] })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ prompt, size: '2016x864', quality: 'high' })
  })

  it.each([false, true])('Agent 混合配置=%s 时仅为兼容图片通道追加构图指令', async (hybrid) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id, agentApiConfigMode: hybrid ? 'hybrid' : 'single' })
    await callAgentResponsesApi({ settings, profile, imageProfile: hybrid ? { ...profile, codexCli: true } : undefined, params, input: prompt })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.input).toBe(prompt)
    if (hybrid) {
      expect(body.instructions).toContain('exactly a 21:9 width-to-height aspect ratio')
      expect(body.instructions).not.toContain('Generate at 2016x864 resolution.')
    } else {
      expect(body.instructions).not.toContain('Append this composition instruction')
      expect(body.tools[0]).toMatchObject({ size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80 })
    }
  })

  it.each([false, true])('Agent 原生批量参考图=%s 时保留用户已有的构图要求，不删除或重复', async (edit) => {
    const fetchMock = mockImageResponse()
    const result = await callBatchImageSingle({
      profile, params, prompt: `${prompt}\n\n${composition}`, batchItemId: 'cover',
      referenceImageDataUrls: edit ? [referenceImage] : [], referenceIds: edit ? ['original'] : [], allowPromptRewrite: false,
    })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const text = edit ? body.input[0].content[0].text : body.input
    expect(text).toContain(`${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}\n\n${composition}`)
    expect(text.split(composition)).toHaveLength(2)
    if (edit) expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: referenceImage })
    expect(body.tools[0]).toMatchObject({ size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80 })
    expect(result.image?.actualParams).toMatchObject({ size: '1915x821', quality: 'medium' })
  })

  it.each([false, true])('Agent 原生批量参考图=%s 时不追加构图指令', async (edit) => {
    const fetchMock = mockImageResponse()
    await callBatchImageSingle({ profile, params, prompt, batchItemId: 'cover', referenceImageDataUrls: edit ? [referenceImage] : [], allowPromptRewrite: false })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const text = edit ? body.input[0].content[0].text : body.input
    expect(text).not.toContain('Composition:')
    expect(body.tools[0].size).toBe(params.size)
  })

  it('Codex 仅附带构图比例，不发送精确像素、质量或原生输出参数', async () => {
    mocks.siteMode.IS_SITE_MODE = false
    const fetchMock = mockImageResponse()
    const codexProfile = { ...profile, codexCli: true }
    const settings = normalizeSettings({ profiles: [codexProfile], activeProfileId: profile.id, allowPromptRewrite: true })
    await callImageApi({ settings, params: { ...params, n: 1 }, prompt, inputImageDataUrls: [], skipCodexCliSizePrompt: true })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.prompt).toContain(`${prompt}\n\nThe entire output image canvas must have exactly a 21:9 width-to-height aspect ratio`)
    expect(body.size).toBeUndefined()
    expect(body.quality).toBeUndefined()
    expect(body.output_format).toBeUndefined()
    expect(body.output_compression).toBeUndefined()
    expect(body.moderation).toBeUndefined()
  })

  it('请求失败时返回原错误，不偷偷降级参数或额外重试', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), { status: 429 }))
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    await expect(callImageApi({ settings, params, prompt, inputImageDataUrls: [] })).rejects.toThrow('quota exhausted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect({ ...body, n: body.n ?? 1 }).toMatchObject({ size: '2016x864', quality: 'high', n: 3 })
    }
  })
})


describe('格式与比例请求契约', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('本站已验证 Responses 组合发送真实 %s、目标比例及单次工具约束', async (output_format) => {
    const encoded = { png: 'iVBORw0KGgo=', jpeg: '/9j/4AAQSkZJRg==', webp: 'UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of' }[output_format]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: encoded, output_format: 'png' }] })))
    const responsesProfile = { ...profile, apiMode: 'responses' as const, model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.5-sunburst', streamImages: false }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id, allowPromptRewrite: true })
    for (const [imageAspectRatio, size] of [['16:9', '1536x864'], ['9:16', '864x1536']]) {
      const requested = { ...DEFAULT_PARAMS, output_format, imageAspectRatio }
      const result = await callImageApi({ settings, params: requested, prompt, inputImageDataUrls: [] })
      const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
      const body = JSON.parse(String(init?.body))
      expect(url).toBe(`${profile.baseUrl}/responses`)
      expect(body).toMatchObject({ model: 'gpt-6.1-sol', stream: false, parallel_tool_calls: false, tool_choice: 'required' })
      expect(body.tools).toEqual([expect.objectContaining({ type: 'image_generation', action: 'generate', model: 'gpt-image-2.5-sunburst', size, quality: 'auto', output_format })])
      expect(body.input).toContain(`Generate exactly one image. Call the image generation tool only once.\n\n${prompt}\n\n`)
      expect(body.input).toContain(`exactly a ${imageAspectRatio} width-to-height aspect ratio`)
      expect(body.input).toContain('Do not place a differently shaped picture inside a frame or add borders.')
      expect(result.images[0]).toBe(`data:image/${output_format};base64,${encoded}`)
      expect(result.actualParamsList?.[0]?.output_format).toBe(output_format)
      expect(requested.output_format).toBe(output_format)
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('本站 Responses 失败不换路径、模型、格式或自动重发', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), { status: 429 }))
    const responsesProfile = { ...profile, apiMode: 'responses' as const, model: 'gpt-6.1-sol', imageGenerationModel: 'gpt-image-2.5-sunburst', streamImages: false }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id })
    await expect(callImageApi({ settings, params: { ...DEFAULT_PARAMS, output_format: 'webp', imageAspectRatio: '16:9' }, prompt, inputImageDataUrls: [] })).rejects.toThrow('quota exhausted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tools[0].output_format).toBe('webp')
  })

  it.each(['images', 'responses'] as const)('本站 %s 阻止旧的未支持格式，生成和编辑均不发送 POST', async (apiMode) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [{ ...profile, apiMode, imageGenerationModel: profile.model }], activeProfileId: profile.id })
    for (const output_format of ['jpeg', 'webp'] as const) {
      for (const edit of [false, true]) {
        await expect(callImageApi({ settings, params: { ...DEFAULT_PARAMS, output_format, imageAspectRatio: '16:9' }, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })).rejects.toThrow('格式不可用')
      }
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })

  it.each(['png', 'jpeg', 'webp'] as const)('外部 Responses 原生 %s 和尺寸字段一致，文件签名覆盖错误回显', async (output_format) => {
    mocks.siteMode.IS_SITE_MODE = false
    const encoded = { png: 'iVBORw0KGgo=', jpeg: '/9j/4AAQSkZJRg==', webp: 'UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of' }[output_format]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: encoded, output_format: 'png' }] })))
    const responsesProfile = { ...profile, apiMode: 'responses' as const, model: 'gpt-6.1-sol', imageGenerationModel: profile.model }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id })
    for (const size of ['1536x864', '864x1536']) {
      const result = await callImageApi({ settings, params: { ...DEFAULT_PARAMS, output_format, size }, prompt, inputImageDataUrls: [] })
      const body = JSON.parse(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1]?.body))
      expect(body.model).toBe('gpt-6.1-sol')
      expect(body.tools[0]).toMatchObject({ model: profile.model, size, output_format })
      expect(result.images[0]).toBe(`data:image/${output_format};base64,${encoded}`)
      expect(result.actualParamsList?.[0]?.output_format).toBe(output_format)
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
