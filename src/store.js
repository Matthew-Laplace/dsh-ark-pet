import { mkdirSync, readdirSync, readFileSync, realpathSync, lstatSync, writeFileSync } from 'node:fs'
import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, join, basename, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectImage, gitBlobSha1, imageSha256, PetError, MAX_IMAGE_BYTES } from './image.js'

export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))
export const PINS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
export const DEFAULT_CONFIG = Object.freeze({ selectedId: 'rookie', visible: true, size: 144, pin: 'bottom-right', position: null, mouseTracking: true, bubble: true, revision: 0 })
const ID = /^[a-z0-9][a-z0-9-]{0,110}$/
const FILE = /^[a-z0-9][a-z0-9._-]{0,100}$/i
const CONFIG_KEYS = ['selectedId', 'visible', 'size', 'pin', 'position', 'mouseTracking', 'bubble', 'revision']

export function dataHome(env = process.env, home = homedir()) {
  return resolve(env.DSH_HOME?.trim() || join(home, '.dsh'), 'ark-pet')
}

export function safePath(root, ...parts) {
  for (const part of parts) if (typeof part !== 'string' || !FILE.test(part) || part === '.' || part === '..') throw new PetError('文件路径无效 / Invalid file path')
  const result = resolve(root, ...parts), rel = relative(resolve(root), result)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new PetError('文件路径越界 / File path escapes the data directory')
  return result
}

function readRegular(path, cap) {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > cap) throw new PetError('文件类型或大小无效 / Invalid file type or size')
  return readFileSync(path)
}

function label(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : fallback
}

export function validateConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PetError('设置必须为对象 / Settings must be an object')
  const result = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!CONFIG_KEYS.includes(key) || key === 'revision' || key === 'selectedId') throw new PetError(`未知设置 / Unknown setting: ${key}`)
    if (['visible', 'mouseTracking', 'bubble'].includes(key)) {
      if (typeof value !== 'boolean') throw new PetError(`设置 ${key} 必须为布尔值 / Setting ${key} must be a boolean`)
    } else if (key === 'size') {
      if (!Number.isInteger(value) || value < 48 || value > 384) throw new PetError('尺寸必须是 48–384 的整数 / Size must be an integer between 48 and 384')
    } else if (key === 'pin') {
      if (!PINS.includes(value)) throw new PetError('停靠位置无效 / Invalid dock position')
    } else if (key === 'position') {
      if (value !== null && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 100000 || Math.abs(value.y) > 100000)) throw new PetError('拖拽坐标无效 / Invalid drag coordinates')
    }
    result[key] = value
  }
  return result
}

export class PetStore {
  constructor({ root = dataHome(), packageRoot = PACKAGE_ROOT, fetcher = fetch, catalogue } = {}) {
    this.root = resolve(root)
    this.petsRoot = join(this.root, 'pets')
    this.packageRoot = packageRoot
    this.fetcher = fetcher
    this.catalogue = catalogue
    this.entries = new Map()
    this.config = { ...DEFAULT_CONFIG }
    this.queue = Promise.resolve()
    this.downloads = new Map()
    this.abort = new AbortController()
  }

