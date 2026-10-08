export class ActivityTracker {
  constructor(now = Date.now) {
    this.now = now
    this.sessions = new Map()
  }

  update(id, patch) {
    if (typeof id !== 'string' || !id) return
    const previous = this.sessions.get(id) ?? { phase: 'idle', tool: '', updatedAt: 0, pending: 0 }
    this.sessions.set(id, { ...previous, ...patch, updatedAt: this.now() })
    if (this.sessions.size > 128) {
      const oldest = [...this.sessions].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
      this.sessions.delete(oldest[0])
    }
  }

  event(session, event) {
    if (session.header?.origin === 'subagent') return
    const id = session.id, data = event.data ?? {}
    switch (event.type) {
      case 'turn/start': case 'step/start': this.update(id, { phase: 'thinking', tool: '', pending: 0 }); break
      case 'tool/call': this.update(id, { phase: 'working', tool: String(data.name ?? '').slice(0, 80) }); break
      case 'tool/result': this.update(id, { phase: 'thinking', tool: '' }); break
      case 'turn/end': {
        const reason = data.reason?.kind
        const phase = reason === 'completed' ? 'done' : reason === 'error' || reason === 'max-tokens' ? 'failed' : reason === 'blocked' ? 'waiting' : 'idle'
        this.update(id, { phase, tool: '', pending: 0 })
        break
      }
    }
  }

  wait(id) {
    const previous = this.sessions.get(id) ?? { phase: 'thinking', pending: 0 }
    this.update(id, { phase: 'waiting', pending: previous.pending + 1 })
    return () => {
      const current = this.sessions.get(id)
      if (!current || !current.pending) return
      const pending = Math.max(0, current.pending - 1)
      this.update(id, { pending, phase: pending ? 'waiting' : 'thinking' })
    }
  }

  status(id, status) {
    const current = this.sessions.get(id)
    if (status === 'running' && (!current || ['idle', 'done', 'failed'].includes(current.phase))) this.update(id, { phase: 'thinking' })
    if (status === 'idle' && current && ['thinking', 'working'].includes(current.phase)) this.update(id, { phase: 'idle', tool: '', pending: 0 })
  }

  remove(id) { this.sessions.delete(id) }

  snapshot() {
    const now = this.now()
    const items = [...this.sessions.values()].map(item => ({ ...item, phase: ['done', 'failed'].includes(item.phase) && now - item.updatedAt > 6000 ? 'idle' : item.pending ? 'waiting' : item.phase }))
    const priority = { waiting: 5, working: 4, thinking: 3, failed: 2, done: 1, idle: 0 }
    items.sort((a, b) => priority[b.phase] - priority[a.phase] || b.updatedAt - a.updatedAt)
    const selected = items[0] ?? { phase: 'idle', tool: '' }
    return { phase: selected.phase, tool: selected.tool, activeSessions: items.filter(item => ['waiting', 'thinking', 'working'].includes(item.phase)).length }
  }
}
