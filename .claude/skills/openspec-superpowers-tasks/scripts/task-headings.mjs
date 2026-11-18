#!/usr/bin/env node
// Check or add the `### Task <n>` headings that let one OpenSpec tasks.md
// also serve as a superpowers plan file, one superpowers task per task group.
//
// OpenSpec tracks work by checkbox lines (`- [ ] 1.2 ...`) and ignores
// headings. The superpowers scripts (task-brief, task-start) cut a plan into
// tasks at headings of the form `Task <id>` and ignore checkboxes. One heading
// per group therefore hands a whole group of checkboxes to one agent:
//
//   ## 1. Login screen
//
//   ### Task 1
//
//   - [ ] 1.1 Build the form. Verify: ...
//   - [ ] 1.2 Submit it and show errors. Verify: ...
//
// A group is every top-level checkbox whose number starts with the same first
// part (1.1, 1.2 -> group 1). A heading per checkbox (`### Task 1.2`) would
// give every checkbox its own agent, so `add` replaces those.
import { readFileSync, writeFileSync } from 'node:fs'

const USAGE = `usage: node task-headings.mjs <check|add> <path/to/tasks.md>
  check  report whether every task group has one Task heading; exit 1 if not
  add    put one Task heading on each group, replacing per-checkbox headings
         (nothing else changes; safe to repeat), then check`

const [mode, file] = process.argv.slice(2)
if (!['check', 'add'].includes(mode) || !file) {
  console.error(USAGE)
  process.exit(2)
}

// The superpowers scripts toggle on ``` only, so a Task heading inside a
// ```-fence is invisible to them.
const FENCE = /^```/
// A top-level checkbox, as OpenSpec reads one: a list marker at column 0 and a
// box holding at most one mark. `(?![([])` keeps link bullets like `- [A](url)` out.
const BOX = /^(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*[^\]\s]?\s*\](?![([])|\s+\])\s*(.*)/
const TASK_NUMBER = /^(\d+(?:\.\d+)*)(?=[\s.:)]|$)/
// The heading shape the superpowers task-brief script accepts.
const HEADING = /^#+[ \t]+Task[ \t]+([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)/
// An OpenSpec group heading: `## 1. Setup`.
const GROUP_HEADING = /^##[ \t]+(\d+)[.):]?(?:[ \t]|$)/

function scan(lines) {
  const boxes = []           // { number, group, line }: numbered top-level checkboxes
  const unnumbered = []      // line indexes: top-level checkboxes with no number
  const headings = []        // { id, line }: Task headings outside fences
  const groupHeadings = new Map() // group -> line index of its `## N.` heading
  let inFence = false
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return }
    if (inFence) return
    const heading = line.match(HEADING)
    if (heading && /[0-9]/.test(heading[1])) { headings.push({ id: heading[1], line: i }); return }
    const group = line.match(GROUP_HEADING)
    if (group) { if (!groupHeadings.has(group[1])) groupHeadings.set(group[1], i); return }
    const box = line.match(BOX)
    if (!box) return
    const number = box[1].match(TASK_NUMBER)
    if (number) boxes.push({ number: number[1], group: number[1].split('.')[0], line: i })
    else unnumbered.push(i)
  })
  const groups = new Map()   // group -> line index of its first checkbox
  for (const b of boxes) if (!groups.has(b.group)) groups.set(b.group, b.line)
  return { boxes, unnumbered, headings, groupHeadings, groups }
}

