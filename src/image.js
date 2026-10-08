import { createHash } from 'node:crypto'

export class PetError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'PetError'
    this.status = status
  }
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 4096 * 4096
const MAX_ANIMATION_PIXELS = 64 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function bounds(width, height, frames = 1) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > MAX_PIXELS || frames > 256 || width * height * frames > MAX_ANIMATION_PIXELS) {
    throw new PetError('图片尺寸或动画帧数超出限制 / Image dimensions or frame count exceed the limit')
  }
}

function pngDimensions(b) {
  if (b.length < 45 || b.readUInt32BE(8) !== 13 || b.toString('ascii', 12, 16) !== 'IHDR') throw new PetError('PNG 文件不完整 / Incomplete PNG file')
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20)
  bounds(width, height)
  let p = 8, imageData = false, end = false, frames = 1
  while (p + 12 <= b.length) {
    const n = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8)
    if (p + n + 12 > b.length) throw new PetError('PNG 数据块不完整 / Incomplete PNG chunk')
    if (type === 'IDAT' && n > 0) imageData = true
    if (type === 'acTL') {
      if (n !== 8) throw new PetError('APNG 数据块无效 / Invalid APNG chunk')
      frames = b.readUInt32BE(p + 8)
      if (!frames) throw new PetError('APNG 帧数无效 / Invalid APNG frame count')
      bounds(width, height, frames)
    }
    p += n + 12
    if (type === 'IEND') { end = n === 0 && p === b.length; break }
  }
  if (!imageData || !end) throw new PetError('PNG 文件不完整 / Incomplete PNG file')
  return { width, height, frames }
}

function webpDimensions(b) {
  if (b.length < 26 || b.readUInt32LE(4) + 8 !== b.length) throw new PetError('WebP 文件不完整 / Incomplete WebP file')
  let p = 12, dim, imageData = false, frames = 0, animationPixels = 0
  while (p + 8 <= b.length) {
    const type = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4), data = p + 8
    if (data + n + (n % 2) > b.length) throw new PetError('WebP 数据块不完整 / Incomplete WebP chunk')
    if (type === 'VP8X') {
      if (n !== 10) throw new PetError('WebP 头部无效 / Invalid WebP header')
      dim = { width: 1 + b.readUIntLE(data + 4, 3), height: 1 + b.readUIntLE(data + 7, 3) }
    } else if (type === 'VP8L') {
      if (n < 5 || b[data] !== 0x2f) throw new PetError('WebP 无损头部无效 / Invalid WebP lossless header')
      const bits = b.readUInt32LE(data + 1)
      dim ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      imageData = true
    } else if (type === 'VP8 ') {
      if (n < 10 || b[data + 3] !== 0x9d || b[data + 4] !== 1 || b[data + 5] !== 0x2a) throw new PetError('WebP 有损头部无效 / Invalid WebP lossy header')
      dim ??= { width: b.readUInt16LE(data + 6) & 0x3fff, height: b.readUInt16LE(data + 8) & 0x3fff }
      imageData = true
    } else if (type === 'ANMF') {
      if (n < 24) throw new PetError('WebP 动画帧不完整 / Incomplete WebP animation frame')
      const w = b.readUIntLE(data + 6, 3) + 1, h = b.readUIntLE(data + 9, 3) + 1
      bounds(w, h)
      animationPixels += w * h
      frames++
      if (frames > 256 || animationPixels > MAX_ANIMATION_PIXELS) throw new PetError('WebP 动画过大 / WebP animation is too large')
      imageData = true
    }
    p = data + n + (n % 2)
  }
  if (!dim || !imageData || p !== b.length) throw new PetError('WebP 图片数据无效 / Invalid WebP image data')
  bounds(dim.width, dim.height)
  return { ...dim, frames: Math.max(1, frames) }
}

function gifDimensions(b) {
  if (b.length < 14) throw new PetError('GIF 文件不完整 / Incomplete GIF file')
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8)
  bounds(width, height)
  let p = 13 + ((b[10] & 0x80) ? 3 * 2 ** ((b[10] & 7) + 1) : 0), frames = 0, pixels = 0
  const subBlocks = () => {
    while (p < b.length) {
      const n = b[p++]
      if (!n) return
      p += n
      if (p > b.length) break
    }
    throw new PetError('GIF 数据块不完整 / Incomplete GIF block')
  }
  while (p < b.length) {
    const marker = b[p++]
    if (marker === 0x3b) {
      if (!frames || p !== b.length) break
      return { width, height, frames }
    }
    if (marker === 0x21) { p++; subBlocks(); continue }
    if (marker !== 0x2c || p + 9 > b.length) break
    const w = b.readUInt16LE(p + 4), h = b.readUInt16LE(p + 6), packed = b[p + 8]
    bounds(w, h)
    if (w > width || h > height) break
    pixels += w * h
    if (++frames > 256 || pixels > MAX_ANIMATION_PIXELS) throw new PetError('GIF 动画过大 / GIF animation is too large')
    p += 9 + ((packed & 0x80) ? 3 * 2 ** ((packed & 7) + 1) : 0)
    if (p >= b.length || b[p] < 2 || b[p] > 8) break
    p++
    subBlocks()
  }
  throw new PetError('GIF 文件不完整 / Incomplete GIF file')
}

export function inspectImage(buffer, mode = 'auto') {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new PetError('图片必须小于 8 MiB / Image must be smaller than 8 MiB', 413)
  let format, dimensions
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) { format = 'png'; dimensions = pngDimensions(buffer) }
  else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') { format = 'webp'; dimensions = webpDimensions(buffer) }
  else if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) { format = 'gif'; dimensions = gifDimensions(buffer) }
  else throw new PetError('仅支持 PNG、WebP、GIF / Only PNG, WebP, and GIF are supported')
  if (!['auto', 'atlas', 'image'].includes(mode)) throw new PetError('导入模式无效 / Invalid import mode')
  if (dimensions.frames > 1) throw new PetError('不支持动画图片，请改用单帧图片 / Animated images are not supported; use a single-frame image')
  const { width, height } = dimensions
  const version = width === 1536 && height === 1872 ? 1 : width === 1536 && height === 2288 ? 2 : null
  if (mode === 'atlas' && !version) throw new PetError('Codex 图集必须为 1536×1872 或 1536×2288 / Invalid Codex atlas dimensions')
  return { ...dimensions, format, mime: `image/${format}`, kind: mode !== 'image' && version ? 'atlas' : 'image', spriteVersionNumber: mode === 'image' ? null : version }
}

export function gitBlobSha1(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

export function imageSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
