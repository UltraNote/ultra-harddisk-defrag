// Packs every build/icon-<size>.png (written by make-icon.mjs) into one multi-entry .ico.
// PNG-compressed entries are supported by Windows Vista and later, and each entry is
// rendered at its native size — no bitmap scaling by Explorer, rcedit or NSIS.
import { promises as fs } from 'node:fs'
import path from 'node:path'

const buildDir = path.resolve('build')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const images = []
for (const size of SIZES) {
  try {
    const png = await fs.readFile(path.join(buildDir, `icon-${size}.png`))
    images.push({ size, png })
  } catch {
    // Missing size: skip it rather than failing the build.
  }
}
if (!images.length) {
  const png = await fs.readFile(path.join(buildDir, 'icon.png'))
  images.push({ size: png.readUInt32BE(16), png })
}

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)

const directory = Buffer.alloc(16 * images.length)
let offset = 6 + directory.length
images.forEach(({ size, png }, index) => {
  const entry = index * 16
  directory[entry] = size >= 256 ? 0 : size
  directory[entry + 1] = size >= 256 ? 0 : size
  directory[entry + 2] = 0 // palette colours
  directory[entry + 3] = 0 // reserved
  directory.writeUInt16LE(1, entry + 4) // colour planes
  directory.writeUInt16LE(32, entry + 6) // bits per pixel
  directory.writeUInt32LE(png.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += png.length
})

const ico = Buffer.concat([header, directory, ...images.map((image) => image.png)])
await fs.writeFile(path.join(buildDir, 'icon.ico'), ico)
console.log(`wrote build/icon.ico (${ico.length} bytes, ${images.length} sizes: ${images.map((i) => i.size).join(', ')})`)
