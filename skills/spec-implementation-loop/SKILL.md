---
name: spec-implementation-loop
description: "Implement a spec through a repeatable loop: clarify behavior, build vertical TDD slices, review against the spec, fix findings test-first, simplify the implementation safely, and run a final spec review. Use when the user wants to implement a feature/spec/issue with review-fix-review and regression-safe simplification."
---

# Spec Implementation Loop

Use this skill to turn a written spec, issue, or PRD into a correct and simple implementation. The loop composes the existing `tdd`, `review`, and `codebase-design` skills.

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
- if `resume` sees a `running` step whose log was never created, it reports `stale` and suggests a `--fresh` resume command.
- default mode is `auto`; parent orchestrators should pass `--mode checkpoints` so they can supervise each child step.
- in checkpoint mode, each invocation runs at most one step and returns `status: "checkpoint"` with `nextStep` and `resumeCommand`.
- use `status --run <run-dir>` to inspect current state and recent log lines while a child step is running.
- default timeout is 30 minutes per child Pi; use `--timeout-ms 0` to disable.
- child Pi commands use `--approve` by default; use `--no-approve` to disable.

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

and inspect `status`, `currentStep`, `stepStatus`, `logPath`, and `lastLogLines`. If status is `checkpoint`, `needs_confirmation`, `failed`, `stale`, or `interrupted`, the parent should report or ask the user before resuming.

## Related skills to load

When executing this loop, load these skills as needed:

- `tdd` for behavior-first implementation and test-first fixes.
- `review` for reviewing changes against the spec and standards.
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

Use the `tdd` workflow. For each behavior, one at a time:

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

Use the `review` skill with the agreed fixed point.

Review axes:

- **Spec**: missing requirements, partial implementation, incorrect behavior, and scope creep.
- **Standards**: documented repo conventions only.

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

Run the `review` skill again from the same fixed point.

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
