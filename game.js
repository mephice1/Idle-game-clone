// Base max values before any meta-progression bonuses are applied.
// See getMaxEnergy()/getMaxHealth() below for the values actually used
// in gameplay.
const BASE_MAX_ENERGY = 10;
const BASE_MAX_HEALTH = 10;

// ======================================================================
// metaProgression persists ACROSS death cycles, unlike gameState which
// gets wiped every time startNewRun() runs. It lives in its own object,
// separate from gameState, for exactly that reason - keeping it out of
// the object that gets reset makes it impossible to accidentally lose
// progression by resetting gameState.
// ======================================================================
let metaProgression = {
  bonusHealth: 0,
  bonusEnergy: 0,
  cycleCount: 1,

  // Ids of one-time milestone events already triggered, ever - see the
  // MILESTONES list and checkMilestones() further down. Once an id is in
  // here, that milestone can never fire again, in this cycle or any future one.
  unlockedMilestoneIds: [],

  // Permanently unlocks the "Build Simple Shelter" action once the wood-10
  // milestone has been seen. This only reveals the option - the player
  // still has to spend wood on it fresh every cycle (see buildSimpleShelter).
  shelterUnlocked: false,
};

// ----------------------------------------------------------------------
// getMaxEnergy / getMaxHealth: the actual caps used during gameplay -
// the base value plus whatever permanent bonuses have been earned by
// surviving previous cycles. Called wherever a max value is needed so
// they always reflect the latest metaProgression.
// ----------------------------------------------------------------------
function getMaxEnergy() {
  return BASE_MAX_ENERGY + metaProgression.bonusEnergy;
}

function getMaxHealth() {
  return BASE_MAX_HEALTH + metaProgression.bonusHealth;
}

// ======================================================================
// gameState holds every piece of data that describes the current run.
// Keeping it all in one object makes it easy to reset everything at once
// when the player starts a new run (see startNewRun below).
// ======================================================================
let gameState = {
  wood: 0,
  food: 0,

  // Survival stats. Both start full and are clamped between 0 and their maximum values.
  energy: getMaxEnergy(),
  health: getMaxHealth(),

  // Lifetime counters for the death screen summary. These only ever go
  // UP, even though "wood" and "food" above go down as they're spent.
  totalWoodGathered: 0,
  totalFoodGathered: 0,

  // Timestamp (in ms) the current run began, used to work out run length.
  runStartTime: Date.now(),

  // True once health has hit 0. Used to stop timers and lock out actions.
  isDead: false,

  // Modifiers that will eventually be set by real shelter/temperature
  // systems. For now they're driven by the debug controls further down.
  shelterLevel: 0,  // 0 = none, 1 = simple, 2 = good
  temperature: 0,   // 0 = cold, 1 = comfortable

  // Pause state. pauseStartTime/totalPausedMs let the run duration shown
  // on the pause/death screens exclude time spent paused.
  isPaused: false,
  pauseStartTime: null,
  totalPausedMs: 0,
};

// The interval timer for the health-decay tick lives outside gameState
// because it's not "game data" - it's a handle we need to be able to
// cancel with clearInterval(). Storing it in gameState would just mean
// accidentally saving/serializing something that isn't real state.
let survivalTimerId = null;

// How often (ms) the tick runs. Energy no longer drains passively over
// time - it's only ever spent by actions (see spendEnergy below) - so
// this interval now exists purely to drain health once energy hits 0,
// and to keep the run-duration display live.
const TICK_INTERVAL_MS = 1000;
const HEALTH_LOSS_PER_TICK = 1;

// Cost/benefit of eating food.
const EAT_FOOD_COST = 5;
const EAT_FOOD_ENERGY_RESTORE = 2;

// Base energy cost of gathering/building actions, before shelter/temperature
// multipliers. Eating is deliberately the one exception - it's the
// player's way back up, so it only ever restores energy, never costs it.
const GATHER_WOOD_ENERGY_COST = 0.3;
const GATHER_FOOD_ENERGY_COST = 0.2;
const SHELTER_BUILD_ENERGY_COST = 1;

