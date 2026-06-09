# AGENTS.MD

Start of new conversation only: say hi + 1 motivating line. Do not greet on every reply within the same conversation/session.
Work style: telegraph; noun-phrases ok; drop grammar; min tokens.

## Telegram Notifications (always active)
Use `tg-send` + `tg-recv` to keep Bastian informed. Never stay silent on important events.

| Situation | Action |
|---|---|
| Tâche terminée | `tg-send "✅ [tâche]: terminé. [résumé 1 ligne]"` |
| Bloqué / attend une décision | `tg-send "⚠️ [contexte]: [question] — A) … B) …"` puis `decision=$(tg-recv)` |
| Erreur / problème nécessitant intervention | `tg-send "🔴 [contexte]: [erreur courte] — intervention requise"` puis `decision=$(tg-recv)` |
| Étape longue en cours (>2 min) | `tg-send "⏳ [tâche]: [étape en cours]…"` (pas de réponse attendue) |

Règles :
- Messages courts, télégraphiques — contexte + état + action requise (si besoin).
- **Toute interruption attendant un input de Bastian = obligatoire** : `tg-send` la question PUIS `tg-recv` pour bloquer jusqu'à sa réponse. Ne jamais continuer sans elle.
- Ne jamais staller silencieusement. Ne jamais improviser une décision qui appartient à Bastian.

## Agent Protocol
- Workspace: `~/projects`. Missing bastian110 repo: clone `https://github.com/steipete/<repo>.git`.
- 3rd-party/OSS (non-bastian110): clone under `~/projects/oss`.
- `~/Projects/manager`: private ops (domains/DNS, redirects/workers, runbooks).
- “MacBook” / “Rasberry” => SSH there; find hosts/IPs via `tailscale status`.
- Files: repo or `~/Projects/agent-scripts`.
- PRs: use `gh pr view/diff` (no URLs).
- “Make a note” => edit AGENTS.md (shortcut; not a blocker). Ignore `CLAUDE.md`.
- No `./runner`. Guardrails: use `trash` for deletes.
- Need upstream file: stage in `/tmp/`, then cherry-pick; never overwrite tracked.
- Bugs: add regression test when it fits.
- Keep files <~500 LOC; split/refactor as needed.
- Commits: Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- Subagents: read `docs/subagent.md`.
- Editor: `code <path>`.
- CI: `gh run list/view` (rerun/fix til green).
- Prefer end-to-end verify; if blocked, say what’s missing.
- New deps: quick health check (recent releases/commits, adoption).
- Slash cmds: `~/.codex/prompts/`.
- Web: search early; quote exact errors; prefer 2024–2025 sources; fallback Firecrawl (`pnpm mcp:*`) / `mcporter`.
- Style: telegraph. Drop filler/grammar. Min tokens (global AGENTS + replies).

## Screenshots (“use a screenshot”)
- Pick newest PNG in `~/Desktop` or `~/Downloads`.
- Verify it’s the right UI (ignore filename).
- Size: `sips -g pixelWidth -g pixelHeight <file>` (prefer 2×).
- Optimize: `imageoptim <file>` (install: `brew install imageoptim-cli`).
- Replace asset; keep dimensions; commit; run gate; verify CI.


## PR Feedback
- Active PR: `gh pr view --json number,title,url --jq '"PR #\\(.number): \\(.title)\\n\\(.url)"'`.
- PR comments: `gh pr view …` + `gh api …/comments --paginate`.
- Replies: cite fix + file/line; resolve threads only after fix lands.
- When merging a PR: thank the contributor in `CHANGELOG.md`.

## Flow & Runtime
- Use repo’s package manager/runtime; no swaps w/o approval.
- Use Codex/Claude background for long jobs; tmux only for interactive/persistent (debugger/server).

## Build / Test
- Before handoff: run full gate (lint/typecheck/tests/docs).
- CI red: `gh run list/view`, rerun, fix, push, repeat til green.
- Keep it observable (logs, panes, tails, MCP/browser tools).
- Release: read `docs/RELEASING.md` (or find best checklist if missing).
- Reminder: check `~/.profile` for missing env keys (e.g. `SPARKLE_PRIVATE_KEY_FILE`); Sparkle keys live in `~/Library/CloudStorage/Dropbox/Backup/Sparkle`.

