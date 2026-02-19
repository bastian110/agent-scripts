---
name: send-via-telegram
description: >
  Use when you need to send a file to the user's phone via Telegram —
  e.g. after generating a report, export, screenshot, log, or any artifact
  the user needs to receive on mobile. Requires TELEGRAM_BOT_TOKEN and
  TELEGRAM_CHAT_ID env vars.
---

# send-via-telegram

Send files from this Mac to the user's phone via Telegram bot.

## Requirements

Two env vars in `~/.zprofile` (or equivalent):

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-xyz..."
export TELEGRAM_CHAT_ID="987654321"
```

> Get your chat ID: message your bot, then open
> `https://api.telegram.org/bot<TOKEN>/getUpdates` — look for `message.chat.id`.

## Usage

```bash
tg-send <file>
tg-send --caption "Build report 2026-02-19" build-report.pdf
```

Script lives at `~/Projects/agent-scripts/scripts/tg-send` (on PATH if
agent-scripts/scripts is in PATH, otherwise use full path).

## Quick Reference

| Goal | Command |
|------|---------|
| Send file silently | `tg-send report.zip` |
| Send with caption | `tg-send --caption "text" file.pdf` |
| Check env vars | `echo $TELEGRAM_BOT_TOKEN $TELEGRAM_CHAT_ID` |

## When to Use Proactively

- User says "send me the file" / "envoie-moi le fichier"
- Task produces an artifact the user will want on mobile (PDF, zip, log)
- End of a long background job — notify + send result

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing env var | `export TELEGRAM_BOT_TOKEN=...` in shell profile |
| Wrong chat ID | Use `getUpdates` to find correct `message.chat.id` |
| File path with spaces | Quote the path: `tg-send "my file.pdf"` |
| File > 50 MB | Telegram limit; compress or split first |
