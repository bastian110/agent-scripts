---
name: spec-implementation-loop
description: "Implement a spec through a repeatable loop: clarify behavior, build vertical TDD slices, review against the spec, fix findings test-first, simplify the implementation safely, and run a final spec review. Use when the user wants to implement a feature/spec/issue with review-fix-review and regression-safe simplification."
---

# Spec Implementation Loop

Use this skill to turn a written spec, issue, or PRD into a correct and simple implementation. The loop composes the current Matt Pocock `implement`, `tdd`, `code-review`, and `codebase-design` skills.

## Core rule

Correctness comes first, simplification comes second.

Never simplify while tests are red or while there are unresolved blocking spec findings.

## Default execution mode — use the runner

When the user asks to execute this skill, the default is the automated fresh-context runner.

You MUST use `scripts/spec-loop` when the user:

- asks to run this loop end-to-end,
- asks to implement a spec with this skill,
- mentions fresh context, child sessions, orchestration, or isolated steps,
- says “run the skill” without explicitly requesting manual execution.

Do not execute the phases manually in the parent session unless the user explicitly says “manual mode” or the runner is unavailable.

Before implementing code, resolve the runner path relative to this skill directory and verify it exists:

```bash
<skill-dir>/scripts/spec-loop help
```

For a Pi parent orchestrator, start in checkpoint mode so the parent regains control after every child step and can monitor child state:

```bash
<skill-dir>/scripts/spec-loop start \
  --mode checkpoints \
  --spec <path-or-url-or-text> \
  --base <git-ref> \
  --validation "<validation command>"
```

After each checkpoint, the parent should inspect status/logs, then launch the next step with the returned `resumeCommand` or an explicit `resume --step <nextStep>` command.

The runner command waits for its child step. If the parent harness has its own execution watchdog, set that watchdog above the runner timeout. When that cannot be guaranteed, launch the runner inside `tmux` and poll with `status`; do not let a harness hard-kill the runner before it can record its own timeout.

If the runner is unavailable or fails before creating a run, stop and report that. Ask the user whether to continue in manual mode. Do not silently fall back to manual execution.

The manual phases below are the fallback workflow and the conceptual contract for each child Pi step. They are not the default execution path.

## Inputs to collect

Before changing code, identify or ask for:

- **Spec source**: issue, PRD, markdown file, ticket, or pasted requirements.
- **Fixed point for review**: usually `main`, `origin/main`, or a commit SHA.
- **Validation commands**: tests, typecheck, lint, build.
- **Scope constraints**: what is explicitly out of scope.

If the user has not provided a spec or fixed point, ask. If validation commands are unclear, inspect the repo scripts and propose commands.

## Automated fresh-context runner

This skill includes a runner that can spawn a fresh Pi session for each loop step while preserving orchestration state on disk.

Use it when the user wants the loop automated or wants each step to run with a fresh context.

For parent-orchestrated runs, prefer checkpoint mode:

```bash
./scripts/spec-loop start \
  --mode checkpoints \
  --spec <path-or-url-or-text> \
  --base <git-ref> \
  --validation "pnpm test" \
  --validation "pnpm typecheck"
```

Use `auto` only when the user explicitly wants the runner to chain all steps without parent inspection.

The runner is designed for a Pi parent orchestrator:

- stdout is strict JSON only.
- runs are stored in the current project under `.pi/spec-loop-runs/<project-slug>-<short-uuid>/`.
- `.pi/spec-loop-runs/` is added to the current project's `.gitignore` automatically.
- each major loop step gets a deterministic persistent Pi session id.
- `03-review` and `04-fix` intentionally share the same `03-review-fix` Pi session so the fix step keeps the review findings and exploration in context while saving tokens.
- logs are created at step start and streamed while the child Pi runs; parsed child outputs are stored per step and attempt.
- if the runner is interrupted, it marks the current step `interrupted` when possible.
- every running child records its PID. `status` and `resume` verify that PID; a missing child is reported as `stale` even when its log exists.
- a stale step must be restarted with `--fresh`; never assume it is still progressing.
- default mode is `auto`; parent orchestrators should pass `--mode checkpoints` so they can supervise each child step.
- in checkpoint mode, each invocation runs at most one step and returns `status: "checkpoint"` with `nextStep` and `resumeCommand`.
- use `status --run <run-dir>` to inspect current state and recent log lines while a child step is running.
- default timeout is 25 minutes per child Pi, leaving time for a typical 30-minute parent harness to persist the timeout state; use `--timeout-ms 0` only in a persistent shell such as `tmux`.
- child Pi commands use `--approve` by default; use `--no-approve` to disable.
- each step has a budget of three child attempts per cycle by default; configure it at start with `--max-attempts <n>` (the legacy `--max-retries` alias remains supported).