function report(lines) {
  const { boxes, unnumbered, headings, groups } = scan(lines)
  const list = (items) => items.join(', ')
  const numbers = boxes.map((b) => b.number)
  const groupIds = [...groups.keys()]
  const headingLine = new Map()
  for (const h of headings) if (!headingLine.has(h.id)) headingLine.set(h.id, h.line)

  const missing = groupIds.filter((g) => !headingLine.has(g))
  const below = groupIds.filter((g) => headingLine.get(g) > groups.get(g))
  // Any other Task heading splits a group, or names work OpenSpec does not track.
  const perTask = headings.filter((h) => numbers.includes(h.id) && !groups.has(h.id)).map((h) => h.id)
  const untracked = headings.filter((h) => !groups.has(h.id) && !numbers.includes(h.id)).map((h) => h.id)
  const repeated = [...new Set(headings.map((h) => h.id).filter((id, i, all) => all.indexOf(id) !== i))]
  const duplicates = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))]

  console.log(`${file}: ${boxes.length} numbered tasks in ${groupIds.length} groups, ${groupIds.length - missing.length} groups with a Task heading`)
  if (!boxes.length) console.log('  no numbered top-level checkboxes found: is this an OpenSpec tasks.md?')
  if (missing.length) console.log(`  group without a Task heading: ${list(missing)} -> run this script with "add"`)
  if (perTask.length) console.log(`  heading on a single task, which gives that task its own agent: ${list(perTask)} -> run this script with "add"`)
  if (below.length) console.log(`  heading is below its group's first checkbox: ${list(below)} -> move it above`)
  if (repeated.length) console.log(`  the same Task heading appears twice: ${list(repeated)} -> keep one`)
  if (duplicates.length) console.log(`  duplicate task numbers: ${list(duplicates)} -> give each task its own number`)
  if (untracked.length) console.log(`  warning: Task heading with no checkboxes of that number, so OpenSpec does not track it: ${list(untracked)}`)
  if (unnumbered.length) console.log(`  warning: top-level checkbox with no task number, so it is briefed with the group above it: line ${list(unnumbered.map((n) => n + 1))}`)

  const ok = boxes.length > 0 && !missing.length && !perTask.length && !below.length && !repeated.length && !duplicates.length
  console.log(ok ? `  ok: usable as a superpowers plan file with tasks ${list(groupIds)}` : '  not ready')
  return ok
}

let content
try {
  content = readFileSync(file, 'utf8')
} catch (err) {
  console.error(`cannot read ${file}: ${err.code || err.message}`)
  process.exit(2)
}
const eol = content.includes('\r\n') ? '\r\n' : '\n'
let lines = content.split(/\r?\n/)

if (mode === 'add') {
  // 1. Drop per-checkbox headings (and the blank line after each).
  let { boxes, headings, groups } = scan(lines)
  const numbers = boxes.map((b) => b.number)
  const drop = new Set(headings.filter((h) => numbers.includes(h.id) && !groups.has(h.id)).map((h) => h.line))
  let removed = drop.size
  if (removed) {
    const kept = []
    lines.forEach((line, i) => {
      if (drop.has(i)) return
      if (drop.has(i - 1) && line.trim() === '' && kept.length && kept[kept.length - 1].trim() === '') return
      kept.push(line)
    })
    lines = kept
  }
  // 2. Put one heading on each group that has none: under its `## N.` heading
  //    when there is one, otherwise above its first checkbox.
  const s = scan(lines)
  const have = new Set(s.headings.map((h) => h.id))
  const after = new Map(); const before = new Map()
  for (const [g, firstBox] of s.groups) {
    if (have.has(g)) continue
    const gh = s.groupHeadings.get(g)
    if (gh !== undefined && gh < firstBox) after.set(gh, g)
    else before.set(firstBox, g)
  }
  const out = []
  lines.forEach((line, i) => {
    if (before.has(i)) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('')
      out.push(`### Task ${before.get(i)}`, '')
    }
    out.push(line)
    if (after.has(i)) {
      out.push('', `### Task ${after.get(i)}`)
      if ((lines[i + 1] ?? '').trim() !== '') out.push('')
    }
  })
  const added = after.size + before.size
  if (added || removed) writeFileSync(file, out.join(eol))
  lines = out
  console.log(`added ${added} group heading${added === 1 ? '' : 's'}${removed ? `, removed ${removed} per-task heading${removed === 1 ? '' : 's'}` : ''}`)
  if (added) {
    console.log('  tell the user: this tasks.md was written without a Task heading per group, so openspec/config.yaml is missing the `rules: tasks:` entry (SKILL.md, Project setup) or it was not followed')
  }
}

process.exit(report(lines) ? 0 : 1)
