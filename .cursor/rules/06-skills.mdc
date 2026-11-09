---
description: User-level skills and when to compile instructions
---

## Skills

Always-on rules are an [APM](https://microsoft.github.io/apm/) package (`apm.yml`): source `.apm/instructions/*.instructions.md`. After editing them, run `apm install`, then `apm compile --target cursor --local-only --no-links --no-constitution` to regenerate Cursor rules and `AGENTS.md`. Cursor hooks are native (`.cursor/hooks.json`, `.cursor/hooks/`); APM does not manage them. In a monorepo, also follow project-local `AGENTS.md` and `.agents/skills/` when present.

User-level skills live in `skills/<name>/SKILL.md`. They are not APM primitives. Install by copying each directory to `~/.agents/skills/<name>/` (Cursor and Grok Build both load that path). When a task matches a skill description, read and follow that `SKILL.md`. **Before any commit**, read `skills/git-commits/SKILL.md` even if the user did not mention commits. After editing a skill, copy it to `~/.agents/skills/` again.

| Skill | Path |
|-------|------|
| Git commits and trailers | `skills/git-commits/SKILL.md` |
| Review one commit; fix after selection | `skills/review/SKILL.md` |
| Herdr (only when the user asks) | `skills/herdr/SKILL.md` |