// Multipliers applied to action energy costs based on the player's
// current shelter and temperature. Below 1.0 = cheaper actions,
// above 1.0 = more expensive. Indexed/keyed by the matching gameState value.
const SHELTER_COST_MULTIPLIERS = [1.0, 0.6, 0.3]; // [none, simple, good]
const TEMPERATURE_COST_MULTIPLIERS = { 0: 1.4, 1: 1.0 }; // { cold, comfortable }

// Cost of the real "Build Simple Shelter" action (as opposed to the
// debug shelter dropdown), once unlocked via the wood-10 milestone.
const SHELTER_BUILD_WOOD_COST = 20;

// ----------------------------------------------------------------------
// getActionCostMultiplier: combines the active shelter/temperature
// multipliers into one number, applied to every action's base energy
// cost. Called fresh each time so it always reflects the latest gameState.
// ----------------------------------------------------------------------
function getActionCostMultiplier() {
  const shelterMultiplier = SHELTER_COST_MULTIPLIERS[gameState.shelterLevel];
  const temperatureMultiplier = TEMPERATURE_COST_MULTIPLIERS[gameState.temperature];
  return shelterMultiplier * temperatureMultiplier;
}

// ----------------------------------------------------------------------
// spendEnergy: deducts an action's energy cost (after multipliers),
// floored at 0. Deliberately never blocks the action itself - energy
// just bottoms out at 0 rather than going negative or requiring the
// caller to check affordability first. That's what lets the player keep
// acting (and clawing energy back via eatFood) even at 0 energy, instead
// of being instantly locked out once they can't "afford" to act.
// ----------------------------------------------------------------------
function spendEnergy(baseCost) {
  const cost = baseCost * getActionCostMultiplier();
  gameState.energy = Math.max(0, gameState.energy - cost);
}

// ======================================================================
// MILESTONES: one-time events that can fire during a run when their
// condition becomes true. Each fires at most once ever (tracked in
// metaProgression.unlockedMilestoneIds, which survives cycles), applies
// its reward permanently, and pauses the game with an explanatory
// message until the player clicks Continue. Add more entries here to
// add more milestones - checkMilestones() handles the rest generically.
// ======================================================================
const MILESTONES = [
  {
    id: 'wood-10',
    condition: (state) => state.totalWoodGathered >= 10,
    message: "You've gathered 10 wood and realize you could build a simple shelter to slow " +
      "your energy drain. A new action is now available - it'll cost " + SHELTER_BUILD_WOOD_COST +
      " wood to build, and you'll need to do it again each cycle.",
    reward: () => {
      metaProgression.shelterUnlocked = true;
    },
  },
];

// ----------------------------------------------------------------------
// checkMilestones: looks for any not-yet-unlocked milestone whose
// condition is now true. Only checks while the game is actually running
// (not dead, not already paused/showing a popup) so it can't fire twice
// or interrupt the death/pause flow. Called from render(), which already
// runs after every state-changing action.
// ----------------------------------------------------------------------
function checkMilestones() {
  if (gameState.isDead || gameState.isPaused) return;

  for (const milestone of MILESTONES) {
    const alreadyUnlocked = metaProgression.unlockedMilestoneIds.includes(milestone.id);
    if (!alreadyUnlocked && milestone.condition(gameState)) {
      triggerMilestone(milestone);
      return; // one popup at a time - any others wait for the next check
    }
  }
}

// ----------------------------------------------------------------------
// triggerMilestone: marks the milestone as permanently unlocked, applies
// its reward, then pauses the game (reusing the same isPaused mechanism
// as pauseGame - stops the tick, freezes run duration) and shows the
// milestone popup instead of the plain pause popup.
// ----------------------------------------------------------------------
function triggerMilestone(milestone) {
  metaProgression.unlockedMilestoneIds.push(milestone.id);
  milestone.reward();

  gameState.isPaused = true;
  gameState.pauseStartTime = Date.now();

  clearInterval(survivalTimerId);
  survivalTimerId = null;

  updateButtonStates();

  document.getElementById('milestone-message').textContent = milestone.message;
  document.getElementById('milestone-screen').classList.remove('hidden');
}

