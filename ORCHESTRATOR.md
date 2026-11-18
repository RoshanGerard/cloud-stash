# Orchestrator rules (main session only)

Read this before working on a change, fix, review or branch handoff, whenever it is not in your context. Dispatched agents do not read it: they get the root `CLAUDE.md` and the dispatch prompt you write. The coding discipline, the audit gate and the hard rules every agent shares are in the root `CLAUDE.md` and are not repeated here.

## Workflow

Forward changes (intent → propose → ship). For bug fixes, improvements and patches, see Reactive workflow.

1. **Entry point.**
   - **Brainstorm-first** — a stub or unresolved architectural ambiguity: a change in `openspec/changes/` whose `proposal.md` is incomplete (open questions, TBDs, missing `## What Changes` body, no spec delta yet, no `tasks.md`), or open architectural questions in the request → step 2, then `openspec-propose`.
   - **Propose-direct** — everything else → `openspec-propose` directly. A visible-UI change still gets step 4; that does not change the entry point.
2. **Brainstorming — architectural resolution** (only after brainstorm-first). `superpowers:brainstorming` converges the architectural / conceptual / scope / error-vocabulary ambiguity into decisions, which flow per Brainstorming > Output handoff. Then step 3. Conceptual only: no Visual Companion yet, because there are no artifacts to refine.
3. **`openspec-propose <description>`** — generates `proposal.md`, `design.md`, `specs/<cap>/spec.md` deltas, `tasks.md`. Pass `<change-id>` (kebab-case) instead when the name is already settled, e.g. reactive back-fills.
4. **Brainstorming — visual refinement** (only for visible UI: component, layout, color, motion, copy, accessibility-affecting markup; mandatory there). Run `superpowers:brainstorming` after `openspec-propose` and before human review. Its Visual Companion (browser mockups / layouts / comparisons) engages per the skill's protocol, and the decisions go into `design.md` `## Visual direction` through `openspec-update-change`. Non-UI changes skip this step.
5. **Human review.** Wait for explicit approval before `openspec-apply-change`.
6. **Pre-apply staleness check.** Spot-check that `design.md` file paths, function names and architectural assumptions still match the codebase. If they shifted, re-resolve via `superpowers:brainstorming` for the parts that need it, or correct purely stale references with `openspec-update-change`.
7. **`openspec-apply-change`.** The coding discipline is mandatory: root `CLAUDE.md`, and Implementation below.
8. **Pre-archive + archive.** Every `tasks.md` checkbox checked, full test suite passes, feature exercised against a running system, `openspec validate <change>` green. If validate fails, fix in the worktree branch and re-run; never skip validation. Then archive via `openspec-archive-change` in the worktree branch, before merging.
9. **Finish the branch** — see Finishing. `openspec-archive-change` closes the OpenSpec lifecycle; it is not the branch finish line. This step is.

### Plan format

One `tasks.md` is both the OpenSpec task list and the superpowers plan: OpenSpec counts its checkboxes, and the superpowers scripts find a task by the `### Task N` heading that each `## N.` group carries. Before the first task of a change, and whenever you write or edit a `tasks.md` or hand one to a superpowers skill or script, use the `openspec-superpowers-tasks` skill: it holds the format, the check to run, how to pass the file and the task ids to the superpowers scripts, and when to tick the checkboxes.

## Reactive workflow (bugs, fixes, improvements)

Issue → fix → audit → optional back-fill. The audit gate runs on the fix's output, not on whether `systematic-debugging` was invoked.

1. **Investigate.** Use `superpowers:systematic-debugging` for any failing test, unexpected behavior or non-trivial issue (mechanical fixes are exempt: root `CLAUDE.md`). If the investigation reveals a missing feature rather than a defect, switch to Workflow; the reactive flow does not apply.
2. **Implement** the fix on a branch, test-first: a failing test that reproduces the bug, then make it green (mechanical fixes exempt).
3. **Audit gate** (root `CLAUDE.md`). Classify the fix into one outcome before declaring done, before committing, before handoff.
4. **Act.** Outcome 1 → plain commit. Outcome 2 → plain commit with the spec citation in its body. Outcome 3 → back-fill chain (Pattern A / B / C).
5. **Pre-handoff backstop** — see Finishing.

### Back-fill patterns

**Pattern A — Pure back-fill** (impl already shipped; most common).
- `openspec-propose <change-id>` with `tasks.md` pre-checked; `proposal.md` opens with "Implementation already shipped in commit `<sha>`."
- `design.md` captures the as-shipped contract — read the actual diff, never guess.
- Spec delta in `## ADDED Requirements` (or the `MODIFIED` / `REMOVED` / `RENAMED` variants). Multi-capability fixes bundle all deltas into ONE change.
- Chain: `openspec-propose` → `openspec-sync-specs` → `openspec-archive-change` in one session. `openspec validate <change-id>` before sync; `openspec validate <capability> --type spec` after.
- `openspec-apply-change` is bypassed, but the coding discipline still applies: TDD + verification cover the fix commit (Reactive step 2), code review runs between artifact drafts, the audit gate covers spec coverage.
- Templates: review the most recent Pattern A back-fills under `openspec/changes/archive/` for the structure (proposal framing, pre-checked tasks, as-shipped `design.md`).

**Pattern B — Forward proposal** (interim partial fix shipped; full contract still being designed). Standard flow: propose → human review → apply → finish impl → sync → archive, each with its skill.