Status and resume examples:

```bash
./scripts/spec-loop status --run .pi/spec-loop-runs/<run-id> --log-lines 80
./scripts/spec-loop resume --run .pi/spec-loop-runs/<run-id> --answer "Continue."
./scripts/spec-loop resume --run .pi/spec-loop-runs/<run-id> --step 03-review --fresh
./scripts/spec-loop resume --run .pi/spec-loop-runs/<run-id> --step 04-fix --answer "Reject finding 2; it is out of scope."
```

The runner controls the canonical order:

```txt
01-spec-intake → 02-implementation → 03-review → 04-fix → 05-simplification → 06-final-review
```

Session grouping:

```txt
01-spec-intake    → fresh session
02-implementation → fresh session
03-review         → shared 03-review-fix session
04-fix            → same 03-review-fix session
05-simplification → fresh session
06-final-review   → fresh session
```

Child Pi sessions must return JSON with one of:

```json
{"status":"completed","summary":"...","artifacts":["..."]}
{"status":"needs_confirmation","question":"...","recommendedAnswer":"...","summary":"..."}
{"status":"failed","reason":"...","summary":"..."}
```

If a child returns `needs_confirmation` or `failed`, the runner stops and returns a JSON object containing the run dir, current step, log path, and a resume command.

A Pi parent orchestrator must not assume the runner is still progressing silently. It should periodically run:

```bash
./scripts/spec-loop status --run .pi/spec-loop-runs/<run-id>
```

and inspect `status`, `currentStep`, `stepStatus`, `childPid`, `attempt`, `reason`, `logPath`, and `lastLogLines`. For `recoverable_error`, follow the recovery protocol below. For `checkpoint`, `needs_confirmation`, `failed`, `stale`, or `interrupted`, the parent should report or ask the user before resuming.

### Recoverable child failures

A child failure that leaves the persisted run valid produces `status: "recoverable_error"`, `recoverable: true`, exit code `0`, the current step and attempt, a distinct stable reason, bounded `stderr`/`diagnostic`, and the full `logPath`. This covers `child_exit_nonzero`, `child_error`, temporary provider errors, `timeout`, `interrupted`, `stale`, `child_json_parse_failed`, `child_result_invalid`, and `child_status_invalid`. Timeouts and interruptions are reported only after the child has stopped; stale recovery always uses a fresh session. The status command exposes the same diagnostic. This is runner-owned output; child Pi JSON must continue using only the three statuses above.

When the runner returns `recoverable_error`, the parent must:

1. Run `status` and verify that the current status is still `recoverable_error` for the same `currentStep`.
2. Verify that `childPid` is absent or no child process is alive. Never launch concurrent retries.
3. Execute the returned `resumeCommand` (or `resume --run <run-dir>`). It retries the same step, creates a new session, increments `attempt`, and keeps the working tree untouched.
4. Let the new child inspect the working tree first and preserve useful changes from the failed attempt.
5. When the configured attempt budget is exhausted, stop creating child sessions and return `needs_confirmation` with `reason: "retry_limit_reached"`, the consumed/maximum attempt counts, the last log and a recommendation to inspect its diagnostic. Ask the user before using the returned `--confirm` command for a manual attempt. Runner-integrity failures remain terminal and exit non-zero.

For `stale`, inspect the log, confirm the child PID is absent, then use the supplied `resumeCommand` with `--fresh`. Never resume a stale attempt in place: it would overwrite its log and hide the interruption.

