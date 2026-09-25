// Observer: watches a directory and counts what arrives. Runs under both runtimes:
//   node node_modules/bare-runtime/bin/bare observer.js <dir> [--per-dir] [--seconds S] [--stall MS]   (bare)
//   node observer.js <dir> [--per-dir] [--seconds S] [--stall MS]                                        (node, control)
// Prints a line per second and a summary at the end. `--stall MS` blocks the event loop for MS
// milliseconds after the first event: a fast machine otherwise drains the 4 KB buffer as quickly as
// the load fills it and never overflows; a stalled watcher (a GC pause, a busy app) is the realistic
// condition, and the stall makes the overflow deterministic. Under bare-fs 4.8.1 on Windows the process
// dies (access violation) the first time libuv reports lost events with a NULL filename; under Node
// those arrive as events whose filename is null.
'use strict'

const isBare = typeof Bare !== 'undefined'
const fs = isBare ? require('bare-fs') : require('fs')
const argv = isBare ? Bare.argv : process.argv
const runtime = isBare ? `bare ${Bare.version} (bare-fs ${require('bare-fs/package').version})` : `node ${process.version}`

const args = argv.slice(2)
const dir = args[0]
if (!dir) {
  console.error('usage: observer.js <dir> [--per-dir] [--seconds S]')
  if (isBare) Bare.exit(2)
  else process.exit(2)
}
const recursive = !args.includes('--per-dir')
const secondsIdx = args.indexOf('--seconds')
const seconds = secondsIdx === -1 ? 0 : Number(args[secondsIdx + 1])
const stallIdx = args.indexOf('--stall')
const stallMs = stallIdx === -1 ? 0 : Number(args[stallIdx + 1])
let stalled = false

fs.mkdirSync(dir, { recursive: true })

let events = 0
let nulls = 0
let renames = 0
let changes = 0
let errors = 0
let lastSecond = 0

const watcher = fs.watch(dir, { recursive })
watcher.on('change', (kind, name) => {
  if (stallMs > 0 && !stalled) {
    stalled = true
    console.log(`  first event: stalling the event loop for ${stallMs} ms so the buffer overflows`)
    const until = Date.now() + stallMs
    while (Date.now() < until) {
      /* busy: no completion can be re-issued, every further change record is lost */
    }
  }
  events++
  if (kind === 'rename') renames++
  else changes++
  if (name === null || name === undefined) nulls++
})
watcher.on('error', (err) => {
  errors++
  console.log(`  error event: ${err.code || err.message}`)
})

console.log(`[observer ${runtime}] watching ${dir} (${recursive ? 'recursive' : 'per-directory'}${stallMs ? `, stall ${stallMs} ms` : ''}); waiting for load…`)

const tick = setInterval(() => {
  const delta = events - lastSecond
  lastSecond = events
  if (delta > 0) console.log(`  +${delta} events (total ${events}, null filenames ${nulls})`)
}, 1000)

function summary(reason) {
  clearInterval(tick)
  console.log(`[observer] ${reason}: events ${events} (rename ${renames}, change ${changes}), null filenames ${nulls}, errors ${errors}`)
  console.log(
    nulls > 0
      ? '  lost-events notices were delivered as null filenames (Node behaviour; a fixed bare-fs must match)'
      : '  no null filename seen: either no overflow happened, or this bare-fs would have crashed on it'
  )
  watcher.close()
}

if (seconds > 0) setTimeout(() => summary(`stopped after ${seconds} s`), seconds * 1000)
if (!isBare) process.on('SIGINT', () => summary('interrupted'))
