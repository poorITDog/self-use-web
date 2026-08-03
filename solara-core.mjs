/**
 * Pure helpers shared with Node tests (keep in sync with solara.js).
 */

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function parseKey(k) {
  const p = k.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function defaultState() {
  return {
    version: 1,
    syncUpdatedAt: 0,
    // Last remote revision we successfully fetched/merged (git-like upstream tip).
    syncBaseAt: 0,
    settings: {
      theme: "sunshine",
      photoDataUrl: "",
      palette: [],
      cloudUrl: "",
      cloudToken: "",
      googleClientId: "",
      googleConnected: false,
      autoSync: true,
      focusMin: 25,
      breakMin: 5,
      currencyLabel: "HKD",
      calShowHabits: true,
      calShowCountdowns: true,
      habitsBoardMode: "month",
      notifyEnabled: false,
      notifyHabits: true,
      notifyEvents: true,
      focusSoundEnabled: true,
    },
    habits: [],
    checkins: [],
    blocks: [],
    countdowns: [],
    focusSessions: [],
    goals: [],
    events: [],
    transactions: [],
  };
}

export function normalizeState(data) {
  const base = defaultState();
  if (!data || typeof data !== "object") return base;
  const out = { ...base, ...data };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  if (out.settings.focusSoundEnabled === undefined) out.settings.focusSoundEnabled = true;
  if (out.settings.notifyEvents === undefined) out.settings.notifyEvents = true;
  for (const k of [
    "habits",
    "checkins",
    "blocks",
    "countdowns",
    "focusSessions",
    "goals",
    "events",
    "transactions",
  ]) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  out.events = out.events.map((ev) =>
    Object.assign({ repeat: "none", until: "", note: "", allDay: false }, ev || {}, {
      repeat: (ev && ev.repeat) || "none",
      until: (ev && ev.until) || "",
    })
  );
  out.goals = out.goals.map((g) =>
    Object.assign({ habitId: "", unit: "", current: 0, target: 1 }, g || {}, {
      habitId: (g && g.habitId) || "",
    })
  );
  out.syncUpdatedAt = Number(out.syncUpdatedAt) || 0;
  out.syncBaseAt = Number(out.syncBaseAt) || 0;
  return out;
}

// Does a calendar appointment (not a habit) occur on YYYY-MM-DD?
export function eventOccursOn(ev, key) {
  if (!ev || !ev.date || !key) return false;
  const repeat = ev.repeat || "none";
  if (key < ev.date) return false;
  if (ev.until && key > ev.until) return false;
  if (repeat === "none") return ev.date === key;
  if (repeat === "daily") return true;
  const start = parseKey(ev.date);
  const cur = parseKey(key);
  if (repeat === "weekly") return start.getDay() === cur.getDay();
  if (repeat === "monthly") return start.getDate() === cur.getDate();
  if (repeat === "yearly") {
    return start.getMonth() === cur.getMonth() && start.getDate() === cur.getDate();
  }
  return ev.date === key;
}

export function eventRepeatLabel(repeat) {
  const map = {
    none: "",
    daily: "每日",
    weekly: "每週",
    monthly: "每月",
    yearly: "每年",
  };
  return map[repeat || "none"] || "";
}

export function syncContentWeight(s) {
  const n = s && s.habits ? s : normalizeState(s);
  return (n.habits.length || 0) + (n.checkins.length || 0) +
    (n.events.length || 0) + (n.countdowns.length || 0) +
    (n.goals.length || 0) + (n.blocks.length || 0) +
    (n.focusSessions.length || 0);
}

// Union merge one collection by key; higher updatedAt wins on conflict (git-like).
export function mergeEntityLists(localList, remoteList, keyFn) {
  const map = new Map();
  function put(item) {
    if (!item) return;
    const key = keyFn(item);
    if (key == null || key === "") return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, item);
      return;
    }
    const pt = Number(prev.updatedAt) || 0;
    const it = Number(item.updatedAt) || 0;
    map.set(key, it >= pt ? item : prev);
  }
  (remoteList || []).forEach(put);
  (localList || []).forEach(put);
  return Array.from(map.values());
}

/**
 * Git-like sync merge:
 * - empty local + remote content → fast-forward to remote
 * - local content + empty remote → keep local (caller will push)
 * - both have content → union-merge collections by id
 */
