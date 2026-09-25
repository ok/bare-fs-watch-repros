// Issue 2: libuv delivers a NULL filename on a Windows ReadDirectoryChangesW buffer overflow; bare-fs
// calls strlen() on it. Windows only. `bare repro.js <dir>` (observed: crash) / `node repro.js <dir>`
// (control: 'change' events whose filename is null).
'use strict'

const isBare = typeof Bare !== 'undefined'
const fs = isBare ? require('bare-fs') : require('fs')
const path = isBare ? require('bare-path') : require('path')
const os = isBare ? require('bare-os') : require('os')

const runtime = isBare ? `bare ${Bare.version} (bare-fs ${require('bare-fs/package').version})` : `node ${process.version}`
const argv = isBare ? Bare.argv : process.argv
const root = argv[2] || path.join(os.tmpdir(), `bare-fs-repro-null-${Date.now()}`)
const files = Number(argv[3] || 50000)

fs.mkdirSync(root, { recursive: true })
console.log(`[${runtime}] recursive watch on ${root}, then a burst of ${files} file creates`)

let events = 0
let nulls = 0
const watcher = fs.watch(root, { recursive: true })
watcher.on('change', (kind, name) => {
  events++
  if (name === null || name === undefined) nulls++
})
watcher.on('error', (err) => console.log(`  error event: ${err.code || err.message}`))

setTimeout(() => {
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), '')
  setTimeout(() => {
    console.log(`  events: ${events}, events with a null filename: ${nulls}`)
    console.log(
      nulls > 0
        ? '  Node: the overflow arrived as null-filename events (rescan signal)'
        : '  no overflow observed (increase the file count or slow the machine down)'
    )
    console.log('  under bare the expected outcome is a native crash before this line prints')
    watcher.close()
  }, 3000)
}, 500)
