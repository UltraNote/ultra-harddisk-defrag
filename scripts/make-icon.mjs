// Generates the Ultra Harddisk Defrag icon analytically — no image dependency.
//
// Design: three stacked platters (a disk drive) with a fragmentation band across the
// middle one — three loose blocks on the left consolidating into one solid bar on the
// right. Amber top platter, teal bottom platter. Deliberately unlike Ultra Malware
// Fighter's shield mark, so the two apps are never confused in the taskbar or tray.
//
// Every size is rendered analytically (never downscaled), so 16 px stays legible.
import { deflateSync } from 'node:zlib'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const AMBER = [245, 176, 65]
const AMBER_BRIGHT = [251, 191, 36]
const TEAL = [20, 184, 166]
const TEAL_BRIGHT = [94, 234, 212]
const BG_TOP = [30, 35, 46]
const BG_BOTTOM = [14, 17, 23]
const SS = 4 // supersampling factor, box-filtered down — kills the curve aliasing

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]
const TAU = Math.PI * 2

/** One sample of the artwork at normalised coordinates. Returns [r, g, b, a]. */
function shade(u, v) {
  const half = 0.94
  const radius = 0.44
  const qx = Math.max(Math.abs(u) - (half - radius), 0)
  const qy = Math.max(Math.abs(v) - (half - radius), 0)
  const edgeDistance = Math.hypot(qx, qy)
  if (edgeDistance > radius) return [0, 0, 0, 0]

  let color = mix(BG_TOP, BG_BOTTOM, clamp((v + 1) / 2, 0, 1))
  // Rim light so the squircle stays visible on a dark Windows taskbar.
  const rim = clamp(1 - (radius - edgeDistance) / 0.06, 0, 1)
  color = mix(color, AMBER, rim * 0.22)

  const r = Math.hypot(u, v)
  const angle = (Math.atan2(v, u) * 180) / Math.PI // -180..180

  // Outer bezel of the platter — horizontal gradient so it agrees with the artwork:
  // fragmented (teal) on the left, consolidated (amber) on the right.
  if (r <= 0.895 && r >= 0.805) {
    const t = clamp((u + 0.85) / 1.7, 0, 1)
    color = mix(TEAL_BRIGHT, AMBER_BRIGHT, t)
  } else if (r <= 0.805 && r >= 0.75) {
    color = mix(BG_BOTTOM, [0, 0, 0], 0.35) // dark gap between bezel and track band
  } else if (r <= 0.75 && r >= 0.40) {
    // Track band: fragmented arcs on the left, one consolidated arc on the right.
    const consolidated = Math.abs(angle) <= 62
    const fragments = [
      [148, 116],
      [104, 72],
      [206, 172]
    ]
    const inFragment = fragments.some(([a, b]) => angle >= b && angle <= a) || (angle <= -148 && angle >= -206)
    if (consolidated) {
      const t = clamp((u + 0.6) / 1.2, 0, 1)
      color = mix(TEAL_BRIGHT, AMBER_BRIGHT, t)
    } else if (inFragment) {
      color = mix(TEAL, BG_TOP, 0.35)
    } else {
      color = mix(BG_TOP, BG_BOTTOM, 0.6)
    }
    // Thin separation line at the band edges.
    if (r <= 0.425 || r >= 0.725) color = mix(color, [0, 0, 0], 0.35)
  } else if (r < 0.40) {
    // Hub.
    if (r >= 0.155 && r <= 0.235) color = mix(AMBER_BRIGHT, [255, 255, 255], 0.35)
    else if (r < 0.155) color = mix(BG_BOTTOM, AMBER, 0.18)
    else color = mix(BG_TOP, BG_BOTTOM, 0.7)
  }

  return [color[0], color[1], color[2], 255]
}

function render(size) {
  const big = size * SS
  const acc = new Float64Array(size * size * 4)
  for (let y = 0; y < big; y++) {
    const v = ((y + 0.5) / big) * 2 - 1
    const ty = Math.floor(y / SS)
    for (let x = 0; x < big; x++) {
      const u = ((x + 0.5) / big) * 2 - 1
      const sample = shade(u, v)
      const idx = (ty * size + Math.floor(x / SS)) * 4
      acc[idx] += sample[0]
      acc[idx + 1] += sample[1]
      acc[idx + 2] += sample[2]
      acc[idx + 3] += sample[3]
    }
  }
  const px = Buffer.alloc(size * size * 4)
  const n = SS * SS
  for (let i = 0; i < px.length; i += 4) {
    // Average colour weighted by coverage; premultiplied so edges do not darken.
    const a = acc[i + 3] / n
    const coverage = a / 255
    for (let c = 0; c < 3; c++) {
      const value = coverage > 0 ? acc[i + c] / (coverage * n) : 0
      px[i + c] = Math.round(clamp(value, 0, 255))
    }
    px[i + 3] = Math.round(clamp(a, 0, 255))
  }
  return px
}

const CRC_TABLE = (() => {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  let crc = 0xffffffff
  for (const byte of Buffer.concat([typeBuf, data])) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, px) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    px.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const outDir = path.resolve('build')
await fs.mkdir(outDir, { recursive: true })

for (const size of SIZES) {
  const png = encodePng(size, size, render(size))
  if (size === 256) await fs.writeFile(path.join(outDir, 'icon.png'), png)
  await fs.writeFile(path.join(outDir, `icon-${size}.png`), png)
}

// Preview sheet: 16/32/64/128 enlarged with nearest-neighbour + the 256 original, on a
// checkerboard, so the artwork can be reviewed at real sizes without guessing.
const sheetW = 1040
const sheetH = 300
const sheet = Buffer.alloc(sheetW * sheetH * 4)
for (let y = 0; y < sheetH; y++) {
  for (let x = 0; x < sheetW; x++) {
    const i = (y * sheetW + x) * 4
    const checker = (Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0 ? 34 : 24
    sheet[i] = checker
    sheet[i + 1] = checker
    sheet[i + 2] = checker + 4
    sheet[i + 3] = 255
  }
}

let cursor = 14
for (const [size, scale] of [
  [16, 6],
  [32, 4],
  [64, 3],
  [128, 2],
  [256, 1]
]) {
  const px = render(size)
  const drawn = size * scale
  const top = Math.round((sheetH - drawn) / 2)
  for (let y = 0; y < drawn; y++) {
    for (let x = 0; x < drawn; x++) {
      const sx = Math.floor(x / scale)
      const sy = Math.floor(y / scale)
      const src = (sy * size + sx) * 4
      const dst = ((top + y) * sheetW + cursor + x) * 4
      const a = px[src + 3] / 255
      for (let c = 0; c < 3; c++) {
        sheet[dst + c] = Math.round(sheet[dst + c] * (1 - a) + px[src + c] * a)
      }
    }
  }
  cursor += drawn + 14
}
await fs.writeFile(path.join(outDir, 'icon-preview.png'), encodePng(sheetW, sheetH, sheet))

console.log(`wrote build/icon.png (256) + icon-{${SIZES.join(',')}}.png + icon-preview.png`)