**Pattern C — Deferred back-fill** (emergency hotfix / release-branch fix; full OpenSpec round-trip not feasible right now).
- Allowed ONLY if a tracking ticket (`<TICKET_PREFIX>-*`) is filed AND a deadline is set (default: before the next merge to `main`).
- Cap: at most ONE open deferred back-fill per branch. A second one blocks merge until the first is back-filled.
- Owner = author of the fix.

## Finishing

`finishing-a-development-branch` is the mandatory entry point for every branch handoff. Run it when all tasks are complete (in a forward change, after archive), and always before any merge-to-base or PR, in the same session as that merge or PR. The handoff goes through the skill: it re-verifies tests, runs the pre-handoff backstop, then performs the merge / push / PR itself. Never run a bare `gh pr create` or merge to base outside it.

PR opening is the user's call by default: run `gh pr create` only when explicitly asked, and then inside the skill. That decides whether and when to hand off. It never makes the skill optional.

**Pre-handoff backstop** (extends the skill). It covers the whole branch, not just this session's commits. Before any merge or PR, run `git log <base>..HEAD --no-merges` and audit every commit in that range against the trigger checklist (root `CLAUDE.md` > Audit gate): the branch may carry sibling sub-task commits you didn't author this session, and they ride into the PR too. Cross-check against `openspec/changes/` (active) and `openspec/changes/archive/` (recent on this branch). Any uncovered Outcome 3 commit blocks the handoff.

## Brainstorming

`superpowers:brainstorming` resolves any unresolved design question — architectural, conceptual, scope, error-vocabulary or visual — by converging: probing questions one at a time, approaches with tradeoffs, a recommendation. Its two scheduled moments are Workflow steps 2 and 4.

- **Visual-refinement trigger.** Visible UI, and `openspec-propose` has run (in any flow that reaches `openspec-apply-change`, Pattern B included) → you must invoke `superpowers:brainstorming` before `openspec-apply-change`, as step 4 describes.
- Per question: terminal (conceptual / tradeoff / scope) or the Visual Companion browser (mockups / layouts / comparisons). The Visual Companion is offered once, as its own message, and is not standalone-invocable.
- **Output handoff** — always to OpenSpec artifacts (Hard rules (main session), below). Once `openspec-propose` has run, write decisions into the existing artifacts with `openspec-update-change`, which revises them and keeps them consistent with each other; it never edits code.
  - architectural decisions → `design.md` `## Decisions`
  - visual decisions → `design.md` `## Visual direction`
  - new / changed requirements → `specs/<cap>/spec.md` (delta)
  - capability list → `proposal.md` `## Capabilities`
  - what gets built → `tasks.md`
  - BREAKING markers → `proposal.md` `## What Changes` (prefix bullet with **BREAKING**)
  - removed requirements → `specs/<cap>/spec.md` `## REMOVED Requirements` (with **Reason** + **Migration**)
  - scope shifts → `design.md` `## Goals / Non-Goals`
  - new risks → `design.md` `## Risks / Trade-offs`
- Do not chain into `superpowers:writing-plans`: `tasks.md` is the deliverable.
- Do not proceed to `openspec-apply-change` until every touched artifact is updated and `openspec validate <change>` is green.

## Implementation

- **Worktree** (`using-git-worktrees`) on every `openspec-apply-change`. Ask where: (a) **in-place** — current checkout, blocks main; (b) **sibling** at `../<project>-<change-id>/` or `../.worktrees/<change-id>/` — parallel-friendly. Default: sibling.
- **Subagent per task** (`subagent-driven-development`), two-stage review. A task is one `### Task N` group of `tasks.md` (Plan format), not a single checkbox. Use `executing-plans` only when I explicitly ask for human checkpoints.
- **Dispatch prompts.** Dispatched agents load the root `CLAUDE.md` themselves (as of Claude Code 2.1.x, Agent-tool subagents and Workflow agents alike), so its rules reach them as written; they do not read this file. Every dispatch prompt (`Task`/`Agent`/`general-purpose` invocations, `requesting-code-review` reviewers, `dispatching-parallel-agents` workers and Workflow-script agent prompts alike) MUST still open with the line in root `CLAUDE.md` > Dispatch prompts, which holds even if an agent type or a later Claude Code version does not load project instructions. When a prompt hands over a lifecycle step (drafting back-fill artifacts, an archive), put that step's rules from this file into the prompt.
- **Code review** (`requesting-code-review`) between tasks. Critical findings, as the root `CLAUDE.md` defines them, block progress.
- **Deviations from `design.md` decisions** during `openspec-apply-change` go back to `superpowers:brainstorming`, not forward. Defensible deviations (implementation surfaced a flaw in the original decision): update `design.md` `## Decisions` (`openspec-update-change`) BEFORE continuing — never silently ship.

## Hard rules (main session)

These apply to you in addition to the hard rules in the root `CLAUDE.md`.

- Never compact mid-task or while unsaved decisions live only in chat.
- Never edit an existing change's `proposal.md`, `design.md`, spec deltas or the wording of its `tasks.md` by hand. Revise them with `openspec-update-change`, which keeps the artifacts consistent with each other. Two things stay outside it: ticking `tasks.md` checkboxes, and the `### Task N` headings the `openspec-superpowers-tasks` script adds.
- Never let `superpowers:brainstorming` output land in `docs/plans/` or chat-only — every decision flows to OpenSpec artifacts before `openspec-apply-change`.
