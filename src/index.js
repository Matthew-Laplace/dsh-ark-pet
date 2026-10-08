import { PetStore } from './store.js'
import { ActivityTracker } from './activity.js'
import { PetError, MAX_IMAGE_BYTES } from './image.js'

export const name = 'ark-pet'
export const inject = ['webServer', 'connection']

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

export async function readBody(req, limit) {
  const length = req.headers['content-length']
  if (length && (!/^\d+$/.test(String(length)) || Number(length) > limit)) {
    req.resume()
    throw new PetError('请求内容过大 / Request body is too large', 413)
  }
  const chunks = []
  let total = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    total += chunk.length
    if (total > limit) { req.resume(); throw new PetError('请求内容过大 / Request body is too large', 413) }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function bodyJson(req) {
  const bytes = await readBody(req, 16 * 1024)
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new PetError('JSON 请求无效 / Invalid JSON request') }
}

export function makeHandler(store, activity, connection) {
  return async (req, res) => {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection) { req.resume(); json(res, rejection, { error: '未授权的请求 / Unauthorized request' }); return }
      const url = new URL(req.url, 'http://127.0.0.1')
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) { json(res, 405, { error: '不支持该方法 / Method not allowed' }); return }
      if (req.method === 'POST' && (req.headers['x-dsh-ark-pet'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site')) {
        req.resume()
        json(res, 403, { error: '请求缺少安全标头 / Request lacks the safety header' })
        return
      }
      if (url.pathname.startsWith('/ark-pet/assets/')) {
        if (req.method === 'POST') throw new PetError('不支持该方法 / Method not allowed', 405)
        let parts
        try { parts = url.pathname.slice('/ark-pet/assets/'.length).split('/').map(decodeURIComponent) } catch { throw new PetError('资源路径无效 / Invalid asset path') }
        if (parts.length !== 2) throw new PetError('资源路径无效 / Invalid asset path', 404)
        const asset = await store.asset(parts[0], parts[1])
        res.writeHead(200, { 'content-type': asset.mime, 'content-length': asset.bytes.length, 'cache-control': 'private, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", etag: `"${asset.sha256}"` })
        res.end(req.method === 'HEAD' ? undefined : asset.bytes)
        return
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (url.pathname === '/ark-pet/api/state') { json(res, 200, store.snapshot(activity.snapshot())); return }
        if (url.pathname === '/ark-pet/api/catalog') { json(res, 200, store.catalogView()); return }
        throw new PetError('没有该接口 / Endpoint not found', 404)
      }
      let result
      if (url.pathname === '/ark-pet/api/import') {
        result = await store.importImage(await readBody(req, MAX_IMAGE_BYTES), url.searchParams.get('name'), url.searchParams.get('mode') || 'auto')
      } else {
        const value = await bodyJson(req)
        switch (url.pathname) {
          case '/ark-pet/api/config': result = await store.configure(value); break
          case '/ark-pet/api/select': result = await store.select(value.id); break
          case '/ark-pet/api/reset-position': result = await store.resetPosition(); break
          case '/ark-pet/api/download': result = await store.download(value.id, value.acceptRights); break
          default: throw new PetError('没有该接口 / Endpoint not found', 404)
        }
      }
      result.activity = activity.snapshot()
      json(res, 200, result)
    } catch (error) {
      if (res.destroyed || res.headersSent) return
      if (!(error instanceof PetError)) console.error('[dsh-ark-pet]', error)
      json(res, error instanceof PetError ? error.status : 500, { error: error instanceof PetError ? error.message : '操作失败，请检查本地日志 / Operation failed. Check the local log.' })
    }
  }
}

export function apply(ctx, config = {}) {
  const store = new PetStore(config).init()
  const tracker = new ActivityTracker()
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: '/ark-pet/', handler: makeHandler(store, tracker, ctx.connection) })
    return () => { store.dispose(); dispose() }
  }, 'ark-pet: private routes')
  ctx.effect(() => {
    const disposers = [
      ctx.on('session/event', (session, event) => tracker.event(session, event)),
      ctx.on('agent/status', ({ agent, status }) => tracker.status(agent.id, status)),
      ctx.on('agent/error', ({ agent }) => tracker.update(agent.id, { phase: 'failed', tool: '', pending: 0 })),
      ctx.on('agent/disposed', ({ agent }) => tracker.remove(agent.id)),
      ctx.on('approval/request', async (request, next) => {
        const resume = tracker.wait(request.agent.id)
        try { return await next() } finally { resume() }
      }),
      ctx.on('user-questions/request', async (request, next) => {
        const resume = tracker.wait(request.agent?.id)
        try { return await next() } finally { resume() }
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ark-pet: activity observers')
}
