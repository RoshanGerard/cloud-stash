# Project rules for Claude Code

Every agent working in this repository loads this file, so it holds what every agent needs. The workflow for running a change lives in `ORCHESTRATOR.md` and is for the main session.

## Who you are

- **Dispatched agent** — the Agent tool or a workflow script started you, whether or not your prompt says so. Do not read `ORCHESTRATOR.md`: this file and your dispatch prompt hold all the rules you need.
- **Main session** — everyone else, normally a person talking to you directly. Before you work on a change, fix, review or branch handoff, check whether `ORCHESTRATOR.md` (repository root, next to this file) is in your context. If it is not, read it in full first.

## Context

- `openspec/config.yaml` — project context (`context:`) and per-artifact rules (`rules:`) that OpenSpec applies when it writes artifacts.
- `openspec/project.md` — stack, architecture, conventions.
- `openspec/specs/` — canonical specs. `openspec/changes/` — active changes; `openspec/changes/archive/` — completed.
- The OpenSpec steps are skills: `openspec-propose`, `openspec-update-change`, `openspec-apply-change`, `openspec-sync-specs`, `openspec-archive-change`. OpenSpec 1.x also installs each as a command (`/opsx:propose` and so on); the skill is the same step.
- A change's `tasks.md` is both the OpenSpec task list and the superpowers plan. Before you write or edit one, or hand one to a superpowers skill or script, use the `openspec-superpowers-tasks` skill.

## Dispatched agents

- **Lifecycle steps are the main session's.** Do not run `openspec-propose`, `openspec-update-change`, `openspec-apply-change`, `openspec-sync-specs`, `openspec-archive-change`, `superpowers:brainstorming`, `superpowers:writing-plans` or `finishing-a-development-branch`, and do not edit a change's artifacts (`proposal.md`, `design.md`, spec deltas, `tasks.md` and its checkboxes), unless your dispatch prompt hands you that step. If it hands you a step without the rules for it, report that instead of running it.
- **You cannot ask the user.** Where a rule here or a skill says to ask, pause, file a follow-up or record something in `design.md`, stop that part and put it in your final report. Do the same when your task conflicts with `design.md` or turns out to be something else (a bug that is really a missing feature), and for any other doubt or blocker.

## Dispatch prompts

Every prompt written for another agent, by the main session or by a dispatched agent, opens with this line, verbatim or equivalent: `You are a dispatched agent. The root CLAUDE.md applies to you in full; if it is not in your context, read it first.`

## Coding discipline

