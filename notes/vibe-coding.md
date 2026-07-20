# Vibe coding (notes)

Short notes on three related Karpathy-era ideas, in order.

## 1. English as the hottest programming language

On **24 Jan 2023**, Andrej Karpathy posted:

> The hottest new programming language is English

- [X post](https://x.com/karpathy/status/1617979122625712128)
- [Quote Investigator](https://quoteinvestigator.com/2024/10/20/hottest-program/)

**Idea:** LLMs make natural language a practical way to specify program behavior (prompts as a kind of program), not that English replaces C/Python for everything.

He revisited this as Software 3.0 framing in [Software Is Changing (Again)](https://www.youtube.com/watch?v=LCEmiRjPEtQ) (YC AI Startup School, Jun 2025).

## 2. Vibe coding

On **2 Feb 2025**, Karpathy named a workflow:

> There's a new kind of coding I call "vibe coding", where you fully give in to the vibes, embrace exponentials, and forget that the code even exists.

- [X post](https://x.com/karpathy/status/1886192184808149383) ([archive](https://archive.ph/yNSTA))

**Idea:** Human *posture* toward AI coding — describe intent, accept diffs lightly, paste errors back, iterate by feel. Amusing and useful for throwaway / weekend projects; weak as a quality bar for production.

Lineage: same thread as “English is the programming language,” but focused on low-oversight *practice*, not the language abstraction alone.

## 3. Vibe coding vs agentic coding / engineering

| | **Vibe coding** | **Agentic coding / engineering** |
|--|-----------------|----------------------------------|
| Axis | Human review style | System shape + professional discipline |
| Core | Trust the vibes; skim or skip deep review | Agent loop (tools, edits, shell, observe, repeat) with retained quality bar |
| Floor / ceiling | Raises the *floor* (more people can build) | Raises the *ceiling* (faster without dropping security/quality) |
| Responsibility | Easy to outsource understanding | Still responsible for the software; understanding is the moat |

Karpathy later contrasted vibe coding with **agentic engineering** (preserve professional quality while using agents for speed):

- Video: [From Vibe Coding to Agentic Engineering w/ Stephanie Zhan](https://www.youtube.com/watch?v=96jN2OCOfLs) (Sequoia AI Ascent 2026)
- His notes: [Sequoia Ascent 2026 summary](https://karpathy.bearblog.dev/sequoia-ascent-2026/)

**One line:** vibe = attitude; agentic = tool-using loop (and, in Karpathy’s later usage, doing that *without* abandoning engineering standards). They overlap in practice; they are not opposites.
