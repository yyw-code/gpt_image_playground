import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { createFixturePng } from './mock-image-fixture.mjs'

describe('本地真实像素夹具', () => {
  it('生成真实宽高和像素数据，序号改变内容', () => {
    const image = createFixturePng(320, 180, 1)
    assert.equal(image.readUInt32BE(16), 320)
    assert.equal(image.readUInt32BE(20), 180)
    const length = image.readUInt32BE(33)
    assert.equal(inflateSync(image.subarray(41, 41 + length)).length, 180 * (1 + 320 * 3))
    assert.notDeepEqual(image, createFixturePng(320, 180, 2))
  })
  it('拒绝无效或过大的内存分配', () => {
    for (const size of [0, -1, 1.5, 8192]) assert.throws(() => createFixturePng(size, 100, 1))
  })
})
