// Hunger's max value lives here, not repeated as a magic number everywhere
// else, so changing the scale only ever means changing this one line.
const MAX_HUNGER = 10;

// ======================================================================
// gameState holds every piece of data that describes the current run.
// Keeping it all in one object makes it easy to reset everything at once
// when the player starts a new run (see startNewRun below).
// ======================================================================
let gameState = {
  wood: 0,
  food: 0,

  // Survival stats. Both start full and are clamped between 0 and their maximum values.
  hunger: MAX_HUNGER,
  health: 100,

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
  temperature: 1,   // 0 = cold, 1 = comfortable

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
const HUNGER_LOSS_PER_TICK = 0.1;
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
  const needsHunger = gameState.hunger < MAX_HUNGER;

  if (gameState.isDead || !canAfford || !needsHunger) return;

  gameState.food -= EAT_FOOD_COST;

  // Math.min caps hunger at its max even if the restore amount would push it over.
  gameState.hunger = Math.min(MAX_HUNGER, gameState.hunger + EAT_FOOD_HUNGER_RESTORE);

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

  // Once dead, every action button is disabled - the run is over.
  if (gameState.isDead) {
    gatherWoodBtn.disabled = true;
    gatherFoodBtn.disabled = true;
    eatFoodBtn.disabled = true;
    pauseBtn.disabled = true;
    shelterSelect.disabled = true;
    tempToggleBtn.disabled = true;
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
    return;
  }

  gatherWoodBtn.disabled = false;
  gatherFoodBtn.disabled = false;
  pauseBtn.disabled = false;
  shelterSelect.disabled = false;
  tempToggleBtn.disabled = false;

  // Eating is only allowed if the player can afford it AND actually
  // needs it (no point enabling the button if hunger is already full).
  const canAfford = gameState.food >= EAT_FOOD_COST;
  const needsHunger = gameState.hunger < MAX_HUNGER;
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

  // Hunger can now hold fractional values internally (shelter/temperature
  // multipliers rarely divide evenly), so it's rounded just for display.
  const roundedHunger = Math.round(gameState.hunger);
  document.getElementById('hunger-value').textContent = roundedHunger;
  document.getElementById('health-value').textContent = gameState.health;

  // Bars are just divs whose width is set to match the stat's percentage
  // of its max value.
  document.getElementById('hunger-bar').style.width = (gameState.hunger / MAX_HUNGER * 100) + '%';
  document.getElementById('health-bar').style.width = gameState.health + '%';

  // Debug readout: shows the effective hunger loss rate so the
  // shelter/temperature modifiers are actually visible while testing.
  document.getElementById('debug-hunger-rate').textContent = getHungerLossRate().toFixed(2);
  document.getElementById('debug-temp-toggle').textContent =
    'Temperature: ' + (gameState.temperature === 1 ? 'Comfortable' : 'Cold');
  document.getElementById('debug-shelter-select').value = gameState.shelterLevel;

  updateButtonStates();
}

// ----------------------------------------------------------------------
// startNewRun: resets gameState back to fresh starting values, hides
// the death screen, and restarts the survival timer. This is what lets
// the player begin again after dying.
// ----------------------------------------------------------------------
function startNewRun() {
  gameState = {
    wood: 0,
    food: 0,
    hunger: MAX_HUNGER,
    health: 100,
    totalWoodGathered: 0,
    totalFoodGathered: 0,
    runStartTime: Date.now(),
    isDead: false,
    shelterLevel: 0,
    temperature: 1,
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
  document.getElementById('new-run-btn').addEventListener('click', startNewRun);
  document.getElementById('pause-btn').addEventListener('click', pauseGame);
  document.getElementById('resume-btn').addEventListener('click', resumeGame);

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

  render();
  startSurvivalTimer();
}

init();
