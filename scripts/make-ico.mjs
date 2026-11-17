// Wraps build/icon.png into a single-entry .ico (PNG-compressed, supported since Vista).
import { promises as fs } from 'node:fs'
import path from 'node:path'

const png = await fs.readFile(path.resolve('build', 'icon.png'))
const size = png.readUInt32BE(16) // PNG IHDR width
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // one image

const entry = Buffer.alloc(16)
entry[0] = size >= 256 ? 0 : size // 0 means 256
entry[1] = size >= 256 ? 0 : size
entry[2] = 0 // palette
entry[3] = 0 // reserved
entry.writeUInt16LE(1, 4) // colour planes
entry.writeUInt16LE(32, 6) // bits per pixel
entry.writeUInt32LE(png.length, 8) // image size
entry.writeUInt32LE(6 + 16, 12) // offset of image data

const ico = Buffer.concat([header, entry, png])
await fs.writeFile(path.resolve('build', 'icon.ico'), ico)
console.log(`wrote build/icon.ico (${ico.length} bytes, ${size}x${size})`)