## Git
- Safe by default: `git status/diff/log`. Push only when user asks.
- `git checkout` ok for PR review / explicit request.
- Branch changes require user consent.
- Destructive ops forbidden unless explicit (`reset --hard`, `clean`, `restore`, `rm`, …).
- Remotes under `~/Projects`: prefer HTTPS; flip SSH->HTTPS before pull/push.
- Commit helper on PATH: `committer` (bash). Prefer it; if repo has `./scripts/committer`, use that.
- Don’t delete/rename unexpected stuff; stop + ask.
- No repo-wide S/R scripts; keep edits small/reviewable.
- Avoid manual `git stash`; if Git auto-stashes during pull/rebase, that’s fine (hint, not hard guardrail).
- If user types a command (“pull and push”), that’s consent for that command.
- No amend unless asked.
- Big review: `git --no-pager diff --color=never`.
- Multi-agent: check `git status/diff` before edits; ship small commits.

## Language/Stack Notes
- Swift: use workspace helper/daemon; validate `swift build` + tests; keep concurrency attrs right.
- TypeScript: use repo PM; run `docs:list`; keep files small; follow existing patterns.

## macOS Permissions / Signing (TCC)
- Never re-sign / ad-hoc sign / change bundle ID as “debug” without explicit ok (can mess TCC).

## Critical Thinking
- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
- Leave breadcrumb notes in thread.

## Tools

Read `~/Projects/agent-scripts/tools.md` for the full tool catalog if it exists.

### committer
- Commit helper (PATH). Stages only listed paths; required here. Repo may also ship `./scripts/committer`.

### trash
- Move files to Trash: `trash …` (system command).

### bin/docs-list / scripts/docs-list.ts
- Optional. Lists `docs/` + enforces front-matter. Ignore if `bin/docs-list` not installed. Rebuild: `bun build scripts/docs-list.ts --compile --outfile bin/docs-list`.

### bin/browser-tools / scripts/browser-tools.ts
- Chrome DevTools helper. Cmds: `start`, `nav`, `eval`, `screenshot`, `pick`, `cookies`, `inspect`, `kill`.
- Rebuild: `bun build scripts/browser-tools.ts --compile --target bun --outfile bin/browser-tools`.

### gh
- GitHub CLI for PRs/CI/releases. Given issue/PR URL (or `/pull/5`): use `gh`, not web search.
- Examples: `gh issue view <url> --comments -R owner/repo`, `gh pr view <url> --comments --files -R owner/repo`.

### Slash Commands
- Global: `~/.codex/prompts/`. Repo-local: `docs/slash-commands/`.
- Common: `/handoff`, `/pickup`.

### tg-send (scripts/tg-send)
- Default: send text message: `tg-send "your message"`.
- Send file/media with flag: `tg-send --file <path>`, `--photo`, `--audio`, `--video`.
- Optional caption for media: `tg-send --photo img.png --caption "text"`.
- Requires env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- One media item at a time.
- **Interruptions**: use `tg-send` + `tg-recv` whenever a decision, question, or reflection is needed that blocks progress. Don't silently stall — send then wait. Pattern:
  ```bash
  tg-send "⚠️ [context]: [question] — options: A) … B) …"
  decision=$(tg-recv)   # blocks until reply
  # continue based on $decision
  ```

### tg-recv (scripts/tg-recv)
- Wait for next Telegram reply: `decision=$(tg-recv)`.
- Blocks until a message arrives from `TELEGRAM_CHAT_ID`; prints text to stdout.
- `--timeout <seconds>`: max wait (default 300s); exits 1 on timeout.
- Tracks offset in `/tmp/tg-recv-offset` — ignores messages sent before the call.
- Requires env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### tmux
- Use only when you need persistence/interaction (debugger/server).
- Quick refs: `tmux new -d -s codex-shell`, `tmux attach -t codex-shell`, `tmux list-sessions`, `tmux kill-session -t codex-shell`.

<frontend_aesthetics>
Avoid “AI slop” UI. Be opinionated + distinctive.

Do:
- Typography: pick a real font; avoid Inter/Roboto/Arial/system defaults.
- Theme: commit to a palette; use CSS vars; bold accents > timid gradients.
- Motion: 1–2 high-impact moments (staggered reveal beats random micro-anim).
- Background: add depth (gradients/patterns), not flat default.

Avoid: purple-on-white clichés, generic component grids, predictable layouts.
</frontend_aesthetics>