import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PetStore, validateConfig, safePath, PINS } from '../src/store.js'
import { gitBlobSha1 } from '../src/image.js'
import { makePng, makeWebpLossless } from './helpers.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

function fresh(options = {}) {
  return new PetStore({ root: mkdtempSync(join(tmpdir(), 'ark-pet-')), packageRoot, ...options }).init()
}

test('loads the built-in pet and the pinned catalogue', () => {
  const store = fresh()
  const state = store.snapshot()
  assert.equal(state.selected.id, 'rookie')
  assert.equal(state.selected.kind, 'atlas')
  const catalog = store.catalogView()
  assert.match(catalog.revision, /^[a-f0-9]{40}$/)
  assert.equal(catalog.entries.length, 486)
  assert.ok(catalog.entries.every(entry => entry.bytes > 0))
})

test('persists configuration and reloads it', () => {
  const root = mkdtempSync(join(tmpdir(), 'ark-pet-'))
  const store = new PetStore({ root, packageRoot }).init()
  return store.configure({ size: 96, visible: false, pin: 'top-left' }).then(() => {
    const reloaded = new PetStore({ root, packageRoot }).init()
    assert.equal(reloaded.snapshot().config.size, 96)
    assert.equal(reloaded.snapshot().config.visible, false)
    assert.equal(reloaded.snapshot().config.pin, 'top-left')
  })
})

test('validates configuration values', () => {
  assert.deepEqual(validateConfig({ size: 48, pin: PINS[0], position: null }), { size: 48, pin: PINS[0], position: null })
  assert.throws(() => validateConfig({ size: 12 }), /尺寸/)
  assert.throws(() => validateConfig({ pin: 'somewhere' }), /停靠/)
  assert.throws(() => validateConfig({ position: { x: Number.NaN, y: 1 } }), /坐标/)
  assert.throws(() => validateConfig({ selectedId: 'other' }), /未知设置/)
  assert.throws(() => validateConfig({ visible: 'yes' }), /布尔值/)
})

test('imports a plain image and selects it', async () => {
  const store = fresh()
  const state = await store.importImage(makePng(200, 120), '我的宠物')
  const entry = state.selected
  assert.equal(entry.kind, 'image')
  assert.equal(entry.displayName, '我的宠物')
  assert.equal(entry.origin, 'custom')
  const asset = await store.asset(entry.id, entry.filename ?? 'image.png')
  assert.equal(asset.mime, 'image/png')
  assert.ok(asset.bytes.length > 0)
})

test('imports a Codex atlas and keeps its version', async () => {
  const store = fresh()
  const state = await store.importImage(makeWebpLossless(1536, 2288), 'v2', 'auto')
  assert.equal(state.selected.kind, 'atlas')
  assert.equal(state.selected.spriteVersionNumber, 2)
})

test('rejects traversal, bad modes, and unknown pets', async () => {
  const store = fresh()
  await assert.rejects(() => store.importImage(makePng(32, 32), 'x', 'atlas'), /图集/)
  assert.throws(() => store.select('missing'), /尚未安装/)
  assert.throws(() => safePath(store.petsRoot, '..', 'config.json'), /路径无效|越界/)
  await assert.rejects(() => store.asset('rookie', '../config.json'), /资源/)
})

test('downloads a catalogue pet and verifies its hash', async () => {
  const store = fresh()
  const source = store.catalogById.get('12f')
  const payload = makeWebpLossless(1536, 2288)
  const manifest = Buffer.from(JSON.stringify({ id: '12f', displayName: '12F', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }))
  const files = {
    'pet.json': manifest,
    'spritesheet.webp': payload,
    'SOURCE.md': Buffer.from('# Source and rights\n'),
  }
  const files2 = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes]))
  const catalogue = {
    revision: store.catalogue.revision,
    repository: store.catalogue.repository,
    entries: [{
      id: '12f',
      displayName: '12F',
      category: 'default',
      files: [
        { name: 'pet.json', sha1: gitBlobSha1(files2['pet.json']), bytes: files2['pet.json'].length },
        { name: 'spritesheet.webp', sha1: gitBlobSha1(files2['spritesheet.webp']), bytes: files2['spritesheet.webp'].length },
        { name: 'SOURCE.md', sha1: gitBlobSha1(files2['SOURCE.md']), bytes: files2['SOURCE.md'].length },
      ],
    }],
  }
  const seen = []
  const store2 = fresh({
    catalogue,
    fetcher: async url => {
      seen.push(url)
      const name = url.split('/').pop()
      return new Response(files2[name], { headers: { 'content-length': String(files2[name].length) } })
    },
  })
  assert.throws(() => store2.download('12f', false), /权利/)
  const state = await store2.download('12f', true)
  assert.equal(state.selected.id, 'ark-12f')
  assert.equal(state.selected.origin, 'ark')
  assert.equal(state.selected.spriteVersionNumber, 2)
  assert.ok(seen.every(url => url.startsWith('https://raw.githubusercontent.com/')))
  const dir = join(store2.petsRoot, 'ark-12f')
  assert.match(readFileSync(join(dir, 'SOURCE.md'), 'utf8'), /Source and rights/)
  assert.ok(readFileSync(join(dir, 'UPSTREAM-pet.json')).length > 0)
  assert.equal(store.catalogue.entries.length, 486)
})

test('rejects a catalogue download with a wrong hash', async () => {
  const store = fresh()
  const source = store.catalogById.get('12f')
  const catalogue = { revision: store.catalogue.revision, repository: store.catalogue.repository, entries: [source] }
  const store2 = fresh({ catalogue, fetcher: async () => new Response(Buffer.from('tampered'), { headers: { 'content-length': '8' } }) })
  await assert.rejects(() => store2.download('12f', true), /校验失败/)
})

test('rejects a download whose upstream manifest disagrees', async () => {
  const store = fresh()
  const manifest = Buffer.from(JSON.stringify({ id: 'other', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }))
  const payload = makeWebpLossless(1536, 2288)
  const catalogue = {
    revision: store.catalogue.revision,
    repository: store.catalogue.repository,
    entries: [{
      id: '12f',
      displayName: '12F',
      category: 'default',
      files: [
        { name: 'pet.json', sha1: gitBlobSha1(manifest), bytes: manifest.length },
        { name: 'spritesheet.webp', sha1: gitBlobSha1(payload), bytes: payload.length },
        { name: 'SOURCE.md', sha1: gitBlobSha1(Buffer.from('x')), bytes: 1 },
      ],
    }],
  }
  const store2 = fresh({
    catalogue,
    fetcher: async url => {
      const name = url.split('/').pop()
      const bytes = name === 'pet.json' ? manifest : name === 'SOURCE.md' ? Buffer.from('x') : payload
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    },
  })
  await assert.rejects(() => store2.download('12f', true), /清单与目录不一致/)
})

test('ignores a local entry that is not a valid pet', () => {
  const root = mkdtempSync(join(tmpdir(), 'ark-pet-'))
  const store = new PetStore({ root, packageRoot }).init()
  const broken = join(store.petsRoot, 'broken')
  mkdirSync(broken)
  writeFileSync(join(broken, 'pet.json'), JSON.stringify({ id: 'broken', spritesheetPath: 'image.png' }))
  writeFileSync(join(broken, 'image.png'), Buffer.from('nope'))
  const reloaded = new PetStore({ root, packageRoot }).init()
  assert.equal(reloaded.entries.has('broken'), false)
  assert.equal(reloaded.snapshot().selected.id, 'rookie')
})
