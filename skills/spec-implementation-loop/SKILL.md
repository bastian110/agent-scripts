---
name: spec-implementation-loop
description: "Implement a written spec interactively in the current Pi session: clarify observable behavior, build vertical slices, validate, review against the spec and repository standards, fix findings, simplify safely, and run a final review. Use for feature specs, issues, PRDs, and review-fix-review implementation work."
---
 
# Spec Implementation Loop
 
Implement a written spec correctly, then simplify the result without changing behavior.
 
Run the entire workflow interactively in the current Pi session. Do not start child Pi sessions, use an orchestration runner, or persist a workflow state machine.
 
## Core policy
 
1. Correctness before simplification.
2. Observable behavior before implementation details.
3. One vertical slice at a time.
4. Never refactor while tests or required validations are failing.
5. Review the complete workspace change, not only committed changes.
6. Preserve unrelated user changes and never discard the working tree.
 
## 1. Establish the contract
 
Before changing code, identify:
 
- **Spec source**: issue, PRD, Markdown file, ticket, or pasted requirements.
- **Review base**: normally `main`, `origin/main`, or a commit SHA.
- **Validation commands**: relevant tests, typecheck, lint, and build.
- **Scope constraints**: explicitly excluded behavior.
 
Verify that the review base resolves. Record the initial `git status --short` so pre-existing changes remain distinguishable from this implementation.
 
If the spec or review base is missing, ask for it. If validations are unclear, inspect the repository and propose them.
 
Translate the spec into a concise behavior plan:
 
```md
## Behaviors
1. ...
2. ...
 
## Out of scope
- ...
 
## User-visible or public interface
- ...
 
## Validation
- `...`
 
## Assumptions
- ...
```
 
Ask the user to confirm the plan before implementation unless they explicitly requested autonomous execution. Ask only about ambiguities that materially affect behavior, scope, data, compatibility, or safety; record reasonable non-blocking assumptions and continue.
 
## 2. Implement vertical slices
 
Implement one behavior at a time through the public or user-visible interface.
 
For each behavior:
 
1. Add or update a behavior test when it provides useful protection.
2. For a bug, add a regression test when practical.
3. Implement the smallest complete change.
4. Run the narrowest relevant validation.
5. Continue only when the slice is green.
 
Do not add speculative behavior or refactor unrelated code. Load a relevant design skill before planned user-interface work, but do not expand the visual scope beyond the spec.
 
After all slices, run the full agreed validation suite.
 
## 3. Review and fix
 
Review the implementation along two separate axes:
 
### Spec
 
Check for:
 
- missing or partial requirements;
- incorrect observable behavior;
- unhandled specified edge cases;
- unintended scope creep.
 
### Standards
 
Check the repository instructions and conventions for:
 
- correctness and error handling;
- maintainability and unnecessary complexity;
- tests coupled to implementation details;
- duplicated logic or poor module seams;
- security or compatibility regressions.
 
The review scope must include:
 
- committed changes since the review base;
- staged changes;
- unstaged changes;
- relevant untracked files.
 
Do not rely exclusively on `git diff <base>...HEAD`, because it omits uncommitted implementation work. Compare the review base with the current workspace and inspect `git status --short` for untracked files.
 
For each blocking finding:
 
1. Add or adjust a test when useful to expose it.
2. Fix the implementation.
3. Run targeted validation.
 
Then run full validation and repeat the review until no blocking spec finding remains. If a finding should be rejected, explain why and ask the user to confirm the tradeoff.
 
## 4. Simplify under green validations
 
Enter this phase only when full validation passes and no blocking spec finding remains.
 
Load `codebase-design` when available. Look for:
 
- removable duplication or branching;
- shallow pass-through modules;
- misplaced seams;
- caller knowledge that can be hidden behind a smaller interface;
- abstractions unsupported by a real requirement.
 
Make one small, behavior-preserving simplification at a time and rerun relevant tests after each change. Prefer deletion and concentration of complexity over additional abstraction. Finish by running the full validation suite.
 
## 5. Final review
 
Review the same complete workspace against the same spec and review base.
 
Exit only when:
 
- all requirements are implemented;
- no known blocking spec finding remains;
- no unintended scope creep remains;
- full validation passes;
- simplification preserved behavior;
- accepted tradeoffs are documented.
 
## Final response
 
```md
## Implemented
- ...
 
## Reviewed
- Spec: ...
- Base: ...
- Findings fixed: ...
- Remaining findings or tradeoffs: ...
 
## Simplified
- ...
 
## Validation
- `command`: pass/fail
```
 
If work stops early, state the phase, the blocker, and the exact decision or input needed from the user.