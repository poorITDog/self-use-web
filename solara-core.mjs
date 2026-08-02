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
    },
    habits: [],
    checkins: [],
    blocks: [],
    countdowns: [],
    focusSessions: [],
    goals: [],
    transactions: [],
  };
}

export function normalizeState(data) {
  const base = defaultState();
  if (!data || typeof data !== "object") return base;
  const out = { ...base, ...data };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  for (const k of [
    "habits",
    "checkins",
    "blocks",
    "countdowns",
    "focusSessions",
    "goals",
    "transactions",
  ]) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  out.syncUpdatedAt = Number(out.syncUpdatedAt) || 0;
  return out;
}

/** Last-write-wins: pick newer snapshot by syncUpdatedAt / remote updatedAt. */
export function mergeSyncState(local, remote, remoteUpdatedAt) {
  const localNorm = normalizeState(local);
  const remoteNorm = normalizeState(remote);
  const localTs = Number(localNorm.syncUpdatedAt) || 0;
  const remoteTs = Number(remoteUpdatedAt) || Number(remoteNorm.syncUpdatedAt) || 0;
  if (remoteTs > localTs) {
    remoteNorm.syncUpdatedAt = remoteTs;
    return { state: remoteNorm, winner: "remote" };
  }
  return { state: localNorm, winner: "local" };
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
