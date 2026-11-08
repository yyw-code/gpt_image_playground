import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { setSiteConnection } from './siteProfiles'

vi.mock('./siteMode', () => ({ IS_SITE_MODE: true }))

const profile = createDefaultOpenAIProfile({
  baseUrl: 'https://site.example/v1', apiKey: 'test-key',
  codexCli: false, streamImages: false, apiMode: 'images',
})
const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })

describe('site Images target count', () => {
  beforeEach(() => setSiteConnection(profile))
  afterEach(() => {
    vi.restoreAllMocks()
    setSiteConnection()
  })

  it.each([1, 3, 10].flatMap((n) => [false, true].map((edit) => ({ n, edit }))))('generates $n images through single-image requests for edit=$edit', async ({ n, edit }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).startsWith('data:')
      ? new Response('image', { headers: { 'Content-Type': 'image/png' } })
      : new Response(JSON.stringify({ quality: 'high', data: [{ b64_json: '/9j/4AAQSkZJRg==' }] })))

    const result = await callImageApi({
      settings, prompt: 'cup', params: { ...DEFAULT_PARAMS, n, quality: 'auto', size: '1536x1024' },
      inputImageDataUrls: edit ? ['data:image/png;base64,iVBORw0KGgo='] : [],
    })

    const submits = fetchMock.mock.calls.filter(([url]) => String(url).endsWith(edit ? '/images/edits' : '/images/generations'))
    expect(submits).toHaveLength(n)
    for (const [, init] of submits) {
      const body = edit ? Object.fromEntries((init?.body as FormData).entries()) : JSON.parse(String(init?.body))
      expect(body.n ?? 1).toBe(1)
      expect(body).toMatchObject({ model: profile.model, quality: 'auto', size: '1536x1024' })
      if (edit) expect(body['image[]']).toBeInstanceOf(Blob)
    }
    expect(result.images).toHaveLength(n)
    expect(result.actualParams).toMatchObject({ n, quality: 'high' })
    expect(result.actualParamsList).toHaveLength(n)
  })

  it('keeps successful images and the failed request position without replacement requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const index = fetchMock.mock.calls.length
      return index === 2
        ? new Response(JSON.stringify({ error: { message: 'Generation failed' } }), { status: 400 })
        : new Response(JSON.stringify({ data: [{ b64_json: `image-${index}` }] }))
    })

    const result = await callImageApi({ settings, prompt: 'cup', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageDataUrls: [] })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual(['data:image/png;base64,image-1', 'data:image/png;base64,image-3'])
    expect(result.actualParams?.n).toBe(2)
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'Generation failed' }])
  })

  it('逐张回调在整批完成之前执行，并等待该图片保存完成', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      requests++
      if (requests === 2) await gate
      return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }))
    })
    const onImageResult = vi.fn(async (_event: { requestIndex: number; result: { images: string[] } }) => {})
    const pending = callImageApi({ settings, prompt: 'cup', params: { ...DEFAULT_PARAMS, n: 2 }, inputImageDataUrls: [], onImageResult })
    try {
      await vi.waitFor(() => expect(onImageResult).toHaveBeenCalledTimes(1))
      expect(onImageResult.mock.calls[0][0]).toMatchObject({ requestIndex: 0, result: { images: ['data:image/png;base64,iVBORw0KGgo='] } })
    } finally { release(); await pending }
    expect(onImageResult).toHaveBeenCalledTimes(2)
  })

  it('reports failure when all single-image requests fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ error: { message: 'Generation failed' } }), { status: 400 }))

    await expect(callImageApi({ settings, prompt: 'cup', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageDataUrls: [] })).rejects.toThrow('Generation failed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
