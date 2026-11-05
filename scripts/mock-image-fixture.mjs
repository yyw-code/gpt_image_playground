import { deflateSync } from 'node:zlib'

/** PNG 块包含长度、类型、数据及 CRC；仅用于本地确定性像素夹具。 */
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, content, checksum])
}

/** 生成可实际解码的 RGB 图片；尺寸限于本地验收范围，序号使各张内容可区分。 */
export function createFixturePng(width, height, index = 0) {
  if (![width, height].every((size) => Number.isInteger(size) && size > 0 && size <= 4096)) throw new Error('无效夹具尺寸')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3
    pixels[offset] = (x + index * 31) % 256
    pixels[offset + 1] = (y + index * 47) % 256
    pixels[offset + 2] = index * 19 % 256
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
