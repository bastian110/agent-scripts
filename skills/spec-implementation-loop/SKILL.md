---
name: spec-implementation-loop
description: "Implement a spec through a repeatable loop: clarify behavior, build vertical TDD slices, review against the spec, fix findings test-first, simplify the implementation safely, and run a final spec review. Use when the user wants to implement a feature/spec/issue with review-fix-review and regression-safe simplification."
---

# Spec Implementation Loop

Use this skill to turn a written spec, issue, or PRD into a correct and simple implementation. The loop composes the existing `tdd`, `review`, and `codebase-design` skills.

## Core rule

Correctness comes first, simplification comes second.

Never simplify while tests are red or while there are unresolved blocking spec findings.

## Inputs to collect

Before changing code, identify or ask for:

- **Spec source**: issue, PRD, markdown file, ticket, or pasted requirements.
- **Fixed point for review**: usually `main`, `origin/main`, or a commit SHA.
- **Validation commands**: tests, typecheck, lint, build.
- **Scope constraints**: what is explicitly out of scope.

If the user has not provided a spec or fixed point, ask. If validation commands are unclear, inspect the repo scripts and propose commands.

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
