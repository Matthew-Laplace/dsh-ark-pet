import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectImage, gitBlobSha1, PetError } from '../src/image.js'
import { makePng, makeWebpLossless, makeGif } from './helpers.js'

test('reads PNG dimensions and detects a v1 atlas', () => {
  const image = inspectImage(makePng(1536, 1872), 'auto')
  assert.equal(image.kind, 'atlas')
  assert.equal(image.spriteVersionNumber, 1)
  assert.equal(image.format, 'png')
  assert.equal(image.width, 1536)
})

test('detects a v2 atlas and a plain image', () => {
  assert.equal(inspectImage(makePng(1536, 2288)).spriteVersionNumber, 2)
  const plain = inspectImage(makePng(320, 240))
  assert.equal(plain.kind, 'image')
  assert.equal(plain.spriteVersionNumber, null)
})

test('atlas mode rejects a non atlas size', () => {
  assert.throws(() => inspectImage(makePng(320, 240), 'atlas'), PetError)
})

test('rejects animated PNG in image mode', () => {
  assert.throws(() => inspectImage(makePng(320, 240, { animated: true }), 'image'), /动画|animation/)
})

test('reads WebP lossless dimensions', () => {
  const image = inspectImage(makeWebpLossless(640, 480))
  assert.equal(image.width, 640)
  assert.equal(image.height, 480)
  assert.equal(image.format, 'webp')
})

test('reads GIF dimensions', () => {
  const image = inspectImage(makeGif(200, 300))
  assert.equal(image.width, 200)
  assert.equal(image.height, 300)
  assert.equal(image.format, 'gif')
})

test('rejects unknown, truncated, and oversized payloads', () => {
  assert.throws(() => inspectImage(Buffer.from('not an image')), /仅支持/)
  const png = makePng(64, 64)
  assert.throws(() => inspectImage(png.subarray(0, png.length - 4)), /不完整/)
  assert.throws(() => inspectImage(Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)])), error => error.status === 413)
  assert.throws(() => inspectImage(makePng(64, 64), 'sideways'), /导入模式/)
})

test('computes the Git blob hash of a buffer', () => {
  assert.equal(gitBlobSha1(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a')
})
