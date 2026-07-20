# Syntax highlighting (and readable layout) for shell commands in CLI approval prompts

**Category:** Feature Requests  
**Tags:** `cli`, `terminal`, `approvals`

## Problem

When Cursor CLI asks me to approve a shell command, the pending command is hard to review when it’s long, chained (`&&` / `|` / subshells), or embeds another language (e.g. `python -c '…'` or a multi-line script).

Today the confirmation UI is effectively a wall of plain text. Flags, strings, pipes, and nested script bodies don’t stand out, so it’s easy to miss something risky or approve the wrong thing under time pressure.

This matters most for the **approval gate** — the one place where I’m supposed to carefully read what will run on my machine.

## Desired behavior

1. **Syntax-highlight** the pending shell command in the CLI approval prompt (bash/zsh-style highlighting for the outer command).
2. When the payload is clearly another language (e.g. `python`, `node`, heredoc body), highlight that body with the appropriate grammar if feasible.
3. For long / multi-line commands: preserve newlines and wrap cleanly (not one mangled line), with a clear visual boundary around the command block.
4. Optional but useful: a key to expand / open the pending command in `$EDITOR`, or an on-demand **Explain** (what runs, order of operations, risk notes) without leaving the approval flow.

## Why this matters

- Approval is a safety review, not just a y/n speed bump.
- Long agent-generated one-liners and inline scripts are common; plain text is a poor format for that review.
- Conversation code blocks already get highlighting; the approval prompt should match that bar for the text you’re about to authorize.

## Prior art / related

- **Gemini CLI** highlights shell in the confirmation UI (`colorizeCode` / bash) and formats multiline commands for readability.
- **Claude Code** still shows plain text in permission prompts (same complaint upstream), but offers **Ctrl+E** for an on-demand command explanation + risk label.
- Cursor Desktop intentionally moved agent shell display to a lighter monochrome renderer for performance (~2.4.14) — fair for streaming UI, but the **CLI approval prompt** is a discrete, low-frequency surface where readability should win over minimal rendering.
- Related forum threads: [shell/command colors gone (Desktop)](https://forum.cursor.com/t/cursor-2-5-why-shell-command-colors-are-gone/152144), [Add “Explain” to shell approval](https://forum.cursor.com/t/add-explain-to-shell-command-approval-run-once-allow-skip/161730). This request is specifically about **CLI confirmation rendering** (and nested-script readability), not Desktop ANSI output.

## Environment

- Product: Cursor CLI (`cursor-agent`)
- OS: macOS
- Typical failing cases: long pipelines; `python -c` / inline scripts; multi-line shell

## Workaround today

Reject and ask the agent to rewrite as a short command + a file I can open with highlighting, or paste the command into another chat for a breakdown. That breaks flow.

Happy to provide screenshots of a couple of hard-to-review approval prompts if useful.

---

Drafted by Cursor Grok 4.5.
