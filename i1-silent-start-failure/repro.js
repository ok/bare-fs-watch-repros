// Issue 1: bare-fs fs.watch() on a path that cannot be watched returns a watcher that never fires
// and never errors. Runs under both runtimes: `bare repro.js` (observed) and `node repro.js` (control).
//
//   mode "missing" (default): watch a path that does not exist, then create it and write into it
//   mode "limit N":            arm N directories; pass N above fs.inotify.max_user_watches (Linux)
'use strict'

const isBare = typeof Bare !== 'undefined'
const fs = isBare ? require('bare-fs') : require('fs')
const os = isBare ? require('bare-os') : require('os')
const path = isBare ? require('bare-path') : require('path')

const runtime = isBare ? `bare ${Bare.version} (bare-fs ${require('bare-fs/package').version})` : `node ${process.version}`
const mode = (isBare ? Bare.argv : process.argv)[2] || 'missing'
const arg = Number((isBare ? Bare.argv : process.argv)[3] || 0)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tmpdir(name) {
  const dir = path.join(os.tmpdir(), `bare-fs-repro-${name}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function missing() {
  const base = tmpdir('missing')
  const target = path.join(base, 'does-not-exist')
  console.log(`[${runtime}] fs.watch('${target}') — the path does not exist`)
  let watcher
  try {
    watcher = fs.watch(target)
  } catch (err) {
    console.log(`  threw ${err.code}: this is the expected behaviour (Node)`)
    return
  }
  const events = []
  const errors = []
  watcher.on('change', (kind, name) => events.push([kind, name]))
  watcher.on('error', (err) => errors.push(err.code))
  console.log('  no throw. Creating the directory and a file inside it…')
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'a.txt'), '1')
  await sleep(500)
  console.log(`  events: ${JSON.stringify(events)}  errors: ${JSON.stringify(errors)}`)
  if (events.length === 0 && errors.length === 0) {
    console.log('  OBSERVED: a dead watcher — nothing fires, nothing errors (the defect)')
  }
  watcher.close()
}

async function limit(count) {
  const base = tmpdir('limit')
  let max = '?'
  try {
    max = fs.readFileSync('/proc/sys/fs/inotify/max_user_watches', 'utf8').trim()
  } catch {}
  console.log(`[${runtime}] arming ${count} directory watches; fs.inotify.max_user_watches=${max}`)
  const watchers = []
  let threw = 0
  const errors = []
  for (let i = 0; i < count; i++) {
    const dir = path.join(base, 'd' + i)
    fs.mkdirSync(dir)
    try {
      const w = fs.watch(dir)
      w.on('error', (err) => errors.push([i, err.code]))
      watchers.push([i, dir, w])
    } catch (err) {
      threw++
      if (threw === 1) console.log(`  first throw at index ${i}: ${err.code} (expected behaviour, Node)`)
    }
  }
  // poke every watched directory and see which watchers fire
  const fired = new Set()
  for (const [i, dir, w] of watchers) {
    w.on('change', () => fired.add(i))
    fs.writeFileSync(path.join(dir, 'x'), '1')
  }
  await sleep(1000)
  const dead = watchers.filter(([i]) => !fired.has(i)).map(([i]) => i)
  console.log(`  armed without throwing: ${watchers.length}, threw: ${threw}, error events: ${errors.length}`)
  console.log(`  watchers that never fired: ${dead.length}${dead.length ? ` (indices ${dead[0]}…${dead[dead.length - 1]})` : ''}`)
  if (dead.length > 0 && errors.length === 0 && threw === 0) {
    console.log('  OBSERVED: dead handles past the limit with no throw and no error (the defect)')
  }
  for (const [, , w] of watchers) w.close()
}

;(mode === 'limit' ? limit(arg || 100) : missing()).catch((err) => {
  console.error(err)
})
