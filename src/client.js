/* Browser half of dsh-ark-pet. One overlay pet plus one settings page.
 * The host exposes /ark-pet/api/* and /ark-pet/assets/<id>/<file>; this half only
 * renders what the host reports, so adding a pet never touches this file.
 * Wrapped for the DSH module loader: no top-level binding leaks into the page. */
import { createPet } from './renderer.js'

const POLL_MS = 2000
const PINS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']
const MARGIN = 16

function read(response) {
  return response.text().then(text => {
    let value = null
    try { value = text ? JSON.parse(text) : null } catch { value = null }
    if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`)
    return value
  })
}

function get(path) {
  return fetch(path, { credentials: 'same-origin' }).then(read)
}

function post(path, body, contentType) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-dsh-ark-pet': '1', ...(contentType ? { 'content-type': contentType } : {}) },
    body,
  }).then(read)
}

function bubbleText(activity) {
  if (!activity || !activity.phase) return ''
  let text = ''
  if (activity.phase === 'thinking') text = '思考中…'
  else if (activity.phase === 'working') text = activity.tool ? `运行中：${activity.tool}…` : '工作中…'
  else if (activity.phase === 'waiting') text = '等待你的确认…'
  else if (activity.phase === 'done') text = '完成'
  else if (activity.phase === 'failed') text = '出错了'
  if (!text) return ''
  return activity.activeSessions > 1 ? `${text} (+${activity.activeSessions - 1})` : text
}

window.__ModuleLoader__.load({
  id: 'dsh-ark-pet',
  factory: require => {
    const react = require('react')
    let createPortal = null
    try { createPortal = require('react-dom').createPortal } catch { createPortal = null }

    const section = { display: 'grid', gap: '10px', maxWidth: '520px', fontSize: '13px' }
    const row = { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }
    const rowLabel = { minWidth: '130px', color: 'var(--dsw-alias-label-secondary)' }
    const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', margin: 0 }
    const control = { padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' }
    const button = { padding: '7px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: '6px', maxHeight: '260px', overflowY: 'auto' }
    const error = { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', margin: 0 }

    function Field({ label, children }) {
      return react.createElement('label', { style: row },
        react.createElement('span', { style: rowLabel }, label),
        children)
    }

    function Toggle({ label, checked, onChange }) {
      return react.createElement('label', { style: { ...row, cursor: 'pointer' } },
        react.createElement('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }),
        react.createElement('span', null, label))
    }

    function PetOverlay() {
      const hostRef = react.useRef(null)
      const petRef = react.useRef(null)
      const boxRef = react.useRef(null)
      const [state, setState] = react.useState(null)
      const [box, setBox] = react.useState(null)
      const [problem, setProblem] = react.useState('')

      react.useEffect(() => {
        let stopped = false
        const load = async () => {
          try {
            const next = await get('/ark-pet/api/state')
            if (!stopped) { setState(next); setProblem('') }
          } catch (failure) {
            if (!stopped) setProblem(String(failure.message || failure))
          }
        }
        load()
        const timer = window.setInterval(() => { if (!document.hidden) load() }, POLL_MS)
        return () => { stopped = true; window.clearInterval(timer) }
      }, [])

      const selected = state?.selected
      const config = state?.config
      const phase = state?.activity?.phase || 'idle'

      react.useEffect(() => {
        if (!selected || !config || config.visible === false || !hostRef.current) return undefined
        const pet = createPet(hostRef.current, {
          kind: selected.kind,
          width: selected.width,
          height: selected.height,
          spriteVersionNumber: selected.spriteVersionNumber,
          src: selected.atlasUrl,
          size: config.size,
          pin: config.pin,
          position: config.position,
          displayName: selected.displayName,
          onPosition: value => { boxRef.current = value; setBox(value) },
          onDragEnd: value => { post('/ark-pet/api/config', JSON.stringify({ position: value })).catch(() => {}) },
        })
        petRef.current = pet
        return () => { petRef.current = null; pet.dispose() }
      }, [selected?.id, selected?.atlasUrl, config?.visible])

      react.useEffect(() => {
        if (!petRef.current || !config) return
        petRef.current.updatePlacement({ size: config.size, pin: config.pin, position: config.position })
      }, [config?.size, config?.pin])

      react.useEffect(() => {
        if (!petRef.current) return
        petRef.current.setAnimation(phase)
      }, [phase, selected?.id])

      react.useEffect(() => {
        if (!config?.mouseTracking || selected?.spriteVersionNumber !== 2) return undefined
        const onMove = event => {
          const pet = petRef.current
          if (!pet || pet.dragging) return
          const rect = pet.element.getBoundingClientRect()
          pet.setLook({ x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) })
        }
        window.addEventListener('pointermove', onMove, { passive: true })
        return () => window.removeEventListener('pointermove', onMove)
      }, [config?.mouseTracking, selected?.spriteVersionNumber, selected?.atlasUrl])

      if (!config || !selected) return null
      const text = config.bubble === false ? '' : bubbleText(state.activity)
      const children = []
      if (text && box) {
        children.push(react.createElement('div', {
          key: 'bubble',
          className: 'ark-pet-bubble',
          style: {
            position: 'absolute',
            left: `${Math.min(Math.max(box.x + box.width / 2, MARGIN + 80), (hostRef.current?.clientWidth || window.innerWidth) - MARGIN - 80)}px`,
            top: `${Math.max(MARGIN, box.y - 34)}px`,
            transform: 'translateX(-50%)',
            maxWidth: '260px',
            padding: '6px 10px',
            borderRadius: '10px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-overlay)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: '12px',
            lineHeight: 1.35,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
          },
        }, text))
      }
      if (problem) children.push(react.createElement('div', { key: 'error', className: 'ark-pet-error', style: { ...error, position: 'absolute', right: '12px', bottom: '12px' } }, problem))
      const host = react.createElement('div', {
        ref: hostRef,
        className: 'ark-pet-host',
        'data-dsh-ark-pet': 'overlay',
        style: { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 2147483000 },
      }, children)
      return createPortal ? createPortal(host, document.body) : host
    }

    function PetSettings() {
      const [state, setState] = react.useState(null)
      const [catalog, setCatalog] = react.useState(null)
      const [query, setQuery] = react.useState('')
      const [accepted, setAccepted] = react.useState(false)
      const [name, setName] = react.useState('')
      const [mode, setMode] = react.useState('auto')
      const [busy, setBusy] = react.useState('')
      const [message, setMessage] = react.useState('')
      const fileRef = react.useRef(null)

      react.useEffect(() => {
        get('/ark-pet/api/state').then(setState).catch(failure => setMessage(String(failure.message || failure)))
        get('/ark-pet/api/catalog').then(setCatalog).catch(failure => setMessage(String(failure.message || failure)))
      }, [])

      const configure = patch => {
        post('/ark-pet/api/config', JSON.stringify(patch))
          .then(next => { setState(next); setMessage('') })
          .catch(failure => setMessage(String(failure.message || failure)))
      }
      const run = (key, operation) => {
        setBusy(key)
        operation()
          .then(next => { setState(next); setMessage('') })
          .catch(failure => setMessage(String(failure.message || failure)))
          .finally(() => setBusy(''))
      }

      if (!state) return react.createElement('div', { className: 'ark-pet-section', style: section }, message || '正在载入… / Loading…')
      const needle = query.trim().toLowerCase()
      const filtered = (catalog?.entries ?? []).filter(entry => !needle || entry.displayName.toLowerCase().includes(needle) || entry.id.includes(needle)).slice(0, 120)

      return react.createElement('div', { className: 'ark-pet-section', style: section },
        react.createElement('p', { style: hint },
          `素材库固定版本 ${catalog?.revision?.slice(0, 12) ?? '…'}，共 ${catalog?.entries?.length ?? 0} 位干员。下载时直接读取上游文件并逐个校验 Git 哈希。`),
        react.createElement(Field, { label: '当前宠物 / Current' },
          react.createElement('select', {
            style: control,
            value: state.config.selectedId,
            onChange: event => run('select', () => post('/ark-pet/api/select', JSON.stringify({ id: event.target.value }))),
          }, state.entries.map(entry => react.createElement('option', { key: entry.id, value: entry.id }, `${entry.displayName}（${entry.origin}）`)))),
        react.createElement(Field, { label: '尺寸 / Size' },
          react.createElement('input', {
            type: 'range', min: 48, max: 384, step: 8, value: state.config.size,
            onChange: event => configure({ size: Number(event.target.value) }),
          })),
        react.createElement(Field, { label: '停靠 / Dock' },
          react.createElement('select', {
            style: control, value: state.config.pin,
            onChange: event => configure({ pin: event.target.value }),
          }, PINS.map(pin => react.createElement('option', { key: pin, value: pin }, pin)))),
        react.createElement(Toggle, { label: '显示桌宠 / Show pet', checked: state.config.visible, onChange: value => configure({ visible: value }) }),
        react.createElement(Toggle, { label: '鼠标视线跟随 / Eye tracking（仅 v2 图集）', checked: state.config.mouseTracking, onChange: value => configure({ mouseTracking: value }) }),
        react.createElement(Toggle, { label: '状态气泡 / Status bubble', checked: state.config.bubble, onChange: value => configure({ bubble: value }) }),
        react.createElement('button', { type: 'button', style: { ...button, justifySelf: 'start' }, onClick: () => run('reset', () => post('/ark-pet/api/reset-position', '{}')) }, '恢复默认位置 / Reset position'),

        react.createElement('h4', { style: { margin: '6px 0 0' } }, '导入自己的图片 / Import your own image'),
        react.createElement('p', { style: hint }, 'Codex 图集必须正好 1536×1872（v1）或 1536×2288（v2）。普通 PNG / WebP / GIF 按原图显示，单张不超过 8 MiB，PNG 与 GIF 不能是动画。'),
        react.createElement(Field, { label: '名称 / Name' },
          react.createElement('input', { style: control, type: 'text', value: name, maxLength: 80, placeholder: '我的桌宠', onChange: event => setName(event.target.value) })),
        react.createElement(Field, { label: '类型 / Mode' },
          react.createElement('select', { style: control, value: mode, onChange: event => setMode(event.target.value) },
            react.createElement('option', { value: 'auto' }, '自动判断 / Auto'),
            react.createElement('option', { value: 'atlas' }, 'Codex 图集 / Atlas'),
            react.createElement('option', { value: 'image' }, '普通图片 / Plain image'))),
        react.createElement(Field, { label: '文件 / File' },
          react.createElement('input', { type: 'file', accept: 'image/png,image/webp,image/gif', ref: fileRef })),
        react.createElement('button', {
          type: 'button',
          style: { ...button, justifySelf: 'start' },
          disabled: busy === 'import',
          onClick: () => {
            const file = fileRef.current?.files?.[0]
            if (!file) { setMessage('先选择一个图片文件 / Choose an image file first'); return }
            run('import', () => post(`/ark-pet/api/import?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(name)}`, file, file.type || 'application/octet-stream'))
          },
        }, busy === 'import' ? '导入中… / Importing…' : '导入 / Import'),

        react.createElement('h4', { style: { margin: '6px 0 0' } }, '干员素材库 / Operator library'),
        react.createElement('p', { style: hint }, '素材不随插件分发。选中干员后从上游仓库按固定版本下载，保留来源文件，并校验哈希。'),
        react.createElement('label', { style: { ...row, cursor: 'pointer' } },
          react.createElement('input', { type: 'checkbox', checked: accepted, onChange: event => setAccepted(event.target.checked) }),
          react.createElement('span', null, '我了解：明日方舟美术权利属于鹰角网络及相关权利人，上游不授予再分发或商业使用权，公开链接与下载确认都不产生授权。')),
        react.createElement(Field, { label: '搜索 / Search' },
          react.createElement('input', { style: control, type: 'search', value: query, placeholder: '阿米娅 / Amiya', onChange: event => setQuery(event.target.value) })),
        react.createElement('div', { style: grid }, filtered.map(entry => react.createElement('button', {
          key: entry.id,
          type: 'button',
          style: { ...button, opacity: accepted ? 1 : 0.5, cursor: accepted && !entry.installed ? 'pointer' : 'default' },
          disabled: !accepted || entry.installed || busy === entry.id,
          title: entry.installed ? '已安装 / Installed' : `${Math.round(entry.bytes / 1024)} KiB · ${entry.sourceUrl}`,
          onClick: () => run(entry.id, () => post('/ark-pet/api/download', JSON.stringify({ id: entry.id, acceptRights: true }))),
        }, `${entry.displayName}${entry.installed ? ' ✓' : ''}`))),

        message ? react.createElement('p', { style: error }, message) : null)
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-ark-pet',
        order: 100,
        label: 'Ark Pet',
      }, () => react.createElement(PetOverlay)))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'ark-pet',
        order: 130,
        label: '方舟桌宠',
      }, () => react.createElement(PetSettings)))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = inject
    module.exports.__internals = { bubbleText, PetOverlay, PetSettings }
    return module.exports
  },
})
