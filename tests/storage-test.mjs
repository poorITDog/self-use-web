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
  shouldPushAfterMerge,
  syncContentWeight,
  habitDueOn,
  isHabitDone,
  countdownNextAt,
  countdownDaysLeft,
  eventOccursOn,
  eventRepeatLabel,
  normalizeGoal,
  maybeFinishGoal,
  isGoalFinished,
  goalUnitLabel,
  goalTypeLabel,
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
  assert.deepEqual(s.events, []);
  assert.equal(s.settings.focusSoundEnabled, true);
  assert.equal(s.syncBaseAt, 0);
});

run("mergeSyncState fast-forwards empty local to remote", () => {
  const local = defaultState();
  local.syncUpdatedAt = Date.now();
  const remote = defaultState();
  remote.habits = [{ id: "remote", updatedAt: 1 }];
  const { state, winner, action } = mergeSyncState(local, remote, 500);
  assert.equal(winner, "remote");
  assert.equal(action, "fast-forward");
  assert.equal(state.habits[0].id, "remote");
  assert.equal(shouldPushAfterMerge({ state, winner, action }, true), false);
});

run("mergeSyncState union-merges both sides like git merge", () => {
  const local = defaultState();
  local.syncUpdatedAt = 900;
  local.habits = [{ id: "local", name: "本地", updatedAt: 900 }];
  const remote = defaultState();
  remote.habits = [{ id: "remote", name: "雲端", updatedAt: 100 }];
  const { state, winner, action } = mergeSyncState(local, remote, 100);
  assert.equal(winner, "merged");
  assert.equal(action, "merge");
  const ids = state.habits.map((h) => h.id).sort();
  assert.deepEqual(ids, ["local", "remote"]);
  assert.equal(shouldPushAfterMerge({ state, winner, action }, true), true);
});

run("mergeSyncState prefers remote when local empty after reinstall", () => {
  const local = defaultState();
  local.syncUpdatedAt = Date.now();
  local.settings.googleConnected = true;
  local.settings.googleClientId = "new-client.apps.googleusercontent.com";
  const remote = defaultState();
  remote.syncUpdatedAt = 1_700_000_000_000;
  remote.habits = [{ id: "old-habit", name: "晨跑" }];
  remote.checkins = [{ id: "c1", habitId: "old-habit", date: "2026-08-01", value: 1 }];
  const { state, winner, action } = mergeSyncState(local, remote, 1_700_000_000_000);
  assert.equal(winner, "remote");
  assert.equal(action, "fast-forward");
  assert.equal(state.habits[0].id, "old-habit");
  assert.equal(state.checkins.length, 1);
});

run("mergeSyncState keeps local-only content for push when remote empty", () => {
  const local = defaultState();
  local.syncUpdatedAt = 900;
  local.habits = [{ id: "new-local" }];
  const remote = defaultState();
  const { state, winner, action } = mergeSyncState(local, remote, 0);
  assert.equal(winner, "local");
  assert.equal(action, "push");
  assert.equal(state.habits[0].id, "new-local");
  assert.equal(shouldPushAfterMerge({ state, winner, action }, false), true);
});

run("shouldPushAfterMerge never pushes empty state", () => {
  const empty = defaultState();
  assert.equal(syncContentWeight(empty), 0);
  assert.equal(
    shouldPushAfterMerge({ state: empty, winner: "local", action: "push" }, true),
    false
  );
});

run("mergeSyncState tombstone keeps hard delete from resurrecting", () => {
  const local = defaultState();
  local.syncUpdatedAt = Date.now();
  local.habits = [{ id: "keep", name: "保留", updatedAt: 2 }];
  local.tombstones = { gone: Date.now() };
  const remote = defaultState();
  remote.habits = [
    { id: "keep", name: "保留", updatedAt: 1 },
    { id: "gone", name: "應刪除", updatedAt: 1 },
  ];
  const { state, winner, action } = mergeSyncState(local, remote, 100);
  assert.equal(winner, "merged");
  assert.equal(action, "merge");
  assert.equal(state.habits.length, 1);
  assert.equal(state.habits[0].id, "keep");
  assert.ok(state.tombstones.gone);
});

