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

describe('本站比例提示与原参数兼容', () => {
  it.each([false, true])('Images 参考图=%s 时补充比例并保留尺寸、质量、格式、压缩率及数量', async (edit) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    const originalParams = { ...params }
    const result = await callImageApi({ settings, params, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })
    const submits = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(profile.baseUrl))
    expect(submits).toHaveLength(3)
    const [url, init] = submits[0]
    expect(url).toBe(`${profile.baseUrl}/images/${edit ? 'edits' : 'generations'}`)
    if (edit) {
      const body = (init as RequestInit).body as FormData
      expect(body.get('prompt')).toBe(`${prompt}\n\n${composition}`)
      expect(body.get('size')).toBe('2016x864')
      expect(body.get('quality')).toBe('high')
      expect(body.get('output_format')).toBe('webp')
      expect(body.get('output_compression')).toBe('80')
      expect(body.get('n') ?? '1').toBe('1')
      expect(body.get('image[]')).toBeInstanceOf(Blob)
    } else {
      expect({ ...JSON.parse(String((init as RequestInit).body)), n: JSON.parse(String((init as RequestInit).body)).n ?? 1 }).toMatchObject({
        prompt: `${prompt}\n\n${composition}`, size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80, n: 1,
      })
    }
    expect(params).toEqual(originalParams)
    expect(result.actualParams).toMatchObject({ size: '1915x821', quality: 'medium', output_format: 'png' })
  })

  it.each([false, true])('Responses 参考图=%s 时将比例放进改写保护中，每张图保留工具参数', async (edit) => {
    const fetchMock = mockImageResponse()
    const responsesProfile = { ...profile, apiMode: 'responses' as const }
    const settings = normalizeSettings({ profiles: [responsesProfile], activeProfileId: profile.id, allowPromptRewrite: false })
    const result = await callImageApi({ settings, params, prompt, inputImageDataUrls: edit ? [referenceImage] : [] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`${profile.baseUrl}/responses`)
      const body = JSON.parse(String((init as RequestInit).body))
      const expectedPrompt = `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}\n\n${composition}`
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

  it.each([false, true])('Agent 混合配置=%s 时要求每个工具提示词包含比例，用户消息保持原文', async (hybrid) => {
    const fetchMock = mockImageResponse()
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id, agentApiConfigMode: hybrid ? 'hybrid' : 'single' })
    await callAgentResponsesApi({ settings, profile, imageProfile: hybrid ? { ...profile, codexCli: true } : undefined, params, input: prompt })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.input).toBe(prompt)
    expect(body.instructions).toContain(`Append this composition instruction to every image prompt, including reference-image edits and batch items: "${composition}"`)
    if (hybrid) expect(body.instructions).not.toContain('Generate at 2016x864 resolution.')
    else expect(body.tools[0]).toMatchObject({ size: '2016x864', quality: 'high', output_format: 'webp', output_compression: 80 })
  })

  it.each([false, true])('Agent 批量参考图=%s 时补充比例且不重复模型已带的尾注', async (edit) => {
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

  it('Codex 仅附带构图比例，不发送精确像素、质量或原生输出参数', async () => {
    mocks.siteMode.IS_SITE_MODE = false
    const fetchMock = mockImageResponse()
    const codexProfile = { ...profile, codexCli: true }
    const settings = normalizeSettings({ profiles: [codexProfile], activeProfileId: profile.id, allowPromptRewrite: true })
    await callImageApi({ settings, params: { ...params, n: 1 }, prompt, inputImageDataUrls: [], skipCodexCliSizePrompt: true })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.prompt).toBe(`${prompt}\n\n${composition}`)
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
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect({ ...body, n: body.n ?? 1 }).toMatchObject({ size: '2016x864', quality: 'high', n: 1 })
    }
  })
})
