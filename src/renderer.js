/* Adapted from Signalight/codex-to-dsh-pet, d41f0121552f837c36a9cc7fbcb073881f391616.
 * Copyright (c) 2026 Signalight. MIT. See licenses/Signalight-MIT.txt.
 * Changes: image pets, viewport clamping, reduced motion, and bounded animation ticks.
 */
export const ANIMATIONS = Object.freeze({
  idle: { row: 0, frames: 6, frameInterval: 160 },
  runningRight: { row: 1, frames: 8, frameInterval: 120 },
  runningLeft: { row: 2, frames: 8, frameInterval: 120 },
  waving: { row: 3, frames: 4, frameInterval: 140 },
  jumping: { row: 4, frames: 5, frameInterval: 140 },
  failed: { row: 5, frames: 8, frameInterval: 140 },
  waiting: { row: 6, frames: 6, frameInterval: 150 },
  running: { row: 7, frames: 6, frameInterval: 120 },
  review: { row: 8, frames: 6, frameInterval: 150 },
})
const ALIASES = { 'running-right': 'runningRight', 'running-left': 'runningLeft', thinking: 'review', working: 'running', done: 'jumping' }

export function resolveLook(direction, deadzone = 0) {
  if (direction == null) return undefined
  let degrees
  if (typeof direction === 'number') degrees = direction
  else {
    if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return undefined
    const magnitude = Math.hypot(direction.x, direction.y)
    if (magnitude === 0 || magnitude <= Math.max(0, deadzone)) return undefined
    degrees = Math.atan2(direction.x, -direction.y) * 180 / Math.PI
  }
  if (!Number.isFinite(degrees)) return undefined
  const normalized = ((degrees % 360) + 360) % 360
  return Math.round(normalized / 22.5) % 16
}

export function pinPlacement(pin, pw, ph, w, h, margin = 16) {
  let x, y
  switch (pin) {
    case 'top-left': x = margin; y = margin; break
    case 'top': x = (pw - w) / 2; y = margin; break
    case 'top-right': x = pw - w - margin; y = margin; break
    case 'left': x = margin; y = (ph - h) / 2; break
    case 'center': x = (pw - w) / 2; y = (ph - h) / 2; break
    case 'right': x = pw - w - margin; y = (ph - h) / 2; break
    case 'bottom-left': x = margin; y = ph - h - margin; break
    case 'bottom': x = (pw - w) / 2; y = ph - h - margin; break
    default: x = pw - w - margin; y = ph - h - margin
  }
  return clampPosition({ x, y }, pw, ph, w, h)
}

export function clampPosition(position, pw, ph, width, height) {
  return { x: Math.max(0, Math.min(position.x, Math.max(0, pw - width))), y: Math.max(0, Math.min(position.y, Math.max(0, ph - height))) }
}