// ----------------------------------------------------------------------
// gatherWood: simple click action. Adds 1 wood to the player's current
// stockpile AND to the lifetime counter (which never decreases), then
// refreshes the on-screen numbers.
// ----------------------------------------------------------------------
function gatherWood() {
  if (gameState.isDead) return;

  gameState.wood += 1;
  gameState.totalWoodGathered += 1;
  spendEnergy(GATHER_WOOD_ENERGY_COST);

  render();
}

// ----------------------------------------------------------------------
// gatherFood: same idea as gatherWood, but for food.
// ----------------------------------------------------------------------
function gatherFood() {
  if (gameState.isDead) return;

  gameState.food += 1;
  gameState.totalFoodGathered += 1;
  spendEnergy(GATHER_FOOD_ENERGY_COST);

  render();
}

// ----------------------------------------------------------------------
// buildSimpleShelter: spends wood (and some energy - building takes
// effort too) to raise shelterLevel to 1 for the CURRENT run only -
// shelterLevel is part of gameState, not metaProgression, so it resets
// next cycle and has to be built again. Only usable once the wood-10
// milestone has unlocked it. The button itself enforces these same
// checks (see updateButtonStates), but they're re-checked here too so
// the function is safe to call from anywhere.
// ----------------------------------------------------------------------
function buildSimpleShelter() {
  const canAfford = gameState.wood >= SHELTER_BUILD_WOOD_COST;
  const alreadyBuilt = gameState.shelterLevel >= 1;

  if (gameState.isDead || !metaProgression.shelterUnlocked || !canAfford || alreadyBuilt) return;

  gameState.wood -= SHELTER_BUILD_WOOD_COST;
  gameState.shelterLevel = 1;
  spendEnergy(SHELTER_BUILD_ENERGY_COST);

  render();
}

// ----------------------------------------------------------------------
// eatFood: spends food to restore energy.
// The button itself gets disabled when this isn't a legal move (see
// updateButtonStates), but we re-check the conditions here too so the
// function is safe to call from anywhere, not just a click handler.
// ----------------------------------------------------------------------
function eatFood() {
  const canAfford = gameState.food >= EAT_FOOD_COST;
  const needsEnergy = gameState.energy < getMaxEnergy();

  if (gameState.isDead || !canAfford || !needsEnergy) return;

  gameState.food -= EAT_FOOD_COST;

  // Math.min caps energy at its max even if the restore amount would push it over.
  gameState.energy = Math.min(getMaxEnergy(), gameState.energy + EAT_FOOD_ENERGY_RESTORE);

  render();
}

// ----------------------------------------------------------------------
// tickSurvival: runs automatically every TICK_INTERVAL_MS. Energy no
// longer drains here - it's only ever spent by actions (see spendEnergy).
// This just drains health once energy has been spent down to 0, and
// otherwise re-renders so the run-duration display stays live.
// ----------------------------------------------------------------------
function tickSurvival() {
  if (gameState.energy <= 0) {
    gameState.health = Math.max(0, gameState.health - HEALTH_LOSS_PER_TICK);

    if (gameState.health <= 0) {
      triggerDeath();
      return;
    }
  }

  render();
}

// ----------------------------------------------------------------------
// triggerDeath: fires once when health reaches 0. Ends the run:
// stops the survival timer, locks out every action button, and shows
// the death screen with a summary of the run that just ended.
// ----------------------------------------------------------------------
function triggerDeath() {
  gameState.isDead = true;

  clearInterval(survivalTimerId);
  survivalTimerId = null;

  render();
  updateButtonStates();
  showDeathScreen();
}

// ----------------------------------------------------------------------
// debugKillInstantly: testing shortcut for the death/cycle flow without
// waiting for energy and health to actually drain out. No-op if already
// dead or paused (same guard triggerDeath itself doesn't need, since it
// only ever gets called once energy/health naturally reach 0).
// ----------------------------------------------------------------------
function debugKillInstantly() {
  if (gameState.isDead || gameState.isPaused) return;

  gameState.energy = 0;
  gameState.health = 0;

  triggerDeath();
}

