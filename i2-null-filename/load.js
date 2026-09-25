// Load generator: many changes in one directory, fast. Run it from a SEPARATE process while the
// observer watches the directory, so the observer's event loop is what falls behind.
//
//   node load.js <dir> [--files N] [--size BYTES] [--rounds R] [--mode create|rename|write|delete|all]
//
// Sizes are irrelevant to the overflow (the 4 KB ReadDirectoryChangesW buffer holds change *records*,
// 12 bytes + the UTF-16 name each, ~128 for ten-character names); the number of operations in a
// short window is what matters. A rename is two records (old and new name), so `rename` is the most
// efficient trigger. Defaults: 20 000 empty files, one round of every mode.
'use strict'

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dir = args[0]
if (!dir) {
  console.error('usage: node load.js <dir> [--files N] [--size BYTES] [--rounds R] [--mode create|rename|write|delete|all]')
  process.exit(2)
}
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i === -1 ? def : args[i + 1]
}
const files = Number(opt('files', 20000))
const size = Number(opt('size', 0))
const rounds = Number(opt('rounds', 1))
const mode = opt('mode', 'all')

fs.mkdirSync(dir, { recursive: true })
const content = Buffer.alloc(size, 120)
const name = (i, g) => path.join(dir, `${g}${i}.txt`)

function timed(label, fn) {
  const t0 = Date.now()
  const n = fn()
  const ms = Date.now() - t0
  console.log(`  ${label}: ${n} operations in ${ms} ms (${Math.round((n / Math.max(ms, 1)) * 1000)}/s)`)
}

function create(g) {
  for (let i = 0; i < files; i++) fs.writeFileSync(name(i, g), content)
  return files
}
function rename(from, to) {
  // rename every file to a new name: two change records each
  for (let i = 0; i < files; i++) fs.renameSync(name(i, from), name(i, to))
  return files
}
function write(g) {
  for (let i = 0; i < files; i++) fs.writeFileSync(name(i, g), content)
  return files
}
function remove(g) {
  for (let i = 0; i < files; i++) fs.rmSync(name(i, g), { force: true })
  return files
}

console.log(`[load] ${dir}: ${files} files × ${size} B, mode ${mode}, ${rounds} round(s)`)
let g = 'f'
for (let r = 1; r <= rounds; r++) {
  if (rounds > 1) console.log(`  round ${r}`)
  if (mode === 'create' || mode === 'all') timed('create', () => create(g))
  if (mode === 'rename' || mode === 'all') {
    if (mode === 'rename' && r === 1 && !fs.existsSync(name(0, g))) timed('create (setup)', () => create(g))
    const next = g === 'f' ? 'g' : 'f'
    timed('rename (shuffle)', () => rename(g, next))
    g = next
  }
  if (mode === 'write' || mode === 'all') {
    if (mode === 'write' && !fs.existsSync(name(0, g))) timed('create (setup)', () => create(g))
    timed('write (overwrite)', () => write(g))
  }
  if (mode === 'delete' || mode === 'all') {
    if (mode === 'delete' && !fs.existsSync(name(0, g))) timed('create (setup)', () => create(g))
    timed('delete', () => remove(g))
  }
}
console.log('[load] done')
