// Simulates git-like Drive sync after wipe / re-add to home screen.
import assert from "node:assert/strict";
import {
  defaultState,
  mergeSyncState,
  normalizeState,
  shouldPushAfterMerge,
  syncContentWeight,
} from "../solara-core.mjs";

const cloud = defaultState();
cloud.syncUpdatedAt = Date.now() - 86_400_000;
cloud.habits = [
  { id: "h1", name: "晨跑", type: "yesno", target: 1, frequency: [0, 1, 2, 3, 4, 5, 6], color: "#F4A261", updatedAt: 1 },
  { id: "h2", name: "閱讀", type: "count", target: 20, frequency: [1, 2, 3, 4, 5], color: "#2A9D8F", updatedAt: 1 },
];
cloud.checkins = [
  { id: "c1", habitId: "h1", date: "2026-08-01", value: 1, updatedAt: 1 },
  { id: "c2", habitId: "h2", date: "2026-08-02", value: 5, updatedAt: 1 },
];
cloud.goals = [{ id: "g1", title: "跑30次", target: 30, current: 4, habitId: "h1", unit: "次", updatedAt: 1 }];
cloud.settings.googleClientId = "same-client.apps.googleusercontent.com";
cloud.settings.googleConnected = true;
const cloudFileModified = cloud.syncUpdatedAt;

const fresh = defaultState();
fresh.syncUpdatedAt = Date.now();
fresh.settings.googleClientId = "same-client.apps.googleusercontent.com";
fresh.settings.googleConnected = true;
fresh.settings.autoSync = true;

assert.equal(syncContentWeight(fresh), 0);
assert.ok(syncContentWeight(cloud) > 0);

const ff = mergeSyncState(fresh, cloud, cloudFileModified);
assert.equal(ff.winner, "remote");
assert.equal(ff.action, "fast-forward");
assert.equal(ff.state.habits.length, 2);
assert.equal(shouldPushAfterMerge(ff, true), false, "fast-forward must not push empty/overwrite");

// Device A and device B each added a habit — git merge keeps both.
const deviceA = normalizeState(ff.state);
deviceA.syncUpdatedAt = Date.now();
deviceA.habits = deviceA.habits.concat([
  { id: "h3", name: "冥想", type: "yesno", target: 1, updatedAt: Date.now() },
]);
const deviceB = normalizeState(cloud);
deviceB.syncUpdatedAt = Date.now() - 1000;
deviceB.habits = deviceB.habits.concat([
  { id: "h4", name: "喝水", type: "count", target: 8, updatedAt: Date.now() - 1000 },
]);
const both = mergeSyncState(deviceA, deviceB, deviceB.syncUpdatedAt);
assert.equal(both.winner, "merged");
assert.equal(both.action, "merge");
assert.equal(both.state.habits.length, 4);
assert.equal(shouldPushAfterMerge(both, true), true, "merge result should push upstream");

// Never push empty over non-empty remote.
const emptyPush = mergeSyncState(defaultState(), cloud, cloudFileModified);
assert.equal(shouldPushAfterMerge(emptyPush, true), false);

// Hard delete must not come back from older cloud snapshot.
const afterDelete = normalizeState(deviceA);
afterDelete.habits = afterDelete.habits.filter((h) => h.id !== "h1");
afterDelete.tombstones = Object.assign({}, afterDelete.tombstones, { h1: Date.now() });
afterDelete.syncUpdatedAt = Date.now();
const deleted = mergeSyncState(afterDelete, cloud, cloudFileModified);
assert.equal(deleted.winner, "merged");
assert.equal(deleted.state.habits.some((h) => h.id === "h1"), false, "tombstone blocks resurrect");
assert.equal(shouldPushAfterMerge(deleted, true), true);

// Undo a yes/no check-in on one device must not come back "done" from cloud.
const afterUndo = normalizeState(ff.state);
afterUndo.checkins = afterUndo.checkins.filter((c) => c.id !== "c1");
afterUndo.tombstones = Object.assign({}, afterUndo.tombstones, {
  c1: Date.now(),
  "h1|2026-08-01": Date.now(),
});
afterUndo.syncUpdatedAt = Date.now();
const undone = mergeSyncState(afterUndo, cloud, cloudFileModified);
assert.equal(
  undone.state.checkins.some((c) => c.habitId === "h1" && c.date === "2026-08-01"),
  false,
  "checkin undo tombstone blocks done resurrect"
);
assert.equal(shouldPushAfterMerge(undone, true), true);

console.log("✓ sync-reinstall: empty fresh fast-forwards cloud");
console.log("✓ sync-gitlike: two-device habits union-merge + push");
console.log("✓ sync-gitlike: never push empty over cloud");
console.log("✓ sync-gitlike: tombstone delete survives merge");
console.log("✓ sync-gitlike: checkin undo tombstone survives merge");
console.log("\n5 passed, 0 failed");
