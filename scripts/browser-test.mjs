/* Real-browser verification of the built client half. Chrome is driven through
 * Playwright; nothing is installed into a DSH profile. Run: npm run test:browser */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
await build({ absWorkingDir: root, entryPoints: ['src/client.js'], outfile: 'lib/client.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'warning' })

const REACT = readFileSync(new URL('../node_modules/react/umd/react.development.js', import.meta.url), 'utf8')
const REACT_DOM = readFileSync(new URL('../node_modules/react-dom/umd/react-dom.development.js', import.meta.url), 'utf8')
const CLIENT = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const atlasUrl = '/ark-pet/assets/test/spritesheet.webp?v=abc'
const pet = { id: 'test', displayName: '测试宠物', kind: 'atlas', width: 1536, height: 2288, spriteVersionNumber: 2, atlasUrl, origin: 'ark', mime: 'image/webp', frames: 1 }
const state = {
  config: { selectedId: 'test', visible: true, size: 144, pin: 'bottom-right', position: null, mouseTracking: true, bubble: true, revision: 1 },
  entries: [pet],
  selected: pet,
  activity: { phase: 'waiting', tool: '', activeSessions: 1 },
}
const catalog = {
  repository: 'lockon-n/Arknights-Codex-Pets',
  revision: '3f845e606c53f57f4c64f96c205e10f728cc7d8e',
  entries: [{ id: 'amiya', displayName: '阿米娅', category: 'default', bytes: 900000, installed: false, sourceUrl: 'https://github.com/lockon-n/Arknights-Codex-Pets' }],
}

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))
  await page.addInitScript(({ state, catalog }) => {
    window.__calls = []
    window.__modules = {}
    const requireModule = name => (name === 'react' ? window.React : name === 'react-dom' ? window.ReactDOM : undefined)
    window.__ModuleLoader__ = { load: ({ id, factory }) => { window.__modules[id] = factory(requireModule) } }
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
    window.fetch = async (url, init = {}) => {
      const target = String(url)
      window.__calls.push({ url: target, method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' ? init.body : null })
      if (target.startsWith('/ark-pet/api/catalog')) return json(catalog)
      return json(state)
    }
  }, { state, catalog })
  await page.goto('about:blank')
  await page.addScriptTag({ content: REACT })
  await page.addScriptTag({ content: REACT_DOM })
  await page.addScriptTag({ content: CLIENT })
  await page.evaluate(() => {
    const module = window.__modules['dsh-ark-pet']
    const registrations = []
    const ctx = { slots: { inject: (key, callback) => callback(), register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} } } }
    module.apply(ctx)
    window.__registrations = registrations
  })

  const registered = await page.evaluate(() => window.__registrations.map(entry => entry.declaration))
  check('registers the overlay and settings slots', registered.length === 2 && registered[0].name === 'shell.overlay' && registered[1].name === 'settings.section', JSON.stringify(registered))

  await page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'root'
    document.body.appendChild(host)
    ReactDOM.createRoot(host).render(React.createElement(window.__registrations[0].component))
  })
  await page.waitForSelector('.ark-pet-host', { timeout: 4000 })
  await page.waitForSelector('.ark-pet-bubble', { timeout: 4000 })

  const overlay = await page.evaluate(() => {
    const host = document.querySelector('.ark-pet-host')
    const sprite = document.querySelector('.ark-pet-sprite')
    const bubble = document.querySelector('.ark-pet-bubble')
    const box = sprite.getBoundingClientRect()
    return {
      hostStyle: { position: host.style.position, pointerEvents: host.style.pointerEvents, zIndex: host.style.zIndex },
      onBody: host.parentElement === document.body,
      background: sprite.style.backgroundImage,
      spritePointerEvents: sprite.style.pointerEvents,
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
      bubble: bubble ? bubble.textContent : null,
    }
  })
  check('overlay mounts on document.body as a click-through layer', overlay.onBody && overlay.hostStyle.position === 'fixed' && overlay.hostStyle.pointerEvents === 'none', JSON.stringify(overlay.hostStyle))
  check('atlas renders at the configured size', overlay.background.includes(atlasUrl) && Math.round(overlay.box.width) === 144 && Math.round(overlay.box.height) === 156, JSON.stringify(overlay.box))
  check('waiting phase shows the approval bubble', overlay.bubble === '等待你的确认…', String(overlay.bubble))
  check('pet starts docked at the bottom right', Math.round(overlay.box.left + overlay.box.width) === 884, `left=${overlay.box.left}`)

  const first = await page.evaluate(() => document.querySelector('.ark-pet-sprite').style.backgroundPosition)
  await page.waitForTimeout(600)
  const second = await page.evaluate(() => document.querySelector('.ark-pet-sprite').style.backgroundPosition)
  check('idle animation advances frames', first !== second, `${first} → ${second}`)

  await page.mouse.move(120, 120)
  const look = await page.evaluate(() => document.querySelector('.ark-pet-sprite').style.backgroundPosition)
  check('v2 eye tracking selects a look cell', /-1404px|-1560px|-1248px|-1092px/.test(look), look)

  const box = await page.evaluate(() => {
    const rect = document.querySelector('.ark-pet-sprite').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left }
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x - 40, box.y + 30, { steps: 4 })
  await page.mouse.move(box.x - 120, box.y + 60, { steps: 4 })
  await page.mouse.up()
  const dragged = await page.evaluate(() => ({
    left: document.querySelector('.ark-pet-sprite').getBoundingClientRect().left,
    calls: window.__calls.filter(call => call.method === 'POST' && call.url === '/ark-pet/api/config'),
  }))
  check('dragging moves the pet and persists the position', dragged.left < box.left && dragged.calls.length > 0 && /position/.test(dragged.calls.at(-1).body), `left ${box.left} → ${dragged.left}, posts=${dragged.calls.length}`)

  await page.evaluate(() => {
    document.getElementById('root').remove()
    const host = document.createElement('div')
    host.id = 'settings'
    document.body.appendChild(host)
    ReactDOM.createRoot(host).render(React.createElement(window.__registrations[1].component))
  })
  await page.waitForSelector('.ark-pet-section', { timeout: 4000 })
  const settings = await page.evaluate(() => ({
    heading: document.querySelector('.ark-pet-section h3')?.textContent,
    labels: [...document.querySelectorAll('.ark-pet-section button')].map(button => button.textContent),
    info: document.querySelector('.ark-pet-section p')?.textContent,
    disabled: [...document.querySelectorAll('.ark-pet-section button')].map(button => button.disabled),
  }))
  check('settings page names the pinned catalogue revision', String(settings.info).includes('3f845e606c53') && String(settings.info).includes('共 1 位干员'), String(settings.info))
  check('operator download waits for the rights confirmation', settings.labels.includes('阿米娅') && settings.disabled.at(-1) === true, JSON.stringify(settings.labels))

  await page.evaluate(() => [...document.querySelectorAll('.ark-pet-section input[type=checkbox]')].at(-1).click())
  await page.waitForFunction(() => [...document.querySelectorAll('.ark-pet-section button')].at(-1)?.disabled === false, null, { timeout: 4000 })
  await page.evaluate(() => [...document.querySelectorAll('.ark-pet-section button')].at(-1).click())
  await page.waitForFunction(() => window.__calls.some(call => call.url === '/ark-pet/api/download'), null, { timeout: 4000 })
  const download = await page.evaluate(() => window.__calls.find(call => call.url === '/ark-pet/api/download'))
  check('confirmed download posts the operator id and consent', /"id":"amiya"/.test(download.body) && /"acceptRights":true/.test(download.body) && download.headers['x-dsh-ark-pet'] === '1', JSON.stringify(download))

  check('client half raises no page error', pageErrors.length === 0, pageErrors.join(' | '))
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\n${failures.length} browser check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nAll browser checks passed')
}
