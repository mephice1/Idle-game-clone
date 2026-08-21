# Midnight Idle Clone — Design Doc

Living document. Edit freely, commit changes alongside code.

## Core Loop
Gather resources (wood, food) → survive (hunger/health) → build/craft → risk-based
actions (hunting, events) → run ends (death) → spend earned currency on permanent
upgrades → start new run, stronger and with more options.

## Tech Stack
Vanilla HTML / CSS / JS. No frameworks, no build tools. Hosted on GitHub Pages
or itch.io. Repo: mephice1/Idle-game-clone.

## Systems Status

| System | Status | Notes |
|---|---|---|
| Wood/food gathering | Done | Click-based counters |
| Fire (build/fuel/timer) | Done | May simplify later — currently two-timer complexity |
| Hunger/health decay + death | In progress | Branch: see current branch name |
| Shelter | Planned | Wood sink, reduces hunger/cold decay |
| Cold / hunger modifiers | Planned (next) | Branch: hunger-modifiers |
| Crafting | Planned | Axe (wood rate+), spear (enables hunting) |
| Hunting | Planned | Risk/reward, needs spear |
| Skills | Planned | Passive bonuses from repeated actions |
| Choice-based events | Planned | Text popups, 2–4 options, branching |
| Prestige / meta-progression | Planned | Currency earned per run, permanent upgrades |
| Run randomization | Planned | Event pool variance for replayability |

## Open Design Questions
- Does the "find food" button unlock reset each cycle, or is it a permanent
  meta-unlock once discovered?
- Combat: in or out? (Decided: build core loop first, decide later.)
- What's the death trigger primarily — hunger-starvation only, or also cold /
  events / combat later?

## Discarded / Changed Ideas
- Originally planned fire complexity (refill mechanics, burn timing) before
  the survival loop existed — reordered to build hunger/death first since
  fire without stakes wasn't "a game" yet.

## Notes for Claude Code sessions
When starting a new feature branch, reference this doc for current system
status and open questions before scaffolding new code.
