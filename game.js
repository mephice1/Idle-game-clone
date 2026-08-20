// Base max values before any meta-progression bonuses are applied.
// See getMaxHunger()/getMaxHealth() below for the values actually used
// in gameplay.
const BASE_MAX_HUNGER = 10;
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
  bonusHunger: 0,
  cycleCount: 1,
};

// ----------------------------------------------------------------------
// getMaxHunger / getMaxHealth: the actual caps used during gameplay -
// the base value plus whatever permanent bonuses have been earned by
// surviving previous cycles. Called wherever a max value is needed so
// they always reflect the latest metaProgression.
// ----------------------------------------------------------------------
function getMaxHunger() {
  return BASE_MAX_HUNGER + metaProgression.bonusHunger;
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
  hunger: getMaxHunger(),
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

// The interval timer for hunger/health decay lives outside gameState
// because it's not "game data" - it's a handle we need to be able to
// cancel with clearInterval(). Storing it in gameState would just mean
// accidentally saving/serializing something that isn't real state.
let survivalTimerId = null;

// How often (ms) the survival tick runs, and how much it moves each stat.
const TICK_INTERVAL_MS = 1000;
const HUNGER_LOSS_PER_TICK = 0.2;
const HEALTH_LOSS_PER_TICK = 1;

// Cost/benefit of eating food.
const EAT_FOOD_COST = 5;
const EAT_FOOD_HUNGER_RESTORE = 2;

// Multipliers applied to HUNGER_LOSS_PER_TICK based on the player's
// current shelter and temperature. Below 1.0 = slower hunger loss,
// above 1.0 = faster. Indexed/keyed by the matching gameState value.
const SHELTER_HUNGER_MULTIPLIERS = [1.0, 0.6, 0.3]; // [none, simple, good]
const TEMPERATURE_HUNGER_MULTIPLIERS = { 0: 1.4, 1: 1.0 }; // { cold, comfortable }

// ----------------------------------------------------------------------
// getHungerLossRate: works out how fast hunger should currently drain by
// combining the base rate with the active shelter/temperature multipliers.
// Called fresh every tick so it always reflects the latest gameState -
// once a real shelter/temperature system sets these fields, this function
// needs no changes at all.
// ----------------------------------------------------------------------
function getHungerLossRate() {
  const shelterMultiplier = SHELTER_HUNGER_MULTIPLIERS[gameState.shelterLevel];
  const temperatureMultiplier = TEMPERATURE_HUNGER_MULTIPLIERS[gameState.temperature];
  return HUNGER_LOSS_PER_TICK * shelterMultiplier * temperatureMultiplier;
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

  render();
}

// ----------------------------------------------------------------------
// gatherFood: same idea as gatherWood, but for food.
// ----------------------------------------------------------------------
function gatherFood() {
  if (gameState.isDead) return;

  gameState.food += 1;
  gameState.totalFoodGathered += 1;

  render();
}

// ----------------------------------------------------------------------
// eatFood: spends food to restore hunger.
// The button itself gets disabled when this isn't a legal move (see
// updateButtonStates), but we re-check the conditions here too so the
// function is safe to call from anywhere, not just a click handler.
// ----------------------------------------------------------------------
function eatFood() {
  const canAfford = gameState.food >= EAT_FOOD_COST;
  const needsHunger = gameState.hunger < getMaxHunger();

  if (gameState.isDead || !canAfford || !needsHunger) return;

  gameState.food -= EAT_FOOD_COST;

  // Math.min caps hunger at its max even if the restore amount would push it over.
  gameState.hunger = Math.min(getMaxHunger(), gameState.hunger + EAT_FOOD_HUNGER_RESTORE);

  render();
}

// ----------------------------------------------------------------------
// tickSurvival: runs automatically every TICK_INTERVAL_MS.
// While the player has hunger left, hunger drains first. Only once
// hunger has hit 0 does health start draining instead - this is what
// gives the player a warning period (low/zero hunger) before the run
// actually starts ending, rather than dying the instant food runs out.
// ----------------------------------------------------------------------
function tickSurvival() {
  if (gameState.hunger > 0) {
    gameState.hunger = Math.max(0, gameState.hunger - getHungerLossRate());
  } else {
    gameState.health = Math.max(0, gameState.health - HEALTH_LOSS_PER_TICK);
  }

  if (gameState.health <= 0) {
    triggerDeath();
    return;
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
// waiting for hunger and health to actually drain out. No-op if already
// dead or paused (same guard triggerDeath itself doesn't need, since it
// only ever gets called once hunger/health naturally reach 0).
// ----------------------------------------------------------------------
function debugKillInstantly() {
  if (gameState.isDead || gameState.isPaused) return;

  gameState.hunger = 0;
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
// resumeGame: the reverse of pauseGame. Adds however long this pause
// lasted onto the running total (so it can be excluded from run
// duration elsewhere), then restarts the tick.
// ----------------------------------------------------------------------
function resumeGame() {
  if (!gameState.isPaused) return;

  gameState.totalPausedMs += Date.now() - gameState.pauseStartTime;
  gameState.pauseStartTime = null;
  gameState.isPaused = false;

  document.getElementById('pause-screen').classList.add('hidden');

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
  const pauseBtn = document.getElementById('pause-btn');
  const shelterSelect = document.getElementById('debug-shelter-select');
  const tempToggleBtn = document.getElementById('debug-temp-toggle');
  const killBtn = document.getElementById('debug-kill-btn');

  // Once dead, every action button is disabled - the run is over.
  if (gameState.isDead) {
    gatherWoodBtn.disabled = true;
    gatherFoodBtn.disabled = true;
    eatFoodBtn.disabled = true;
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

  // Eating is only allowed if the player can afford it AND actually
  // needs it (no point enabling the button if hunger is already full).
  const canAfford = gameState.food >= EAT_FOOD_COST;
  const needsHunger = gameState.hunger < getMaxHunger();
  eatFoodBtn.disabled = !(canAfford && needsHunger);
}

// ----------------------------------------------------------------------
// render: pushes the current gameState onto the page. This is the only
// place that touches the resource/stat DOM elements, so the HTML always
// reflects whatever gameState currently holds.
// ----------------------------------------------------------------------
function render() {
  document.getElementById('wood').textContent = gameState.wood;
  document.getElementById('food').textContent = gameState.food;

  // Hunger can hold fractional values internally (shelter/temperature
  // multipliers rarely divide evenly), so it's shown to one decimal place
  // instead of being rounded to a whole number - a whole-number display
  // made the loss rate look uneven, holding for 3 ticks then 4 ticks etc.,
  // even though the underlying value was decreasing at a constant rate.
  document.getElementById('hunger-value').textContent = gameState.hunger.toFixed(1);
  document.getElementById('health-value').textContent = gameState.health;

  // The "/ max" labels are driven from getMaxHunger()/getMaxHealth() too,
  // so they automatically reflect any meta-progression bonuses instead
  // of a hardcoded number that could drift out of sync.
  document.getElementById('hunger-max').textContent = getMaxHunger();
  document.getElementById('health-max').textContent = getMaxHealth();

  // Bars are just divs whose width is set to match the stat's percentage
  // of its max value.
  document.getElementById('hunger-bar').style.width = (gameState.hunger / getMaxHunger() * 100) + '%';
  document.getElementById('health-bar').style.width = (gameState.health / getMaxHealth() * 100) + '%';

  // Debug readout: shows the effective hunger loss rate so the
  // shelter/temperature modifiers are actually visible while testing.
  document.getElementById('debug-hunger-rate').textContent = getHungerLossRate().toFixed(2);
  document.getElementById('debug-temp-toggle').textContent =
    'Temperature: ' + (gameState.temperature === 1 ? 'Comfortable' : 'Cold');
  document.getElementById('debug-shelter-select').value = gameState.shelterLevel;

  // Meta-progression sidepanel. Run duration updates live here since
  // render() already runs every tick - no separate timer needed.
  document.getElementById('cycle-count').textContent = metaProgression.cycleCount;
  document.getElementById('bonus-health').textContent = metaProgression.bonusHealth;
  document.getElementById('bonus-hunger').textContent = metaProgression.bonusHunger;
  document.getElementById('run-duration').textContent = getRunDurationSeconds();

  updateButtonStates();
}

// ----------------------------------------------------------------------
// startNewRun: resets gameState back to fresh starting values for a new
// cycle, hides both overlays, and restarts the survival timer. Note
// this does NOT touch metaProgression - hunger/health start at whatever
// getMaxHunger()/getMaxHealth() currently are, which already include
// any bonuses earned from previous cycles.
// ----------------------------------------------------------------------
function startNewRun() {
  gameState = {
    wood: 0,
    food: 0,
    hunger: getMaxHunger(),
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
  } else if (stat === 'hunger') {
    metaProgression.bonusHunger += 1;
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
    bonusHunger: 0,
    cycleCount: 1,
  };

  startNewRun();
}

// ----------------------------------------------------------------------
// startSurvivalTimer: begins the repeating hunger/health tick. Guards
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
  document.getElementById('pause-btn').addEventListener('click', pauseGame);
  document.getElementById('resume-btn').addEventListener('click', resumeGame);

  // Death screen: pick a permanent bonus and move on to the next cycle.
  document.getElementById('bonus-health-btn').addEventListener('click', () => chooseBonus('health'));
  document.getElementById('bonus-hunger-btn').addEventListener('click', () => chooseBonus('hunger'));

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
