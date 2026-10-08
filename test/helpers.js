import { deflateSync } from 'node:zlib'
import { Readable } from 'node:stream'

const TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

export function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export function makePng(width, height, { animated = false } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) row[1 + x * 4 + 3] = 255
    rows.push(row)
  }
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)]
  if (animated) {
    const actl = Buffer.alloc(8)
    actl.writeUInt32BE(2, 0)
    actl.writeUInt32BE(0, 4)
    parts.push(chunk('acTL', actl))
  }
  parts.push(chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

export function makeWebpLossless(width, height) {
  const bits = (width - 1) | ((height - 1) << 14)
  const payload = Buffer.alloc(5)
  payload[0] = 0x2f
  payload.writeUInt32LE(bits >>> 0, 1)
  const body = Buffer.concat([Buffer.from('VP8L', 'ascii'), u32(payload.length), payload, Buffer.alloc(payload.length % 2)])
  const riff = Buffer.concat([Buffer.from('WEBP', 'ascii'), body])
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), u32(riff.length), riff])
}

export function makeGif(width, height) {
  const header = Buffer.alloc(13)
  header.write('GIF87a', 0, 'ascii')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  const descriptor = Buffer.alloc(10)
  descriptor[0] = 0x2c
  descriptor.writeUInt16LE(width, 5)
  descriptor.writeUInt16LE(height, 7)
  return Buffer.concat([header, descriptor, Buffer.from([0x02, 0x01, 0x00, 0x00, 0x3b])])
}

function u32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

export function makeRequest({ method = 'GET', url = '/ark-pet/api/state', headers = {}, body } = {}) {
  const finalHeaders = { host: '127.0.0.1:19387', ...headers }
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(String(body))]
  if (body !== undefined && finalHeaders['content-length'] === undefined) finalHeaders['content-length'] = String(chunks[0].length)
  return {
    method,
    url,
    headers: finalHeaders,
    destroyed: false,
    resume() {},
    iterator: () => Readable.from(chunks),
  }
}

export function makeResponse() {
  return {
    status: 0,
    headers: null,
    body: undefined,
    headersSent: false,
    destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
    end(body) { this.body = body === undefined ? '' : body.toString() },
  }
}
