// Run from the skill directory: node --test tests/task-headings.test.mjs
// Drives the script as a command on temporary files. Calls no model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'task-headings.mjs')

function run(mode, content) {
  const file = join(mkdtempSync(join(tmpdir(), 'task-headings-')), 'tasks.md')
  writeFileSync(file, content)
  const r = spawnSync('node', [SCRIPT, mode, file], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr, after: readFileSync(file, 'utf8'), file }
}
const body = (s) => s.split('\n').filter((l) => l.trim() && !l.startsWith('### Task')).join('\n')

const PLAIN = `# Tasks

## 1. Setup

- [ ] 1.1 Create the module
  - [ ] 1.1.1 A sub-task
- [x] 1.2 Add the dependency

## 2. Core

- [ ] 2.1 Implement export
`

test('check fails on an OpenSpec tasks.md without headings and changes nothing', () => {
  const r = run('check', PLAIN)
  assert.equal(r.code, 1)
  assert.match(r.out, /3 numbered tasks in 2 groups, 0 groups with a Task heading/)
  assert.match(r.out, /group without a Task heading: 1, 2/)
  assert.equal(r.after, PLAIN)
})

test('add puts one heading under each group heading, and nothing else', () => {
  const r = run('add', PLAIN)
  assert.equal(r.code, 0)
  assert.match(r.out, /added 2 group headings/)
  assert.match(r.out, /tell the user/)
  assert.match(r.out, /with tasks 1, 2/)
  assert.match(r.after, /## 1\. Setup\n\n### Task 1\n\n- \[ \] 1\.1 Create the module\n {2}- \[ \] 1\.1\.1 A sub-task\n- \[x\] 1\.2 /)
  assert.match(r.after, /## 2\. Core\n\n### Task 2\n\n- \[ \] 2\.1 /)
  assert.equal(r.after.match(/^### Task/gm).length, 2)
  assert.equal(body(r.after), body(PLAIN))
})

test('add is safe to repeat', () => {
  const first = run('add', PLAIN)
  const again = spawnSync('node', [SCRIPT, 'add', first.file], { encoding: 'utf8' })
  assert.equal(again.status, 0)
  assert.match(again.stdout, /added 0 group headings/)
  assert.doesNotMatch(again.stdout, /tell the user/)
  assert.equal(readFileSync(first.file, 'utf8'), first.after)
})

test('a heading per checkbox is rejected by check and regrouped by add', () => {
  const perTask = '## 1. Setup\n\n### Task 1.1\n\n- [ ] 1.1 a\n\n### Task 1.2\n\n- [ ] 1.2 b\n'
  const c = run('check', perTask)
  assert.equal(c.code, 1)
  assert.match(c.out, /heading on a single task.*: 1\.1, 1\.2/)
  const a = run('add', perTask)
  assert.equal(a.code, 0)
  assert.match(a.out, /added 1 group heading, removed 2 per-task headings/)
  assert.deepEqual(a.after.match(/^### Task.*$/gm), ['### Task 1'])
  assert.equal(body(a.after), body(perTask))
})

test('a flat list with no group headings gets a heading above each group', () => {
  const r = run('add', '- [ ] 1.1 a\n- [ ] 1.2 b\n- [ ] 2.1 c\n')
  assert.equal(r.code, 0)
  assert.equal(r.after, '### Task 1\n\n- [ ] 1.1 a\n- [ ] 1.2 b\n\n### Task 2\n\n- [ ] 2.1 c\n')
})

test('a titled heading counts, and a heading inside a code fence does not', () => {
  assert.equal(run('check', '### Task 1: Setup\n\n- [ ] 1.1 x\n').code, 0)
  const fenced = run('check', '```\n### Task 1\n```\n- [ ] 1.1 x\n')
  assert.equal(fenced.code, 1)
  assert.match(fenced.out, /group without a Task heading: 1/)
})

test('problems that add cannot fix are reported', () => {
  const dup = run('add', '- [ ] 1.1 a\n- [ ] 1.1 b\n')
  assert.equal(dup.code, 1)
  assert.match(dup.out, /duplicate task numbers: 1\.1/)

  const below = run('check', '- [ ] 1.1 a\n\n### Task 1\n')
  assert.equal(below.code, 1)
  assert.match(below.out, /heading is below its group's first checkbox: 1/)

  assert.equal(run('check', '# Tasks\n\n- plain bullet\n').code, 1)
})

test('warnings do not fail the check', () => {
  const r = run('check', '### Task 1\n\n- [ ] 1.1 a\n- [ ] loose item\n- [A](https://example.com)\n\n### Task 9\n')
  assert.equal(r.code, 0)
  assert.match(r.out, /no task number.*line 4$/m)
  assert.match(r.out, /does not track it: 9$/m)
})

test('CRLF line endings are kept', () => {
  const r = run('add', '## 1. A\r\n- [ ] 1.1 a\r\n- [ ] 1.2 b\r\n')
  assert.equal(r.code, 0)
  assert.equal(r.after, '## 1. A\r\n\r\n### Task 1\r\n\r\n- [ ] 1.1 a\r\n- [ ] 1.2 b\r\n')
})

test('bad arguments and unreadable files exit 2', () => {
  assert.equal(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status, 2)
  assert.equal(spawnSync('node', [SCRIPT, 'check', '/nonexistent/tasks.md'], { encoding: 'utf8' }).status, 2)
})
