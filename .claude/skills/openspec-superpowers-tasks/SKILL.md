---
name: openspec-superpowers-tasks
description: Use when implementing an OpenSpec change with superpowers subagent-driven-development or executing-plans, when writing or editing an OpenSpec tasks.md in a project that uses both tools, or when a superpowers script fails on a tasks.md with "no heading matching 'Task N'".
---

# OpenSpec tasks as a superpowers plan

OpenSpec tracks work by checkbox lines and ignores headings. The superpowers scripts (`task-brief`, `task-start`) cut a plan into tasks at `Task <id>` headings and ignore checkboxes. Put one `Task` heading on each group of checkboxes, and one `tasks.md` serves both tools, with a whole group going to one agent. Never copy it into a second plan file or write a brief by hand. Never put a heading on a single checkbox: that buys an implementer and a reviewer for every checkbox.

## Format

```markdown
## 1. Login screen

### Task 1

- [ ] 1.1 Build the form with its validation. Verify: the form tests pass.
- [ ] 1.2 Submit it and show errors. Verify: the submit and error tests pass.
  - [ ] 1.2.1 A sub-task stays indented under its parent.
```

- **Heading:** the literal word `Task`, then the group's number, under the `## N.` group heading and outside code fences. A title may follow: `### Task 1: Login screen`.
- **Group:** the smallest unit that has its own test cycle and that a reviewer could accept or reject independently. Setup, scaffolding and documentation belong to the group whose deliverable needs them.
- **Marks:** `[ ]` and `[x]` only. OpenSpec reads any other mark as unfinished.

## Before the first task, and after any edit to tasks.md

```bash
node <this skill's directory>/scripts/task-headings.mjs check openspec/changes/<change-id>/tasks.md
```

- Headings missing, or on single checkboxes: run it again with `add` in place of `check`. It changes only headings and is safe to repeat.
- Anything else: fix `tasks.md` as the message says, then check again.
- When the output says "tell the user", pass that on.

## With the superpowers skills

| The skill asks for | Give it |
|---|---|
| PLAN_FILE | The path of `tasks.md` |
| Task number | The group's number: `task-brief <tasks.md> 2` |
| Spec, Global Constraints | The change's `design.md` and spec deltas |

- **Ticking.** The skills record progress in their ledger and never tick checkboxes; OpenSpec reads only checkboxes. When the ledger records a task complete, tick every checkbox in that group.
- **Stale briefs.** Run `task-brief` again for a group whose text changed.
- **Trailing line.** A brief can end with the next group's heading (`## 2. …`). Ignore it.

## Project setup

Once per project, in `openspec/config.yaml` (merge into an existing `rules:` key), so that `openspec-propose` writes the groups and headings itself:

```yaml
rules:
  tasks:
    - Group the tasks so that each `## N.` group is the smallest unit that has its own test cycle and that a reviewer could accept or reject independently. Fold setup, configuration, scaffolding and documentation into the group whose deliverable needs them.
    - Put one heading line `### Task N` (the group's number) directly under each `## N.` group heading, and no heading on individual tasks, so that tools which find work by heading take a whole group at a time.
```