export function mergeSyncState(local, remote, remoteUpdatedAt) {
  const localNorm = normalizeState(local);
  const remoteNorm = normalizeState(remote);
  const localTs = Number(localNorm.syncUpdatedAt) || 0;
  const remoteTs = Number(remoteUpdatedAt) || Number(remoteNorm.syncUpdatedAt) || 0;
  const localWeight = syncContentWeight(localNorm);
  const remoteWeight = syncContentWeight(remoteNorm);

  if (remoteWeight > 0 && localWeight === 0) {
    remoteNorm.syncUpdatedAt = Math.max(remoteTs, localTs);
    remoteNorm.syncBaseAt = remoteTs;
    return { state: remoteNorm, winner: "remote", action: "fast-forward" };
  }
  if (localWeight > 0 && remoteWeight === 0) {
    localNorm.syncBaseAt = remoteTs || localNorm.syncBaseAt || 0;
    return { state: localNorm, winner: "local", action: "push" };
  }
  if (localWeight === 0 && remoteWeight === 0) {
    return { state: localNorm, winner: "local", action: "noop" };
  }

  const merged = normalizeState({
    version: Math.max(localNorm.version || 1, remoteNorm.version || 1),
    settings: remoteTs > localTs
      ? { ...localNorm.settings, ...remoteNorm.settings }
      : { ...remoteNorm.settings, ...localNorm.settings },
  });
  merged.habits = mergeEntityLists(localNorm.habits, remoteNorm.habits, (x) => x.id);
  merged.checkins = mergeEntityLists(
    localNorm.checkins,
    remoteNorm.checkins,
    (x) => x.id || `${x.habitId}|${x.date}`
  );
  merged.blocks = mergeEntityLists(localNorm.blocks, remoteNorm.blocks, (x) => x.id);
  merged.countdowns = mergeEntityLists(localNorm.countdowns, remoteNorm.countdowns, (x) => x.id);
  merged.focusSessions = mergeEntityLists(
    localNorm.focusSessions,
    remoteNorm.focusSessions,
    (x) => x.id
  );
  merged.goals = mergeEntityLists(localNorm.goals, remoteNorm.goals, (x) => x.id);
  merged.events = mergeEntityLists(localNorm.events, remoteNorm.events, (x) => x.id);
  merged.transactions = mergeEntityLists(
    localNorm.transactions || [],
    remoteNorm.transactions || [],
    (x) => x.id
  );
  merged.syncUpdatedAt = Math.max(localTs, remoteTs);
  merged.syncBaseAt = remoteTs;
  return { state: merged, winner: "merged", action: "merge" };
}

// After fetch+merge, decide whether to push (never push empty; skip pure fast-forward).
export function shouldPushAfterMerge(result, hasRemoteFile) {
  const weight = syncContentWeight(result.state);
  if (weight <= 0) return false;
  if (!hasRemoteFile) return true;
  if (result.action === "fast-forward" || result.action === "noop") return false;
  return result.action === "push" || result.action === "merge" || result.winner === "local";
}

export function habitDueOn(habit, key) {
  const d = parseKey(key).getDay();
  const freq = (habit.frequency || [0, 1, 2, 3, 4, 5, 6]).map(Number);
  return freq.includes(d);
}

export function isHabitDone(habit, checkin) {
  if (!checkin) return false;
  if (habit.type === "yesno") return !!checkin.value;
  if (habit.type === "count") return Number(checkin.value) >= Number(habit.target || 1);
  if (habit.type === "duration") {
    return Number(checkin.minutes || checkin.value || 0) >= Number(habit.target || 1);
  }
  return !!checkin.value;
}

/** Next occurrence timestamp for recurring countdowns. */
export function countdownNextAt(item, nowMs) {
  const c = item || {};
  const now = nowMs != null ? new Date(nowMs) : new Date();
  const target = new Date(c.targetAt || 0);
  const repeat = c.repeat || (c.kind === "birthday" ? "yearly" : "none");
  if (!c.targetAt || repeat === "none") return c.targetAt || 0;
  if (repeat === "yearly") {
    const next = new Date(
      now.getFullYear(),
      target.getMonth(),
      target.getDate(),
      target.getHours(),
      target.getMinutes(),
      0,
      0
    );
    if (next.getTime() <= now.getTime()) next.setFullYear(next.getFullYear() + 1);
    return next.getTime();
  }
  if (repeat === "monthly") {
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      target.getDate(),
      target.getHours(),
      target.getMinutes(),
      0,
      0
    );
    if (next.getTime() <= now.getTime()) next.setMonth(next.getMonth() + 1);
    return next.getTime();
  }
  if (repeat === "weekly") {
    const targetDow = target.getDay();
    const next = new Date(now);
    next.setHours(target.getHours(), target.getMinutes(), 0, 0);
    let diff = (targetDow - now.getDay() + 7) % 7;
    if (diff === 0 && next.getTime() <= now.getTime()) diff = 7;
    next.setDate(next.getDate() + diff);
    return next.getTime();
  }
  return c.targetAt;
}

export function countdownDaysLeft(item, nowMs) {
  const next = countdownNextAt(item, nowMs);
  const diff = next - (nowMs != null ? nowMs : Date.now());
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}