run("shouldPushAfterMerge allows tombstone-only delete-last push", () => {
  const local = defaultState();
  local.tombstones = { h1: Date.now() };
  local.syncUpdatedAt = Date.now();
  const remote = defaultState();
  remote.habits = [{ id: "h1", name: "最後一個", updatedAt: 1 }];
  const result = mergeSyncState(local, remote, 100);
  assert.equal(result.state.habits.length, 0);
  assert.equal(shouldPushAfterMerge(result, true), true);
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

run("countdownDaysLeft yearly birthday", () => {
  const now = new Date(2026, 7, 2, 12, 0, 0).getTime();
  const item = {
    kind: "birthday",
    repeat: "yearly",
    targetAt: new Date(1990, 2, 15).getTime(),
  };
  const days = countdownDaysLeft(item, now);
  assert.ok(days > 0 && days < 400);
});

run("eventOccursOn none/weekly/monthly", () => {
  const once = { date: "2026-08-03", repeat: "none" };
  assert.equal(eventOccursOn(once, "2026-08-03"), true);
  assert.equal(eventOccursOn(once, "2026-08-10"), false);
  const weekly = { date: "2026-08-03", repeat: "weekly" }; // Monday
  assert.equal(eventOccursOn(weekly, "2026-08-10"), true);
  assert.equal(eventOccursOn(weekly, "2026-08-11"), false);
  const monthly = { date: "2026-08-15", repeat: "monthly", until: "2026-10-01" };
  assert.equal(eventOccursOn(monthly, "2026-09-15"), true);
  assert.equal(eventOccursOn(monthly, "2026-10-15"), false);
});

run("eventRepeatLabel", () => {
  assert.equal(eventRepeatLabel("weekly"), "每週");
  assert.equal(eventRepeatLabel("none"), "");
});

run("normalizeState fills event repeat and goal habitId", () => {
  const s = normalizeState({
    events: [{ id: "e1", date: "2026-08-02", title: "開會" }],
    goals: [{ id: "g1", title: "讀完書", target: 10, current: 1 }],
  });
  assert.equal(s.events[0].repeat, "none");
  assert.equal(s.goals[0].habitId, "");
  assert.equal(s.goals[0].goalType, "general");
  assert.equal(s.goals[0].unitMode, "count");
  assert.equal(s.settings.notifyEvents, true);
});

run("normalizeGoal maps hours and cert fields", () => {
  const g = normalizeGoal({ title: "AWS", unit: "小時", goalType: "cert", outcome: "SAA" });
  assert.equal(g.unitMode, "hours");
  assert.equal(goalUnitLabel(g), "小時");
  assert.equal(goalTypeLabel(g.goalType), "證書");
  assert.equal(g.outcome, "SAA");
});

run("normalizeGoal keeps createdAt or falls back to updatedAt", () => {
  const withCreated = normalizeGoal({ title: "A", createdAt: 100, updatedAt: 200 });
  assert.equal(withCreated.createdAt, 100);
  const legacy = normalizeGoal({ title: "B", updatedAt: 300 });
  assert.equal(legacy.createdAt, 300);
});

run("maybeFinishGoal marks achievement when target reached", () => {
  const g = normalizeGoal({ title: "Pro", current: 9, target: 10, goalType: "outcome" });
  assert.equal(maybeFinishGoal(g, 1_700_000_000_000), false);
  g.current = 10;
  assert.equal(maybeFinishGoal(g, 1_700_000_000_000), true);
  assert.equal(isGoalFinished(g), true);
  assert.equal(g.finishedAt, 1_700_000_000_000);
});

run("hours goal same-day delta math accumulates", () => {
  // Mirrors bumpLinkedGoals hours path: replace previous same-day amount.
  const g = normalizeGoal({
    title: "練琴",
    unitMode: "hours",
    current: 0,
    target: 2,
    lastBumpKey: "",
    lastBumpAmount: 0,
  });
  const apply = (mins, key) => {
    const hoursNow = Math.round((mins / 60) * 100) / 100;
    const prev = g.lastBumpKey === key ? (Number(g.lastBumpAmount) || 0) : 0;
    g.current = Math.round((Number(g.current) - prev + hoursNow) * 100) / 100;
    g.lastBumpKey = key;
    g.lastBumpAmount = hoursNow;
  };
  apply(30, "2026-08-03");
  assert.equal(g.current, 0.5);
  apply(90, "2026-08-03");
  assert.equal(g.current, 1.5);
  apply(30, "2026-08-04");
  assert.equal(g.current, 2);
  assert.equal(maybeFinishGoal(g, 123), true);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
