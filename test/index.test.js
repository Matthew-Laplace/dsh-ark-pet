import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, readBody } from '../src/index.js'
import { makePng, makeRequest, makeResponse } from './helpers.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

function boot(connection) {
  const routes = [], listeners = new Map()
  const ctx = {
    webServer: { register: route => { routes.push(route); return () => {} } },
    get: name => (name === 'connection' ? connection : undefined),
    effect: callback => { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
    on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name) },
  }
  apply(ctx, { root: mkdtempSync(join(tmpdir(), 'ark-pet-')), packageRoot })
  return { route: routes[0], listeners }
}

const state = async route => {
  const res = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state' }), res)
  return res
}

test('registers one prefix route on the web server', () => {
  const { route } = boot()
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/ark-pet/')
})

test('serves state, catalogue, and the built-in atlas', async () => {
  const { route } = boot()
  const snapshot = await state(route)
  assert.equal(snapshot.status, 200)
  const body = JSON.parse(snapshot.body)
  assert.equal(body.selected.id, 'rookie')
  assert.match(body.selected.atlasUrl, /^\/ark-pet\/assets\/rookie\//)
  assert.equal(body.activity.phase, 'idle')

  const catalog = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/catalog' }), catalog)
  assert.equal(JSON.parse(catalog.body).entries.length, 486)

  const asset = makeResponse()
  await route.handler(makeRequest({ url: body.selected.atlasUrl.split('?')[0] }), asset)
  assert.equal(asset.status, 200)
  assert.equal(asset.headers['content-type'], 'image/png')
  assert.ok(asset.body.length > 0)
})

test('rejects unauthorized, unsafe, and unknown requests', async () => {
  const { route } = boot()
  const post = (url, body, headers = {}) => {
    const res = makeResponse()
    return route.handler(makeRequest({ method: 'POST', url, headers, body }), res).then(() => res)
  }
  const missingHeader = await post('/ark-pet/api/config', '{}')
  assert.equal(missingHeader.status, 403)

  const crossSite = await post('/ark-pet/api/config', '{}', { 'x-dsh-ark-pet': '1', 'sec-fetch-site': 'cross-site' })
  assert.equal(crossSite.status, 403)

  const unknown = await post('/ark-pet/api/nope', '{}', { 'x-dsh-ark-pet': '1' })
  assert.equal(unknown.status, 404)

  const badJson = await post('/ark-pet/api/config', 'not json', { 'x-dsh-ark-pet': '1' })
  assert.equal(badJson.status, 400)

  const badSetting = await post('/ark-pet/api/config', JSON.stringify({ size: 4000 }), { 'x-dsh-ark-pet': '1' })
  assert.equal(badSetting.status, 400)

  const notFound = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/missing' }), notFound)
  assert.equal(notFound.status, 404)
})

test('guards its own route when no connection service is composed', async () => {
  const { route } = boot()
  const withoutHost = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state', headers: { host: '' } }), withoutHost)
  assert.equal(withoutHost.status, 403)

  const foreignHost = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state', headers: { host: 'evil.example' } }), foreignHost)
  assert.equal(foreignHost.status, 403)

  const foreignOrigin = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state', headers: { host: '127.0.0.1:19387', origin: 'https://evil.example' } }), foreignOrigin)
  assert.equal(foreignOrigin.status, 403)

  const sameOrigin = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state', headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' } }), sameOrigin)
  assert.equal(sameOrigin.status, 200)
})

test('delegates the trust check to the connection service when it is composed', async () => {
  let seen = 0
  const { route } = boot({ requestRejection: request => { seen++; return request.headers.host === 'blocked' ? 401 : undefined } })
  const blocked = makeResponse()
  await route.handler(makeRequest({ url: '/ark-pet/api/state', headers: { host: 'blocked' } }), blocked)
  assert.equal(blocked.status, 401)
  assert.equal(seen, 1)
})

test('applies configuration, imports an image, and rejects oversized bodies', async () => {
  const { route } = boot()
  const post = (url, body, headers = { 'x-dsh-ark-pet': '1' }) => {
    const res = makeResponse()
    return route.handler(makeRequest({ method: 'POST', url, headers, body }), res).then(() => res)
  }
  const configured = await post('/ark-pet/api/config', JSON.stringify({ size: 96, bubble: false }))
  assert.equal(configured.status, 200)
  assert.equal(JSON.parse(configured.body).config.size, 96)
  assert.equal(JSON.parse(configured.body).config.bubble, false)

  const imported = await post('/ark-pet/api/import?mode=auto&name=%E6%88%91%E7%9A%84', makePng(200, 120))
  assert.equal(imported.status, 200)
  const selected = JSON.parse(imported.body).selected
  assert.equal(selected.kind, 'image')
  assert.equal(selected.displayName, '我的')

  const oversized = await post('/ark-pet/api/config', JSON.stringify({ size: 96 }), {
    'x-dsh-ark-pet': '1',
    'content-length': String(17 * 1024),
  })
  assert.equal(oversized.status, 413)

  const download = await post('/ark-pet/api/download', JSON.stringify({ id: 'nope', acceptRights: true }))
  assert.equal(download.status, 404)

  const refused = await post('/ark-pet/api/download', JSON.stringify({ id: '12f', acceptRights: false }))
  assert.equal(refused.status, 400)
})

test('rejects a read body above the cap', async () => {
  const request = makeRequest({ method: 'POST', headers: { 'content-length': '999999' } })
  await assert.rejects(() => readBody(request, 1024), error => error.status === 413)
})

test('tracks agent activity through the registered listeners', async () => {
  const { route, listeners } = boot()
  listeners.get('session/event')({ id: 's1', header: { origin: 'user' } }, { type: 'tool/call', data: { name: 'Bash' } })
  const res = await state(route)
  assert.deepEqual(JSON.parse(res.body).activity, { phase: 'working', tool: 'Bash', activeSessions: 1 })

  listeners.get('agent/error')({ agent: { id: 's1' } })
  assert.equal(JSON.parse((await state(route)).body).activity.phase, 'failed')

  listeners.get('agent/disposed')({ agent: { id: 's1' } })
  assert.equal(JSON.parse((await state(route)).body).activity.phase, 'idle')
})

test('marks a pending approval as waiting', async () => {
  const { route, listeners } = boot()
  let finish
  const pending = listeners.get('approval/request')({ agent: { id: 's1' } }, () => new Promise(resolve => { finish = resolve }))
  assert.equal(JSON.parse((await state(route)).body).activity.phase, 'waiting')
  finish('allowed-once')
  await pending
  assert.equal(JSON.parse((await state(route)).body).activity.phase, 'thinking')
})
