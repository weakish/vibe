---
description: APM compile and project-local skills
---

## Skills

Always-on rules are an [APM](https://microsoft.github.io/apm/) package (`apm.yml`): source `.apm/instructions/*.instructions.md`. After editing them, run `apm install`, then `apm compile --target cursor --local-only --no-links --no-constitution` to regenerate Cursor rules and `AGENTS.md`. Cursor hooks are native (`.cursor/hooks.json`, `.cursor/hooks/`); APM does not manage them. In a monorepo, also follow project-local `AGENTS.md` and `.agents/skills/` when present.

User-level skills are not APM primitives and are not shipped in this package. When a task matches an installed user-level skill, read and follow it.
