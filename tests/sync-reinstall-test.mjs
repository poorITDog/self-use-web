// Simulates: wipe localStorage (reinstall / add-to-home again) then reconnect merge.
import assert from "node:assert/strict";
import { defaultState, mergeSyncState, normalizeState } from "../solara-core.mjs";

function contentWeight(s) {
  const n = normalizeState(s);
  return (n.habits.length || 0) + (n.checkins.length || 0) +
    (n.events.length || 0) + (n.countdowns.length || 0) +
    (n.goals.length || 0) + (n.blocks.length || 0) +
    (n.focusSessions.length || 0);
}

// Old phone / old install already synced to Drive.
const cloud = defaultState();
cloud.syncUpdatedAt = Date.now() - 86_400_000;
cloud.habits = [
  { id: "h1", name: "晨跑", type: "yesno", target: 1, frequency: [0, 1, 2, 3, 4, 5, 6], color: "#F4A261" },
  { id: "h2", name: "閱讀", type: "count", target: 20, frequency: [1, 2, 3, 4, 5], color: "#2A9D8F" },
];
cloud.checkins = [
  { id: "c1", habitId: "h1", date: "2026-08-01", value: 1 },
  { id: "c2", habitId: "h2", date: "2026-08-02", value: 5 },
];
cloud.goals = [{ id: "g1", title: "跑30次", target: 30, current: 4, habitId: "h1", unit: "次" }];
cloud.settings.googleClientId = "same-client.apps.googleusercontent.com";
cloud.settings.googleConnected = true;
const cloudFileModified = cloud.syncUpdatedAt;

// Bug reproduction: connect flow used to bump syncUpdatedAt on empty local.
const fresh = defaultState();
fresh.syncUpdatedAt = Date.now(); // newer than cloud file — old LWW would keep empty
fresh.settings.googleClientId = "same-client.apps.googleusercontent.com";
fresh.settings.googleConnected = true;
fresh.settings.autoSync = true;

assert.equal(contentWeight(fresh), 0, "fresh install has no user content");
assert.ok(contentWeight(cloud) > 0, "cloud has user content");
assert.ok(fresh.syncUpdatedAt > cloudFileModified, "fresh clock is newer than cloud");

const merged = mergeSyncState(fresh, cloud, cloudFileModified);
assert.equal(merged.winner, "remote", "empty fresh must lose to cloud");
assert.equal(merged.state.habits.length, 2, "habits restored");
assert.equal(merged.state.checkins.length, 2, "checkins restored");
assert.equal(merged.state.goals[0].habitId, "h1", "goal link restored");
assert.equal(merged.state.habits[0].name, "晨跑");

// Non-empty newer local must still win (real edits on this device).
const edited = normalizeState(merged.state);
edited.syncUpdatedAt = Date.now();
edited.habits = edited.habits.concat([
  { id: "h3", name: "冥想", type: "yesno", target: 1, frequency: [0, 1, 2, 3, 4, 5, 6], color: "#E76F51" },
]);
const keepLocal = mergeSyncState(edited, cloud, cloudFileModified);
assert.equal(keepLocal.winner, "local");
assert.equal(keepLocal.state.habits.length, 3);

console.log("✓ sync-reinstall: empty fresh restores cloud");
console.log("✓ sync-reinstall: newer non-empty local still wins");
console.log("\n2 passed, 0 failed");
