// Draws .claude-plugin/icon.png, the plugin directory's listing icon: Płanetnik from the
// mod's own pixel grid, mid-storm with his bolt raised, on the navy of his original art.
// Run with `bun docs/icon.ts` after changing Płanetnik. Node's zlib is the only dependency.

import { deflateSync } from 'node:zlib'

import { HEIGHT, planetnik, pixelColor, WIDTH } from '../src/mascot.ts'

const SIZE = 512
const SCALE = 16
const NAVY = [0x0f, 0x17, 0x29]
/** The figure and his bolt, without the rain and hail that turn to noise at icon size. */
const grid = planetnik(72).map(row => row.map(p => (p === 'r' || p === 'i' ? null : p)))

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const left = Math.floor((SIZE - WIDTH * SCALE) / 2)
const top = Math.floor((SIZE - HEIGHT * SCALE) / 2)

// One filter byte (0, none) before each row of RGB.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3))
for (let y = 0; y < SIZE; y++) {
  raw[y * (1 + SIZE * 3)] = 0
  for (let x = 0; x < SIZE; x++) {
    const p = grid[Math.floor((y - top) / SCALE)]?.[Math.floor((x - left) / SCALE)]
    const inside = x >= left && y >= top && x < left + WIDTH * SCALE && y < top + HEIGHT * SCALE
    raw.set(inside && p ? rgb(pixelColor(p)) : NAVY, y * (1 + SIZE * 3) + 1 + x * 3)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}
const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
await Bun.write(new URL('../.claude-plugin/icon.png', import.meta.url), png)
console.log(`.claude-plugin/icon.png: ${SIZE}×${SIZE}, ${png.length} bytes`)