// ----------------------------------------------------------------------
// pauseGame: stops the survival tick without ending the run, and shows
// the pause popup. No-op if already dead or already paused.
// ----------------------------------------------------------------------
function pauseGame() {
  if (gameState.isDead || gameState.isPaused) return;

  gameState.isPaused = true;
  gameState.pauseStartTime = Date.now();

  clearInterval(survivalTimerId);
  survivalTimerId = null;

  updateButtonStates();
  showPauseScreen();
}

// ----------------------------------------------------------------------
// resumeGame: the reverse of pauseGame/triggerMilestone. Adds however
// long this pause lasted onto the running total (so it can be excluded
// from run duration elsewhere), then restarts the tick. Hides both
// overlays that could have caused the pause - only one is ever actually
// visible, so hiding the other is harmless.
// ----------------------------------------------------------------------
function resumeGame() {
  if (!gameState.isPaused) return;

  gameState.totalPausedMs += Date.now() - gameState.pauseStartTime;
  gameState.pauseStartTime = null;
  gameState.isPaused = false;

  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('milestone-screen').classList.add('hidden');

  updateButtonStates();
  startSurvivalTimer();
}

// ----------------------------------------------------------------------
// getRunDurationSeconds: how long the current run has actually been
// played, in seconds - total elapsed time minus any time spent paused
// (including whatever pause is currently in progress, if any). Shared
// by the pause popup and the death screen so both agree on "duration".
// ----------------------------------------------------------------------
function getRunDurationSeconds() {
  const currentPauseMs = gameState.isPaused ? Date.now() - gameState.pauseStartTime : 0;
  const pausedMs = gameState.totalPausedMs + currentPauseMs;
  return Math.floor((Date.now() - gameState.runStartTime - pausedMs) / 1000);
}

// ----------------------------------------------------------------------
// showPauseScreen: fills in the pause popup's duration readout and
// makes it visible by removing the "hidden" class.
// ----------------------------------------------------------------------
function showPauseScreen() {
  document.getElementById('pause-time').textContent = getRunDurationSeconds();
  document.getElementById('pause-screen').classList.remove('hidden');
}

// ----------------------------------------------------------------------
// showDeathScreen: fills in the death screen's summary stats and makes
// it visible by removing the "hidden" class (see style.css).
// ----------------------------------------------------------------------
function showDeathScreen() {
  document.getElementById('death-wood').textContent = gameState.totalWoodGathered;
  document.getElementById('death-food').textContent = gameState.totalFoodGathered;
  document.getElementById('death-time').textContent = getRunDurationSeconds();

  document.getElementById('death-screen').classList.remove('hidden');
}

