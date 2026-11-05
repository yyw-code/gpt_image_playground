import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }))

vi.mock('./dbIndexedDb', async (original) => ({ ...await original<typeof import('./dbIndexedDb')>(), getImage: vi.fn(), putImage: vi.fn() }))

import * as db from './db'
import * as indexedDbBackend from './dbIndexedDb'

describe('db 门面（网页版）', () => {
  it('底层存取全部使用 IndexedDB 实现', () => {
    for (const [name, fn] of Object.entries(indexedDbBackend)) {
      expect(db[name as keyof typeof db], name).toBe(fn)
    }
  })
})

it('严格保存最终图片时拒绝无法解码的数据，不写入图片库', async () => {
  vi.spyOn(indexedDbBackend, 'getImage').mockResolvedValue(undefined)
  const put = vi.spyOn(indexedDbBackend, 'putImage')
  vi.stubGlobal('Image', class { onerror?: () => void; set src(_value: string) { queueMicrotask(() => this.onerror?.()) } })
  try {
    await expect(db.storeImageWithSize('data:image/png;base64,broken', 'generated', true)).rejects.toThrow('解码')
    expect(put).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