## Related skills to load

When executing this loop, load these skills as needed:

- `implement` to drive implementation from the agreed spec or tickets.
- `tdd` for behavior-first implementation and test-first fixes.
- `code-review` for the parallel Standards and Spec review from the agreed fixed point.
- `codebase-design` before the simplification phase, especially to look for deep module opportunities, shallow pass-through modules, poor seam placement, or testability problems.

## Phase 1 — Translate spec into behaviors

Read the spec and produce a short behavior plan:

```md
## Behaviors to implement
1. ...
2. ...
3. ...

## Out of scope
- ...

## Public interface / user-visible surface
- ...

## Validation commands
- ...
```

Confirm this plan with the user before implementation unless they explicitly asked you to proceed autonomously.

Focus on observable behavior, not implementation steps.

## Phase 2 — Implement vertical slices

Use `implement` to drive the agreed work and the `tdd` workflow for each behavior, one at a time.

When the agreed changes include a user-interface modification, load the relevant Taste Skill before changing UI code. Choose it from the interface context: use `design-taste-frontend` for a design-led landing page, portfolio, or redesign; use `redesign-existing-projects` for focused improvements to an existing app or site. Apply it only to the planned UI scope; do not expand the spec.

```txt
RED: write one behavior test that fails
GREEN: implement the minimum code to pass
VERIFY: run the targeted test/validation command
```

Rules:

- One behavior at a time.
- Tests should use public interfaces and read like the spec.
- Do not write all tests first.
- Do not add speculative behavior.
- Do not refactor while red.

After all behaviors are implemented, run the full validation suite.

## Phase 3 — Review against the spec

Use the `code-review` skill with the agreed fixed point.

Review axes:

- **Spec**: missing requirements, partial implementation, incorrect behavior, and scope creep.
- **Standards**: documented repo conventions plus the skill's Fowler smell baseline; documented conventions override that baseline.

If no spec source can be found, stop and ask the user to provide one. Do not pretend to review against a spec from memory.

## Phase 4 — Fix review findings test-first

For each blocking or relevant finding:

```txt
RED: add or adjust a behavior test that exposes the finding
GREEN: fix the implementation
VERIFY: run targeted validation
```

Then run full validation and repeat the spec review.

Loop until there are no blocking spec findings:

```txt
Review → Findings → Tests → Fix → Validation → Review
```

If a finding is intentionally rejected, record why and ask the user to confirm.

## Phase 5 — Simplify without regression

Only enter this phase when:

- all tests pass,
- full validation passes,
- no blocking spec findings remain.

Load `codebase-design` and simplify in small steps.

Look for:

- duplicated logic,
- shallow pass-through modules,
- unnecessary branching,
- poor seam placement,
- large caller knowledge that could be hidden behind a smaller interface,
- tests coupled to implementation details,
- opportunities to deepen a module for better leverage and locality.

For each simplification:

```txt
REFACTOR SMALL: make one local simplification
VERIFY: run targeted tests
COMMIT MENTALLY: continue only if green
```

Rules:

- No behavior changes.
- No new spec behavior.
- Prefer deleting or concentrating complexity over layering abstractions.
- If a test fails, stop and diagnose whether the refactor changed behavior or the test was implementation-coupled.
- Keep simplification reversible and reviewable.

After simplification, run full validation.

## Phase 6 — Final review against the spec

Run the `code-review` skill again from the same fixed point.

Exit criteria:

```txt
[ ] Spec requirements implemented
[ ] No known blocking spec findings
[ ] No unintended scope creep
[ ] Full validation passes
[ ] Implementation has been simplified under green tests
[ ] Any accepted tradeoffs are documented for the user
```

## Final response format

Report concisely:

```md
## Implemented
- ...

## Reviewed against spec
- Fixed point: ...
- Spec source: ...
- Findings fixed: ...
- Remaining findings: ...

## Simplified
- ...

## Validation
- `command`: pass/fail
```

If work stops early, say exactly which phase stopped and why.