// ----------------------------------------------------------------------
// updateButtonStates: enables/disables buttons based on current rules.
// Called after every state change so the UI never shows a button as
// clickable when the action isn't actually legal.
// ----------------------------------------------------------------------
function updateButtonStates() {
  const gatherWoodBtn = document.getElementById('gather-wood-btn');
  const gatherFoodBtn = document.getElementById('gather-food-btn');
  const eatFoodBtn = document.getElementById('eat-food-btn');
  const buildShelterBtn = document.getElementById('build-shelter-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const shelterSelect = document.getElementById('debug-shelter-select');
  const tempToggleBtn = document.getElementById('debug-temp-toggle');
  const killBtn = document.getElementById('debug-kill-btn');

  // The shelter-building button only exists in the UI at all once its
  // milestone has been seen - this is independent of dead/paused, so it's
  // handled before either of those branches.
  buildShelterBtn.classList.toggle('hidden', !metaProgression.shelterUnlocked);

  // Once dead, every action button is disabled - the run is over.
  if (gameState.isDead) {
    gatherWoodBtn.disabled = true;
    gatherFoodBtn.disabled = true;
    eatFoodBtn.disabled = true;
    buildShelterBtn.disabled = true;
    pauseBtn.disabled = true;
    shelterSelect.disabled = true;
    tempToggleBtn.disabled = true;
    killBtn.disabled = true;
    return;
  }

  // While paused, everything disables too (including the debug controls) -
  // the whole page is effectively frozen until Resume is clicked.
  if (gameState.isPaused) {
    gatherWoodBtn.disabled = true;
    gatherFoodBtn.disabled = true;
    eatFoodBtn.disabled = true;
    buildShelterBtn.disabled = true;
    pauseBtn.disabled = true;
    shelterSelect.disabled = true;
    tempToggleBtn.disabled = true;
    killBtn.disabled = true;
    return;
  }

  gatherWoodBtn.disabled = false;
  gatherFoodBtn.disabled = false;
  pauseBtn.disabled = false;
  shelterSelect.disabled = false;
  tempToggleBtn.disabled = false;
  killBtn.disabled = false;

  // Building is only allowed if the player can afford it AND hasn't
  // already built one this run (shelterLevel resets to 0 next cycle).
  const canAffordShelter = gameState.wood >= SHELTER_BUILD_WOOD_COST;
  const alreadyBuilt = gameState.shelterLevel >= 1;
  buildShelterBtn.disabled = !canAffordShelter || alreadyBuilt;

  // Eating is only allowed if the player can afford it AND actually
  // needs it (no point enabling the button if energy is already full).
  const canAfford = gameState.food >= EAT_FOOD_COST;
  const needsEnergy = gameState.energy < getMaxEnergy();
  eatFoodBtn.disabled = !(canAfford && needsEnergy);
}

// ----------------------------------------------------------------------
// render: pushes the current gameState onto the page. This is the only
// place that touches the resource/stat DOM elements, so the HTML always
// reflects whatever gameState currently holds.
// ----------------------------------------------------------------------
function render() {
  document.getElementById('wood').textContent = gameState.wood;
  document.getElementById('food').textContent = gameState.food;

  // Gather button labels show their current actual energy cost (base
  // cost x the shelter/temperature multiplier), so it's visible up front
  // rather than something you only discover from the debug multiplier.
  const woodCost = (GATHER_WOOD_ENERGY_COST * getActionCostMultiplier()).toFixed(2);
  const foodCost = (GATHER_FOOD_ENERGY_COST * getActionCostMultiplier()).toFixed(2);
  document.getElementById('gather-wood-btn').textContent = `Gather Wood (-${woodCost} energy)`;
  document.getElementById('gather-food-btn').textContent = `Gather Food (-${foodCost} energy)`;

  // Energy can hold fractional values internally (action costs get
  // multiplied by shelter/temperature, which rarely divides evenly), so
  // it's shown to two decimal places instead of being rounded to a
  // whole number, to make each action's actual cost visible.
  document.getElementById('energy-value').textContent = gameState.energy.toFixed(2);
  document.getElementById('health-value').textContent = gameState.health;

  // The "/ max" labels are driven from getMaxEnergy()/getMaxHealth() too,
  // so they automatically reflect any meta-progression bonuses instead
  // of a hardcoded number that could drift out of sync.
  document.getElementById('energy-max').textContent = getMaxEnergy();
  document.getElementById('health-max').textContent = getMaxHealth();

  // Bars are just divs whose width is set to match the stat's percentage
  // of its max value.
  document.getElementById('energy-bar').style.width = (gameState.energy / getMaxEnergy() * 100) + '%';
  document.getElementById('health-bar').style.width = (gameState.health / getMaxHealth() * 100) + '%';

  // Debug readout: shows the combined shelter/temperature action-cost
  // multiplier so those modifiers are actually visible while testing
  // (e.g. 0.42x means actions cost 42% of their base energy price).
  document.getElementById('debug-cost-multiplier').textContent = getActionCostMultiplier().toFixed(2) + 'x';
  document.getElementById('debug-temp-toggle').textContent =
    'Temperature: ' + (gameState.temperature === 1 ? 'Comfortable' : 'Cold');
  document.getElementById('debug-shelter-select').value = gameState.shelterLevel;

  // Meta-progression sidepanel. Run duration updates live here since
  // render() already runs every tick - no separate timer needed.
  document.getElementById('cycle-count').textContent = metaProgression.cycleCount;
  document.getElementById('bonus-health').textContent = metaProgression.bonusHealth;
  document.getElementById('bonus-energy').textContent = metaProgression.bonusEnergy;
  document.getElementById('run-duration').textContent = getRunDurationSeconds();

  updateButtonStates();

  // Checked last so it sees this render's up-to-date gameState. If it
  // fires, it pauses the game and calls updateButtonStates() itself.
  checkMilestones();
}

// ----------------------------------------------------------------------
// startNewRun: resets gameState back to fresh starting values for a new
// cycle, hides both overlays, and restarts the survival timer. Note
// this does NOT touch metaProgression - energy/health start at whatever
// getMaxEnergy()/getMaxHealth() currently are, which already include
// any bonuses earned from previous cycles.
// ----------------------------------------------------------------------
function startNewRun() {
  gameState = {
    wood: 0,
    food: 0,
    energy: getMaxEnergy(),
    health: getMaxHealth(),
    totalWoodGathered: 0,
    totalFoodGathered: 0,
    runStartTime: Date.now(),
    isDead: false,
    shelterLevel: 0,
    temperature: 0,
    isPaused: false,
    pauseStartTime: null,
    totalPausedMs: 0,
  };

  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('milestone-screen').classList.add('hidden');

  render();
  startSurvivalTimer();
}

// ----------------------------------------------------------------------
// chooseBonus: called from the death screen when the player picks their
// reward for surviving this cycle. Applies the bonus permanently (it
// lives in metaProgression, not gameState, so it isn't wiped by
// startNewRun), advances the cycle counter, then starts the next cycle.
// ----------------------------------------------------------------------
function chooseBonus(stat) {
  if (stat === 'health') {
    metaProgression.bonusHealth += 1;
  } else if (stat === 'energy') {
    metaProgression.bonusEnergy += 1;
  }

  metaProgression.cycleCount += 1;

  startNewRun();
}

// ----------------------------------------------------------------------
// resetProgression: the "start all over" option available from both the
// pause and death screens. Wipes metaProgression back to its starting
// values, then starts a brand new cycle 1 run on top of that.
// ----------------------------------------------------------------------
function resetProgression() {
  metaProgression = {
    bonusHealth: 0,
    bonusEnergy: 0,
    cycleCount: 1,
    unlockedMilestoneIds: [],
    shelterUnlocked: false,
  };

  startNewRun();
}

// ----------------------------------------------------------------------
// startSurvivalTimer: begins the repeating energy/health tick. Guards
// against starting a second interval on top of an existing one.
// ----------------------------------------------------------------------
function startSurvivalTimer() {
  if (survivalTimerId !== null) {
    clearInterval(survivalTimerId);
  }
  survivalTimerId = setInterval(tickSurvival, TICK_INTERVAL_MS);
}

// ----------------------------------------------------------------------
// init: wires up button clicks once when the page first loads, then
// does the initial render and starts the survival timer.
// ----------------------------------------------------------------------
function init() {
  document.getElementById('gather-wood-btn').addEventListener('click', gatherWood);
  document.getElementById('gather-food-btn').addEventListener('click', gatherFood);
  document.getElementById('eat-food-btn').addEventListener('click', eatFood);
  document.getElementById('build-shelter-btn').addEventListener('click', buildSimpleShelter);
  document.getElementById('pause-btn').addEventListener('click', pauseGame);
  document.getElementById('resume-btn').addEventListener('click', resumeGame);
  document.getElementById('milestone-continue-btn').addEventListener('click', resumeGame);

  // Death screen: pick a permanent bonus and move on to the next cycle.
  document.getElementById('bonus-health-btn').addEventListener('click', () => chooseBonus('health'));
  document.getElementById('bonus-energy-btn').addEventListener('click', () => chooseBonus('energy'));

  // Both overlays offer a way to wipe meta-progression and start over.
  document.getElementById('reset-progression-death-btn').addEventListener('click', resetProgression);
  document.getElementById('reset-progression-pause-btn').addEventListener('click', resetProgression);

  // Debug controls: let shelter/temperature be changed by hand for now,
  // until a real shelter-building/temperature system sets them instead.
  document.getElementById('debug-shelter-select').addEventListener('change', (event) => {
    gameState.shelterLevel = Number(event.target.value);
    render();
  });
  document.getElementById('debug-temp-toggle').addEventListener('click', () => {
    gameState.temperature = gameState.temperature === 1 ? 0 : 1;
    render();
  });
  document.getElementById('debug-kill-btn').addEventListener('click', debugKillInstantly);

  render();
  startSurvivalTimer();
}

init();
