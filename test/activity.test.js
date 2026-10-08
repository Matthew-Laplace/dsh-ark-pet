import test from 'node:test'
import assert from 'node:assert/strict'
import { ActivityTracker } from '../src/activity.js'

function session(id, origin = 'user') {
  return { id, header: { origin } }
}

test('maps session events to phases', () => {
  const tracker = new ActivityTracker(() => 1000)
  tracker.event(session('a'), { type: 'turn/start', data: {} })
  assert.equal(tracker.snapshot().phase, 'thinking')
  tracker.event(session('a'), { type: 'tool/call', data: { name: 'Bash' } })
  assert.deepEqual({ phase: tracker.snapshot().phase, tool: tracker.snapshot().tool }, { phase: 'working', tool: 'Bash' })
  tracker.event(session('a'), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(tracker.snapshot().phase, 'done')
  tracker.event(session('a'), { type: 'turn/end', data: { reason: { kind: 'error' } } })
  assert.equal(tracker.snapshot().phase, 'failed')
})

test('ignores subagent sessions', () => {
  const tracker = new ActivityTracker(() => 1000)
  tracker.event(session('child', 'subagent'), { type: 'turn/start', data: {} })
  assert.equal(tracker.snapshot().phase, 'idle')
})

test('raises waiting while a question is pending', () => {
  const tracker = new ActivityTracker(() => 1000)
  tracker.event(session('a'), { type: 'turn/start', data: {} })
  const resume = tracker.wait('a')
  assert.equal(tracker.snapshot().phase, 'waiting')
  resume()
  assert.equal(tracker.snapshot().phase, 'thinking')
})

test('keeps the highest priority session and counts active ones', () => {
  const tracker = new ActivityTracker(() => 1000)
  tracker.event(session('a'), { type: 'turn/start', data: {} })
  tracker.event(session('b'), { type: 'tool/call', data: { name: 'Read' } })
  const snapshot = tracker.snapshot()
  assert.equal(snapshot.phase, 'working')
  assert.equal(snapshot.tool, 'Read')
  assert.equal(snapshot.activeSessions, 2)
  tracker.remove('b')
  assert.equal(tracker.snapshot().activeSessions, 1)
})

test('expires finished phases and follows agent status', () => {
  let now = 1000
  const tracker = new ActivityTracker(() => now)
  tracker.event(session('a'), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(tracker.snapshot().phase, 'done')
  now = 20000
  assert.equal(tracker.snapshot().phase, 'idle')
  tracker.status('a', 'running')
  assert.equal(tracker.snapshot().phase, 'thinking')
  tracker.status('a', 'idle')
  assert.equal(tracker.snapshot().phase, 'idle')
})
