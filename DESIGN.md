# Midnight Idle Clone — Design Doc

Living document. Edit freely, commit changes alongside code.

## Core Loop
Gather resources (wood, food) → manage energy (actions cost it, eating restores
it) and health (drains once energy is empty) → milestone events unlock new
options (e.g. shelter) → build/craft → risk-based actions (hunting, events) →
cycle ends (death) → choose a permanent bonus (+1 max energy or +1 max health)
→ start the next cycle, stronger and with more options unlocked.

## Tech Stack
Vanilla HTML / CSS / JS. No frameworks, no build tools. Hosted on GitHub Pages
or itch.io. Repo: mephice1/Idle-game-clone.

## Systems Status

Grouped by status so you don't have to hunt through a table for it.

### ✅ Done
- **Wood gathering** — click-based (Gather Wood), costs energy per click
- **Food gathering** — click-based (Gather Food), costs energy per click
- **Eating** — spends food to restore energy; the one action that never costs energy itself
- **Energy economy** — actions cost energy directly, no passive drain over time; shelter and temperature multiply that cost
- **Health decay** — once energy hits 0, health drains on a 1-second tick until death
- **Death & run summary** — death screen reports total wood/food gathered and run duration for that cycle
- **Pause** — stops the tick, freezes run duration, disables every action until Resume
- **Milestone events** — one-time popups triggered by run conditions (e.g. reaching 10 wood); pause the game and grant a permanent unlock
- **Shelter (simple tier)** — buildable action (wood + energy cost) once unlocked via the wood-10 milestone; reduces action energy costs for the rest of that cycle. The unlock is permanent, but the shelter itself has to be rebuilt every new cycle
- **Temperature modifier** — cold/comfortable state multiplies action energy costs
- **Meta-progression / cycles** — dying offers a choice of +1 max energy or +1 max health, permanent across all future cycles; cycle counter and a "reset all progression" option available from both the pause and death screens

### 🔧 In Progress / Partial
- **Shelter tiers** — only "simple" (tier 1) is reachable through real gameplay; "good" shelter (tier 2) exists in the multiplier tables and the debug dropdown, but nothing in-game unlocks it yet
- **Temperature** — the cost multiplier exists, but nothing drives it during real play yet (debug toggle only) — no day/night, season, or location system sets it
- **Choice-based events** — the milestone system is a first version of this (a pop-up that pauses the game and applies an effect), but it's a single message + permanent reward so far, not yet a branching multi-option choice

### 📋 Planned / Not Started
- **Fire** — previously listed as Done here, which was stale; there's no fire mechanic in the code. Worth deciding whether it still fits now that energy is action-cost-based rather than tick-based
- **Crafting** — axe (wood rate+), spear (enables hunting)
- **Hunting** — risk/reward, needs spear
- **Skills** — passive bonuses from repeated actions
- **Run randomization** — event pool variance for replayability

## Open Design Questions
- Now that actions cost energy directly instead of a passive per-second drain,
  run/cycle duration no longer reflects difficulty or pressure on its own. How
  should later cycles feel different from earlier ones — escalating costs, or
  content unlocks (à la the milestone system), or something else? (Leaning
  toward unlock-based progression over raw scaling — not decided.)
- Combat: in or out? (Decided: build core loop first, decide later.)
- What other death triggers might exist beyond running out of energy/health —
  events, combat, something else?

## Discarded / Changed Ideas
- Originally planned fire complexity (refill mechanics, burn timing) before
  the survival loop existed — reordered to build hunger/death first since
  fire without stakes wasn't "a game" yet.
- Hunger/health decay was originally a passive per-second timer, with rate
  modified by shelter/temperature. Replaced with an energy-cost model where
  actions themselves cost energy (still modified by shelter/temperature),
  and health only starts draining once energy has been spent down to 0.
  Simpler mental model, and makes "+1 max energy" cycle bonuses feel more
  meaningful — more actions per cycle, not just "survive slightly longer."
- Renamed "hunger" to "energy" throughout the code and UI — "hunger" implied
  a passive state, "energy" better fits a value the player actively spends.

## Notes for Claude Code sessions
When starting a new feature branch, reference this doc for current system
status and open questions before scaffolding new code.
