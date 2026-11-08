import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { downloadImageIds, downloadImageEntriesAsZip } from './downloadImages'
import { saveFile } from './saveFile'
import { base64ToBytes } from './dataUrl'

vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn(async (id: string) => `https://images.example/${id}`) }))
vi.mock('./platform', () => ({ apiFetch: (...args: Parameters<typeof fetch>) => fetch(...args), isTauri: false }))
vi.mock('./saveFile', () => ({ saveFile: vi.fn(async () => 'saved'), pickSaveDir: vi.fn(), saveFileToDir: vi.fn() }))
vi.mock('./dataOperations', () => ({ trackDataTransfer: (fn: () => unknown) => fn() }))

const fixtures = [
  { format: 'png', ext: 'png', encoded: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
  { format: 'jpeg', ext: 'jpg', encoded: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==' },
  { format: 'webp', ext: 'webp', encoded: 'UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of' },
]
afterEach(() => { vi.restoreAllMocks(); vi.mocked(saveFile).mockClear() })

describe('原图下载使用文件头而非接口 MIME', () => {
  it.each(fixtures)('真实 $format 在错误 MIME 下仍使用正确扩展名且不转码', async ({ format, ext, encoded }) => {
    const bytes = base64ToBytes(encoded)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes as BodyInit, { headers: { 'Content-Type': format === 'png' ? 'image/webp' : 'image/png' } }))
    expect(await downloadImageIds(['original'], 'result')).toMatchObject({ successCount: 1, failCount: 0 })
    const [blob, name] = vi.mocked(saveFile).mock.calls[0]
    expect(name).toBe(`result.${ext}`)
    expect((blob as Blob).type).toBe(`image/${format}`)
    expect(new Uint8Array(await (blob as Blob).arrayBuffer())).toEqual(bytes)
  })

  it('混合格式 ZIP 保留每张原始字节及真实后缀，不改历史记录', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const item = fixtures.find((fixture) => String(url).endsWith(fixture.format))!
      return new Response(base64ToBytes(item.encoded) as BodyInit, { headers: { 'Content-Type': 'application/octet-stream' } })
    })
    expect(await downloadImageEntriesAsZip(fixtures.map((item) => ({ imageId: item.format, fileNameBase: item.format })))).toMatchObject({ successCount: 3, failCount: 0 })
    const zip = unzipSync(new Uint8Array(await (vi.mocked(saveFile).mock.calls[0][0] as Blob).arrayBuffer()))
    for (const item of fixtures) expect(zip[`${item.format}.${item.ext}`]).toEqual(base64ToBytes(item.encoded))
  })

  it('保留其他已支持类型；读取失败不创建伪造图片文件', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('GIF89a', { headers: { 'Content-Type': 'image/gif' } })).mockResolvedValueOnce(new Response('missing', { status: 404 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await downloadImageIds(['gif'], 'result')).toMatchObject({ successCount: 1 })
    expect(vi.mocked(saveFile).mock.calls[0][1]).toBe('result.gif')
    expect(await downloadImageIds(['missing'])).toMatchObject({ successCount: 0, failCount: 1 })
    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
