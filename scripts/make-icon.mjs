// Generates build/icon.png (256x256 RGBA) without any image dependency.
// Shield silhouette + gradient + check mark, drawn analytically and deflated as PNG.
import { deflateSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SIZE = 256
const px = Buffer.alloc(SIZE * SIZE * 4)

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v))
}

function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]
}

// Distance from point to segment, for the check mark stroke.
function segDist(px0, py0, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = clamp(((px0 - x1) * dx + (py0 - y1) * dy) / (dx * dx + dy * dy), 0, 1)
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px0 - cx, py0 - cy)
}

const cyan = [34, 211, 238]
const blue = [79, 140, 255]
const violet = [139, 92, 246]

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const u = x - SIZE / 2
    const v = y - SIZE / 2

    // Rounded-square backdrop with a soft vertical gradient.
    const r = 56
    const qx = Math.max(Math.abs(u) - (SIZE / 2 - 8 - r), 0)
    const qy = Math.max(Math.abs(v) - (SIZE / 2 - 8 - r), 0)
    const backdrop = Math.hypot(qx, qy) <= r
    const bgTop = [13, 20, 36]
    const bgBottom = [7, 10, 19]
    const bg = mix(bgTop, bgBottom, clamp((v + 128) / 256, 0, 1))

    // Shield: width tapers towards a point at the bottom.
    const top = v >= -100 && v <= 112
    const taper = clamp((v + 100) / 212, 0, 1)
    const halfWidth = 86 * Math.pow(1 - taper, 0.55)
    const insideShield = top && Math.abs(u) <= halfWidth
    const edge = top && Math.abs(Math.abs(u) - halfWidth) < 2.2 && v < 96

    // Check mark inside the shield.
    const check =
      segDist(u, v, -34, 2, -8, 30) < 9 ||
      segDist(u, v, -8, 30, 40, -26) < 9

    const gradT = clamp((u + v + 200) / 400, 0, 1)
    const accent = gradT < 0.5 ? mix(cyan, blue, gradT * 2) : mix(blue, violet, (gradT - 0.5) * 2)

    let color = bg
    let alpha = backdrop ? 255 : 0

    if (insideShield) {
      const fillT = clamp((v + 100) / 212, 0, 1)
      color = mix(accent, mix(accent, [255, 255, 255], 0.12), 1 - fillT)
      // Darken the interior so the check mark reads clearly.
      color = mix(color, [10, 16, 30], 0.72)
      if (edge) color = mix(color, accent, 0.9)
      if (check) color = mix(accent, [235, 250, 255], 0.35)
    } else if (edge) {
      color = accent
    }

    px[i] = Math.round(clamp(color[0], 0, 255))
    px[i + 1] = Math.round(clamp(color[1], 0, 255))
    px[i + 2] = Math.round(clamp(color[2], 0, 255))
    px[i + 3] = alpha
  }
}

// PNG: IHDR, IDAT (filter 0 per scanline), IEND.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of Buffer.concat([typeBuf, data])) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const outDir = path.resolve('build')
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(path.join(outDir, 'icon.png'), png)
console.log(`wrote build/icon.png (${png.length} bytes)`)