export function createPet(container, options) {
  const isAtlas = options.kind === 'atlas', columns = isAtlas ? 8 : 1, rows = isAtlas ? options.spriteVersionNumber === 2 ? 11 : 9 : 1
  const frameWidth = isAtlas ? 192 : options.width, frameHeight = isAtlas ? 208 : options.height
  let scale = options.size / frameWidth
  const sprite = document.createElement('div')
  sprite.className = `ark-pet-sprite${isAtlas ? '' : ' ark-pet-image'}`
  sprite.setAttribute('role', 'img')
  sprite.setAttribute('aria-label', options.displayName)
  sprite.style.backgroundImage = `url("${options.src}")`
  sprite.style.position = 'absolute'
  sprite.style.backgroundRepeat = 'no-repeat'
  sprite.style.touchAction = 'none'
  sprite.style.pointerEvents = 'auto'
  sprite.style.cursor = 'grab'
  sprite.style.userSelect = 'none'
  container.appendChild(sprite)
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let animationName = 'idle', current = ANIMATIONS.idle, frame = 0, elapsed = 0, lookIndex, once = false, then = 'idle'
  let raf = 0, previous = 0, disposed = false, dragging = false, restore = 'idle', lastX = 0, offset = { x: 0, y: 0 }, position

  function paint() {
    const row = !isAtlas ? 0 : lookIndex !== undefined ? 9 + Math.floor(lookIndex / 8) : current.row
    const col = !isAtlas ? 0 : lookIndex !== undefined ? lookIndex % 8 : frame % current.frames
    sprite.style.width = `${frameWidth * scale}px`
    sprite.style.height = `${frameHeight * scale}px`
    sprite.style.backgroundSize = `${frameWidth * columns * scale}px ${frameHeight * rows * scale}px`
    sprite.style.backgroundPosition = `${-col * frameWidth * scale}px ${-row * frameHeight * scale}px`
    sprite.dataset.animation = animationName
  }

  function place() {
    const w = frameWidth * scale, h = frameHeight * scale
    const pw = container.clientWidth || window.innerWidth, ph = container.clientHeight || window.innerHeight
    position = options.position ? clampPosition(options.position, pw, ph, w, h) : pinPlacement(options.pin, pw, ph, w, h)
    sprite.style.left = `${position.x}px`
    sprite.style.top = `${position.y}px`
    options.onPosition?.({ ...position, width: w, height: h })
  }

  function animate(name, settings = {}) {
    animationName = ALIASES[name] ?? name
    current = ANIMATIONS[animationName] ?? ANIMATIONS.idle
    frame = 0
    elapsed = 0
    once = settings.once === true
    then = settings.then ?? 'idle'
    lookIndex = undefined
    paint()
  }

  function tick(time) {
    if (disposed) return
    const dt = previous ? Math.min(250, Math.max(0, time - previous)) : 0
    previous = time
    if (isAtlas && !motion?.matches && (lookIndex === undefined || once)) {
      elapsed += dt
      while (elapsed >= current.frameInterval) {
        elapsed -= current.frameInterval
        frame++
        if (frame >= current.frames) {
          if (once) animate(then)
          else frame = 0
        }
      }
      paint()
    }
    raf = requestAnimationFrame(tick)
  }

  sprite.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const box = sprite.getBoundingClientRect()
    offset = { x: event.clientX - box.left, y: event.clientY - box.top }
    dragging = true
    restore = animationName
    lastX = event.clientX
    lookIndex = undefined
    sprite.setPointerCapture?.(event.pointerId)
    sprite.style.cursor = 'grabbing'
    event.preventDefault()
  })
  sprite.addEventListener('pointermove', event => {
    if (!dragging) return
    const delta = event.clientX - lastX
    lastX = event.clientX
    if (isAtlas && Math.abs(delta) > 4) {
      const next = delta > 0 ? 'runningRight' : 'runningLeft'
      if (next !== animationName) animate(next)
    }
    const box = container.getBoundingClientRect()
    position = clampPosition({ x: event.clientX - box.left - offset.x, y: event.clientY - box.top - offset.y }, box.width, box.height, frameWidth * scale, frameHeight * scale)
    sprite.style.left = `${position.x}px`
    sprite.style.top = `${position.y}px`
    options.onPosition?.({ ...position, width: frameWidth * scale, height: frameHeight * scale })
  })
  const release = event => {
    if (!dragging) return
    dragging = false
    sprite.style.cursor = 'grab'
    if (sprite.hasPointerCapture?.(event.pointerId)) sprite.releasePointerCapture(event.pointerId)
    if (isAtlas) animate(restore)
    options.position = position
    options.onDragEnd?.({ ...position })
  }
  sprite.addEventListener('pointerup', release)
  sprite.addEventListener('pointercancel', release)
  sprite.addEventListener('pointerenter', () => { if (isAtlas && !dragging && animationName === 'idle') animate('waving', { once: true, then: 'idle' }) })
  sprite.addEventListener('dblclick', () => {
    if (dragging) return
    if (isAtlas) animate('jumping', { once: true, then: animationName === 'waving' ? 'idle' : animationName })
    else if (!motion?.matches) sprite.animate?.([{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }], { duration: 420 })
  })
  const onResize = () => { if (!dragging) place() }
  const onMotion = () => { frame = 0; paint() }
  window.addEventListener('resize', onResize)
  motion?.addEventListener?.('change', onMotion)
  place()
  paint()
  if (isAtlas) raf = requestAnimationFrame(tick)

  return {
    element: sprite,
    get dragging() { return dragging },
    get animation() { return animationName },
    setAnimation(name) { if (!dragging) animate(name) },
    setLook(direction, deadzone = 28) {
      if (options.spriteVersionNumber !== 2 || !isAtlas || dragging || once || motion?.matches) return
      lookIndex = resolveLook(direction, deadzone)
      paint()
    },
    clearLook() { if (lookIndex !== undefined) { lookIndex = undefined; paint() } },
    updatePlacement(settings) { Object.assign(options, settings); scale = options.size / frameWidth; if (!dragging) { paint(); place() } },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      motion?.removeEventListener?.('change', onMotion)
      sprite.remove()
    },
  }
}