- **TDD** (`test-driven-development`). Failing test → watch it fail → minimum code to pass; for a bug fix, the failing test reproduces the bug. Production code without a prior failing test must be deleted and rewritten. Throwaway API-exploration code is permitted (≤50 lines, never committed, deleted before the TDD pass).
- **Debugging** (`systematic-debugging`) for any failing test, unexpected behavior or non-trivial issue. No guess-and-check.
- **Mechanical fixes** (typo, comment, one-line semantic-preserving) in reactive work (bug fixes, improvements, patches) skip TDD and the debugging skill. No other fix does.
- **Verification** (`verification-before-completion`) before claiming done: full test suite + typecheck + lint. For reactive work the audit gate runs in addition — verification covers code correctness, the audit gate covers spec coverage.
- **Long-running commands** (test suites, builds, Playwright, Docker, dev servers): `run_in_background: true`. On the runaway system-reminder bug (claude-code #11716 or successor): run foreground with explicit timeout (e.g. 300000) to override the 120s auto-background cutoff; the main session restarts the session first.
- **`design.md` decisions are binding** while a change is implemented. Never ship a deviation silently. Dispatched agent: stop that part and report it. Main session: `ORCHESTRATOR.md` > Implementation.
- **Review findings.** **Critical** = security vulnerability, contract break (signature / envelope shape change not in `design.md`), test coverage regression, accessibility regression below WCAG AA, deviation from `design.md` decisions. A Critical finding blocks progress. Style nits / refactor suggestions are non-blocking.
- **Frontend code:** use `frontend-design`. Avoid defaults: no Inter/Roboto/Arial display type, no purple-gradient-on-white, no generic grid-of-cards.
- **Accessibility** is non-negotiable: semantic HTML, keyboard nav, ARIA only when semantics aren't enough, WCAG AA contrast minimum. Flag deviations in `design.md` before implementation (main session: `openspec-update-change`).

## Audit gate

Mandatory for all reactive work: every bug fix, improvement or patch, including one made in passing during other work. It does not apply to implementing the tasks of an approved change. Classify each fix into ONE outcome before declaring done, before committing, before handoff. Never skip it, even for a fix that feels trivial: the 30-second checklist is cheaper than a missed contract change.

- **Outcome 1 — No observable contract change.** Refactor, perf, doc, test, internal-only, or accessibility fix already inside WCAG AA. → Plain commit, no OpenSpec.
- **Outcome 2 — Code wrong, spec right.** The fix restores behavior the spec already documents (a code defect against an existing requirement). → Plain commit whose body cites the restored requirement, e.g. `Restores: openspec/specs/<cap>/spec.md → Requirement: <name>`. Never omit the cite: without it the audit isn't auditable post-hoc.
- **Outcome 3 — Contract changed.** Any trigger below fires. → Back-fill required. Keep the fix as one commit and never bundle it with the back-fill's commits (the OpenSpec proposal/sync/archive is its own commit chain). Main session: pick Pattern A / B / C in `ORCHESTRATOR.md` > Back-fill patterns. Dispatched agent: commit the fix, then report Outcome 3 and the trigger that fired; do not start the back-fill unless your dispatch prompt hands it to you.

### Trigger checklist (Outcome 3) — if ANY fires, the contract changed

- New error code or coded response (any new value in a `code` / `error_code` field, e.g. `RATE_LIMITED`)
- New / changed HTTP status, response field, request field, or query param
- New default, clamp, or validation rule visible to a caller
- Scenario added / removed / renamed in the impacted capability
- Frontend↔backend vocabulary pin (enum keys, shared schema, label-to-code map)
- Previously-implicit invariant becoming load-bearing (a behavior previously assumed but never documented now becomes a hard rule, e.g. "list endpoint MUST include archived rows")
- Removal of previously-documented behavior

If you can't classify confidently: the main session asks the user before deciding. A dispatched agent leaves that change uncommitted, flags the unresolved classification in its final report, and lets the main session decide (the outcome sets the commit form).

## Hard rules

- All git commits follow the format defined in the `/git-spec` skill; read the skill before running any git commit command. Use the right typed prefix (done/fix/refactor/cleanup/in-progress/pending) per the branch's commit convention.
- Never commit directly to `main`.
- Never run `gh pr create` or merge a branch into its base without first completing `finishing-a-development-branch` in the same session (main session: `ORCHESTRATOR.md` > Finishing). Completing `openspec-archive-change` is not a substitute.
- Never modify `openspec/specs/` directly — only via the OpenSpec lifecycle (a forward change or a reactive back-fill).
- Never use direct git or shell operations (`git mv`, `git rm`, `git checkout`, `git restore`, `git reset --hard`, `mv`, `rm`, `cp`, `mkdir`, `rmdir`) on anything under `openspec/changes/`. All directory moves go through the OpenSpec lifecycle skills (`openspec-propose`, `openspec-apply-change`, `openspec-sync-specs`, `openspec-archive-change`). Restoring a deleted change directory is itself a protocol question — pause and ask, don't reach for git or shell.
- Every completed change archives via `openspec-archive-change`. "Delete the directory" is never an alternative, regardless of what a stub's `tasks.md` §5.X (or any other artifact) may say. If a stub's `tasks.md` specifies `DEFAULT: delete`, treat it as an authoring-time error: archive anyway, and file a follow-up to fix the propose-time template that generated it.
- Never amend an archived change. A back-fill is always a *new* change directory under `openspec/changes/`, even if the impacted requirement was originally added by an archived change.
- Never add a dependency without justifying it in `design.md`.
