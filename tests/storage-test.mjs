import assert from "node:assert/strict";
import {
  dateKey,
  parseKey,
  pad,
  startOfMonth,
  addMonths,
  defaultState,
  normalizeState,
  mergeSyncState,
  habitDueOn,
  isHabitDone,
} from "../solara-core.mjs";

function test(name, fn) {
  try {
    fn();
    console.log("✓ " + name);
    return true;
  } catch (e) {
    console.error("✗ " + name);
    console.error("  " + e.message);
    return false;
  }
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

run("pad zero-pads", () => {
  assert.equal(pad(3), "03");
  assert.equal(pad(12), "12");
});

run("dateKey formats YYYY-MM-DD", () => {
  assert.equal(dateKey(new Date(2026, 7, 2)), "2026-08-02");
});

run("parseKey round-trips", () => {
  const d = parseKey("2026-08-02");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 2);
});

run("startOfMonth", () => {
  const d = startOfMonth(new Date(2026, 7, 15));
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 7);
});

run("addMonths", () => {
  const d = addMonths(new Date(2026, 0, 1), 2);
  assert.equal(d.getMonth(), 2);
});

run("normalizeState fills defaults", () => {
  const s = normalizeState({ habits: [{ id: "h1" }] });
  assert.equal(s.version, 1);
  assert.equal(s.habits.length, 1);
  assert.equal(s.settings.theme, "sunshine");
  assert.deepEqual(s.checkins, []);
});

run("mergeSyncState picks remote when newer", () => {
  const local = defaultState();
  local.syncUpdatedAt = 100;
  local.habits = [{ id: "local" }];
  const remote = defaultState();
  remote.syncUpdatedAt = 500;
  remote.habits = [{ id: "remote" }];
  const { state, winner } = mergeSyncState(local, remote, 500);
  assert.equal(winner, "remote");
  assert.equal(state.habits[0].id, "remote");
  assert.equal(state.syncUpdatedAt, 500);
});

run("mergeSyncState keeps local when newer", () => {
  const local = defaultState();
  local.syncUpdatedAt = 900;
  local.habits = [{ id: "local" }];
  const remote = defaultState();
  remote.habits = [{ id: "remote" }];
  const { state, winner } = mergeSyncState(local, remote, 100);
  assert.equal(winner, "local");
  assert.equal(state.habits[0].id, "local");
});

run("habitDueOn respects frequency", () => {
  const habit = { frequency: [1, 3, 5] };
  assert.equal(habitDueOn(habit, "2026-08-03"), true);
  assert.equal(habitDueOn(habit, "2026-08-04"), false);
});

run("isHabitDone yesno/count/duration", () => {
  assert.equal(isHabitDone({ type: "yesno", target: 1 }, { value: 1 }), true);
  assert.equal(isHabitDone({ type: "count", target: 5 }, { value: 3 }), false);
  assert.equal(isHabitDone({ type: "count", target: 5 }, { value: 5 }), true);
  assert.equal(isHabitDone({ type: "duration", target: 30 }, { minutes: 20 }), false);
  assert.equal(isHabitDone({ type: "duration", target: 30 }, { minutes: 30 }), true);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