  init() {
    mkdirSync(this.petsRoot, { recursive: true, mode: 0o700 })
    for (const dir of [this.root, this.petsRoot]) {
      const info = lstatSync(dir)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new PetError('数据目录不能是符号链接 / Data directory cannot be a symbolic link')
    }
    this.petsRoot = realpathSync(this.petsRoot)
    this.catalogue ??= JSON.parse(readFileSync(join(this.packageRoot, 'data/ark-catalog.json'), 'utf8'))
    if (!Array.isArray(this.catalogue.entries) || !/^[a-f0-9]{40}$/.test(this.catalogue.revision)) throw new PetError('素材目录无效 / Invalid catalogue')
    this.catalogById = new Map(this.catalogue.entries.map(entry => [entry.id, entry]))
    this.loadEntry(join(this.packageRoot, 'assets/rookie'), true)
    for (const name of readdirSync(this.petsRoot)) {
      if (!ID.test(name)) continue
      const path = safePath(this.petsRoot, name)
      const info = lstatSync(path)
      if (!info.isDirectory() || info.isSymbolicLink()) continue
      try { this.loadEntry(path) } catch { /* Invalid local entries never become asset routes. */ }
    }
    try {
      const saved = JSON.parse(readRegular(join(this.root, 'config.json'), 16 * 1024).toString('utf8'))
      const { selectedId, revision, ...preferences } = saved
      this.config = {
        ...DEFAULT_CONFIG,
        ...validateConfig(preferences),
        selectedId: this.entries.has(selectedId) ? selectedId : 'rookie',
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return this
  }

  loadEntry(dir, builtin = false) {
    const raw = JSON.parse(readRegular(join(dir, 'pet.json'), 32 * 1024).toString('utf8'))
    if (!ID.test(raw.id) || (!builtin && basename(dir) !== raw.id)) throw new PetError('宠物标识无效 / Invalid pet identifier')
    const filename = raw.spritesheetPath ?? raw.imagePath
    if (!FILE.test(filename) || !/\.(png|webp|gif)$/i.test(filename)) throw new PetError('宠物图片路径无效 / Invalid pet image path')
    const bytes = readRegular(safePath(dir, filename), MAX_IMAGE_BYTES)
    const image = inspectImage(bytes, raw.kind === 'image' ? 'image' : 'atlas')
    if (image.spriteVersionNumber && raw.spriteVersionNumber !== image.spriteVersionNumber) throw new PetError('图集版本与图片不一致 / Atlas version does not match the image')
    const entry = {
      id: raw.id,
      displayName: label(raw.displayName, raw.id),
      ...image,
      filename,
      dir,
      builtin,
      sha256: imageSha256(bytes),
      origin: raw.origin === 'ark' ? 'ark' : builtin ? 'builtin' : 'custom',
      sourceId: raw.sourceId,
    }
    this.entries.set(entry.id, entry)
    return entry
  }

  view(entry) {
    const { dir, filename, ...value } = entry
    return {
      ...value,
      atlasUrl: `/ark-pet/assets/${entry.id}/${filename}?v=${entry.sha256}`,
      sourceUrl: entry.origin === 'ark' ? `https://github.com/${this.catalogue.repository}/tree/${this.catalogue.revision}/pets/${entry.sourceId}` : undefined,
    }
  }

  snapshot(activity = { phase: 'idle', tool: '', activeSessions: 0 }) {
    return {
      config: { ...this.config },
      entries: [...this.entries.values()].map(entry => this.view(entry)),
      selected: this.view(this.entries.get(this.config.selectedId) ?? this.entries.get('rookie')),
      activity,
    }
  }

  catalogView() {
    return {
      repository: this.catalogue.repository,
      revision: this.catalogue.revision,
      entries: this.catalogue.entries.map(entry => ({
        id: entry.id,
        displayName: entry.displayName,
        category: entry.category,
        bytes: entry.files.find(file => /\.(png|webp)$/.test(file.name)).bytes,
        installed: this.entries.has(`ark-${entry.id}`),
        sourceUrl: `https://github.com/${this.catalogue.repository}/tree/${this.catalogue.revision}/pets/${entry.id}`,
      })),
    }
  }

  transaction(operation) {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  async persist(next) {
    const path = join(this.root, 'config.json'), temp = safePath(this.root, `config-${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temp, path)
    this.config = next
  }

  configure(patch) {
    const preferences = validateConfig(patch)
    return this.transaction(async () => {
      await this.persist({ ...this.config, ...preferences, revision: this.config.revision + 1 })
      return this.snapshot()
    })
  }

  select(id) {
    if (typeof id !== 'string' || !this.entries.has(id)) throw new PetError('该宠物尚未安装 / Pet is not installed', 404)
    return this.transaction(async () => {
      await this.persist({ ...this.config, selectedId: id, revision: this.config.revision + 1 })
      return this.snapshot()
    })
  }

  resetPosition() { return this.configure({ position: null, pin: 'bottom-right' }) }

  async installFiles(id, displayName, bytes, image, notices = {}, extra = {}) {
    if (!ID.test(id)) throw new PetError('宠物标识无效 / Invalid pet identifier')
    return this.transaction(async () => {
      if (this.entries.has(id)) return this.entries.get(id)
      const destination = safePath(this.petsRoot, id), staging = safePath(this.petsRoot, `stage-${randomUUID()}`)
      try { lstatSync(destination); throw new PetError('目录已存在，不会覆盖 / Directory exists and will not be overwritten', 409) } catch (error) { if (error.code !== 'ENOENT') throw error }
      mkdirSync(staging, { mode: 0o700 })
      try {
        const filename = `${image.kind === 'atlas' ? 'spritesheet' : 'image'}.${image.format}`
        const manifest = { id, displayName, kind: image.kind, spritesheetPath: filename, spriteVersionNumber: image.spriteVersionNumber, ...extra }
        writeFileSync(safePath(staging, filename), bytes, { flag: 'wx', mode: 0o600 })
        writeFileSync(safePath(staging, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        for (const [name, contents] of Object.entries(notices)) writeFileSync(safePath(staging, name), contents, { flag: 'wx', mode: 0o600 })
        // The staging path is a validated child of the private pets directory.
        await rename(staging, destination)
        return this.loadEntry(destination)
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    })
  }

  async importImage(bytes, displayName, mode = 'auto') {
    const image = inspectImage(bytes, mode)
    const entry = await this.installFiles(`custom-${randomUUID()}`, label(displayName, '我的桌宠 / My pet'), bytes, image)
    await this.select(entry.id)
    return this.snapshot()
  }

  async fetchFile(id, file) {
    const cap = /\.(png|webp)$/.test(file.name) ? MAX_IMAGE_BYTES : 64 * 1024
    if (!FILE.test(file.name) || !/^[a-f0-9]{40}$/.test(file.sha1) || !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > cap) throw new PetError('素材目录记录无效 / Invalid catalogue record')
    const url = `https://raw.githubusercontent.com/${this.catalogue.repository}/${this.catalogue.revision}/pets/${id}/${file.name}`
    const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]) })
    if (!response.ok) throw new PetError(`上游下载失败 / Upstream download failed: HTTP ${response.status}`, 502)
    if (Number(response.headers.get('content-length')) > cap) throw new PetError('上游文件过大 / Upstream file is too large', 502)
    const reader = response.body.getReader(), chunks = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > cap) throw new PetError('上游文件过大 / Upstream file is too large', 502)
        chunks.push(Buffer.from(value))
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    if (bytes.length !== file.bytes || gitBlobSha1(bytes) !== file.sha1) throw new PetError('上游文件校验失败 / Upstream integrity check failed', 502)
    return bytes
  }

  download(id, accepted) {
    if (accepted !== true) throw new PetError('请先确认素材权利限制 / Confirm the artwork rights notice first')
    const source = this.catalogById.get(id)
    if (!source) throw new PetError('素材库没有该干员 / Operator is not in the catalogue', 404)
    if (this.downloads.has(id)) return this.downloads.get(id)
    const task = (async () => {
      const installed = this.entries.get(`ark-${id}`)
      if (installed) { await this.select(installed.id); return this.snapshot() }
      const files = Object.fromEntries(await Promise.all(source.files.map(async file => [file.name, await this.fetchFile(id, file)])))
      const manifest = JSON.parse(files['pet.json'].toString('utf8'))
      const filename = manifest.spritesheetPath
      if (manifest.id !== id || !['spritesheet.webp', 'spritesheet.png'].includes(filename) || !files[filename]) throw new PetError('上游清单与目录不一致 / Upstream manifest does not match the catalogue', 502)
      const image = inspectImage(files[filename], 'atlas')
      if (image.spriteVersionNumber !== 2 || manifest.spriteVersionNumber !== 2) throw new PetError('干员素材必须为 v2 图集 / Operator artwork must use a v2 atlas', 502)
      const notices = { 'SOURCE.md': files['SOURCE.md'], 'UPSTREAM-pet.json': files['pet.json'] }
      if (files['provenance.json']) notices['provenance.json'] = files['provenance.json']
      const entry = await this.installFiles(`ark-${id}`, source.displayName, files[filename], image, notices, { origin: 'ark', sourceId: id, sourceRevision: this.catalogue.revision })
      await this.select(entry.id)
      return this.snapshot()
    })()
    this.downloads.set(id, task)
    task.finally(() => this.downloads.delete(id)).catch(() => {})
    return task
  }

  async asset(id, filename) {
    const entry = this.entries.get(id)
    if (!entry || filename !== entry.filename) throw new PetError('没有该资源 / Asset not found', 404)
    const directory = lstatSync(entry.dir)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new PetError('资源目录无效 / Invalid asset directory', 404)
    const bytes = readRegular(safePath(entry.dir, filename), MAX_IMAGE_BYTES)
    return { bytes, mime: entry.mime, sha256: imageSha256(bytes) }
  }

  dispose() { this.abort.abort() }
}
