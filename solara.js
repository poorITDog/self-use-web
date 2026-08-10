(function () {
  "use strict";

  var STORAGE_KEY = "solara-v1";
  var TOKEN_KEY = "solara-google-token";
  var DRIVE_FILE = "solara-v1.json";
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var BASE_COLORS = ["#C67139", "#7A8A5E", "#D45A3C", "#3F7F9A", "#BC6C25", "#6A994E", "#E07A5F", "#556344"];
  var GROUPS = ["早上", "下午", "晚上", "健康", "工作", "生活"];
  var TIME_GROUPS = ["早上", "下午", "晚上", "其他"];
  var DOW = ["日", "一", "二", "三", "四", "五", "六"];

  var state = loadState();
  var ui = {
    view: "habits",
    settingsTab: "goals",
    calMonth: startOfMonth(new Date()),
    calSelected: dateKey(new Date()),
    calMode: "month",
    timetableDow: new Date().getDay(),
    habitDetailId: "",
    habitDetailMonth: startOfMonth(new Date()),
    habitsPanel: "today",
    timelineOpen: false,
    diaryDate: dateKey(new Date()),
    countdownUnit: "days",
    focus: {
      running: false,
      mode: "focus",
      remainMs: (state.settings.focusMin || 25) * 60000,
      totalMs: (state.settings.focusMin || 25) * 60000,
      timerId: null,
      habitId: ""
    }
  };

  var syncStatus = "disconnected";
  var uploadDebounce = null;
  var syncInFlight = null;
  var syncQueued = false;
  var autoSyncTimer = null;
  var googleTokenClient = null;
  var tokenPromiseResolve = null;
  // User dismissed Google login this session — don't auto-popup again until manual sync.
  var authPromptSkipped = false;
  var notifyTimers = [];
  var notifyIntervalId = null;
  var audioCtx = null;
  var AUTO_SYNC_MS = 3 * 60 * 1000;

  var THEME_COLORS = {
    sunshine: "#f5ead8",
    sea: "#e7eef2",
    fire: "#f6e4d6",
    ocean: "#cfe8f2",
    nightcity: "#1a1f2e",
    forest: "#e4efe6",
    mountain: "#e8eef5",
    aurora: "#1c2433",
    dusk: "#f3e0d4",
    photo: "#f5ead8"
  };

  function colors() {
    if (state.settings.palette && state.settings.palette.length) {
      return state.settings.palette.concat(BASE_COLORS);
    }
    return BASE_COLORS.slice();
  }

  function uid() {
    return "id_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function dateKey(d) {
    var x = (d instanceof Date) ? d : new Date(d);
    return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
  }

  function parseKey(k) {
    var p = k.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function todayKey() { return dateKey(new Date()); }

  // Chinese date for start / setup labels, e.g. 2026年8月3日
  function formatZhDate(ts) {
    var t = Number(ts) || 0;
    if (!t) return "";
    var d = new Date(t);
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  // Prefer createdAt; fall back to updatedAt for older records
  function startedAtMs(item) {
    if (!item) return 0;
    return Number(item.createdAt) || Number(item.updatedAt) || 0;
  }

  function startedLabel(item) {
    var s = formatZhDate(startedAtMs(item));
    return s ? "開始於 " + s : "";
  }

  // Compact start chip for goal↔habit surfaces (no setup-location copy)
  function goalMetaChipsHtml(item) {
    var start = startedLabel(item);
    if (!start) return "";
    return '<div class="goal-meta-chips"><span class="goal-meta-chip">' + esc(start) + "</span></div>";
  }

  function goalAccentColor(g, habit) {
    if (g && g.color) return g.color;
    if (habit && habit.color) return habit.color;
    return colors()[0];
  }

  function goalColorPalette() {
    // Warm Organic extras — muted terracotta / sage / sand / clay (no neon).
    var extra = [
      "#C67139", "#8F4A22", "#B05F2C", "#D4894F", "#BC6C25",
      "#7A8A5E", "#556344", "#6A994E", "#8A7A52", "#2D6A4F",
      "#3F7F9A", "#2A5669", "#A89880", "#9A3A24", "#5C5138", "#E07A5F"
    ];
    var seen = {};
    return colors().concat(extra).filter(function (c) {
      if (seen[c]) return false;
      seen[c] = true;
      return true;
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escAttr(s) { return esc(s); }

  function opt(val, label, current) {
    return '<option value="' + escAttr(val) + '"' + (String(val) === String(current) ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function fmtMin(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    var h = Math.floor(m / 60);
    var mm = m % 60;
    if (h <= 0) return mm + " 分";
    return h + " 時 " + mm + " 分";
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function defaultState() {
    return {
      version: 1,
      syncUpdatedAt: 0,
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
        notifyCountdowns: true,
        focusSoundEnabled: true
      },
      habits: [],
      checkins: [],
      blocks: [],
      countdowns: [],
      focusSessions: [],
      goals: [],
      events: [],
      dayEntries: [],
      tombstones: {}
    };
  }

  function normalizeState(data) {
    var base = defaultState();
    if (!data || typeof data !== "object") return base;
    var out = Object.assign({}, base, data);
    out.settings = Object.assign({}, base.settings, data.settings || {});
    if (out.settings.calShowHabits === undefined) out.settings.calShowHabits = true;
    if (out.settings.calShowCountdowns === undefined) out.settings.calShowCountdowns = true;
    if (!out.settings.habitsBoardMode) out.settings.habitsBoardMode = "month";
    if (out.settings.notifyEnabled === undefined) out.settings.notifyEnabled = false;
    if (out.settings.notifyHabits === undefined) out.settings.notifyHabits = true;
    if (out.settings.notifyEvents === undefined) out.settings.notifyEvents = true;
    if (out.settings.notifyCountdowns === undefined) out.settings.notifyCountdowns = true;
    if (out.settings.focusSoundEnabled === undefined) out.settings.focusSoundEnabled = true;
    out.countdowns = (Array.isArray(out.countdowns) ? out.countdowns : []).map(function (c) {
      var kind = c.kind || "countdown";
      return Object.assign({
        kind: kind,
        repeat: kind === "birthday" ? "yearly" : "none",
        showAge: false,
        note: "",
        color: BASE_COLORS[0],
        emoji: "🎯"
      }, c, {
        kind: kind,
        repeat: c.repeat || (kind === "birthday" ? "yearly" : "none")
      });
    });
    ["habits", "checkins", "blocks", "countdowns", "focusSessions", "goals", "events", "dayEntries"].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    out.dayEntries = out.dayEntries.map(function (d) { return normalizeDayEntry(d); });
    out.habits = out.habits.map(function (h) {
      var next = h && h.group === "朝早" ? Object.assign({}, h, { group: "早上" }) : (h || {});
      if (next.timeEnd === undefined) next.timeEnd = "";
      return next;
    });
    out.events = out.events.map(function (ev) {
      return Object.assign({ repeat: "none", until: "", note: "", allDay: false }, ev || {}, {
        repeat: (ev && ev.repeat) || "none",
        until: (ev && ev.until) || ""
      });
    });
    out.goals = out.goals.map(function (g) { return normalizeGoal(g); });
    if (Array.isArray(data.transactions)) out.transactions = data.transactions;
    out.syncUpdatedAt = Number(out.syncUpdatedAt) || 0;
    out.syncBaseAt = Number(out.syncBaseAt) || 0;
    out.tombstones = data.tombstones && typeof data.tombstones === "object" ? data.tombstones : {};
    return out;
  }

  function markTombstone(key) {
    if (!key) return;
    if (!state.tombstones || typeof state.tombstones !== "object") state.tombstones = {};
    state.tombstones[key] = Date.now();
  }


  // Calendar appointment occurrence (not a habit).
  function eventOccursOn(ev, key) {
    if (!ev || !ev.date || !key) return false;
    var repeat = ev.repeat || "none";
    if (key < ev.date) return false;
    if (ev.until && key > ev.until) return false;
    if (repeat === "none") return ev.date === key;
    if (repeat === "daily") return true;
    var start = parseKey(ev.date);
    var cur = parseKey(key);
    if (repeat === "weekly") return start.getDay() === cur.getDay();
    if (repeat === "monthly") return start.getDate() === cur.getDate();
    if (repeat === "yearly") {
      return start.getMonth() === cur.getMonth() && start.getDate() === cur.getDate();
    }
    return ev.date === key;
  }

  function eventRepeatLabel(repeat) {
    var map = { none: "", daily: "每日", weekly: "每週", monthly: "每月", yearly: "每年" };
    return map[repeat || "none"] || "";
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    state.syncUpdatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleDriveUpload();
  }

  // Persist only — do not bump syncUpdatedAt. Bumping here made a fresh
  // reinstall beat older Drive data on the next pull (LWW).
  function saveStateLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setSyncStatus(s) {
    syncStatus = s;
    renderSyncChip();
  }

  function syncStatusLabel() {
    if (!state.settings.googleConnected) return "未連接";
    if (syncStatus === "syncing") return "同步中";
    if (syncStatus === "failed") return "失敗";
    if (syncStatus === "synced") return "已同步";
    if (syncStatus === "needsAuth") return "需重新登入";
    return "已連接";
  }

  function renderSyncChip() {
    var el = document.getElementById("syncChip");
    if (!el) return;
    el.className = "chip sync-chip sync-" + syncStatus;
    el.setAttribute("title", syncStatus === "needsAuth"
      ? "登入已過期，點一下重新同步"
      : "雲端同步狀態");
    el.setAttribute("aria-label", "雲端同步狀態：" + syncStatusLabel());
    el.innerHTML = '<span class="sync-dot" aria-hidden="true"></span>' + syncStatusLabel();
  }

  function getStoredToken() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      var t = JSON.parse(raw);
      if (t.expiresAt && Date.now() > t.expiresAt - 60000) return null;
      return t.accessToken;
    } catch (e) {
      return null;
    }
  }

  function storeToken(accessToken, expiresIn) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      accessToken: accessToken,
      expiresAt: Date.now() + (expiresIn || 3600) * 1000
    }));
  }

  function clearStoredToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function initGoogleAuth() {
    if (!window.google || !state.settings.googleClientId) return;
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.settings.googleClientId,
      scope: DRIVE_SCOPE,
      callback: function (resp) {
        if (resp.error) {
          setSyncStatus("failed");
          if (tokenPromiseResolve) {
            tokenPromiseResolve(null);
            tokenPromiseResolve = null;
          }
          return;
        }
        storeToken(resp.access_token, resp.expires_in);
        state.settings.googleConnected = true;
        if (state.settings.autoSync === undefined) state.settings.autoSync = true;
        saveStateLocal();
        if (tokenPromiseResolve) {
          tokenPromiseResolve(resp.access_token);
          tokenPromiseResolve = null;
        }
      }
    });
  }

  function getAccessToken(prompt, opts) {
    opts = opts || {};
    var interactive = opts.interactive !== false;
    var existing = getStoredToken();
    if (existing) return Promise.resolve(existing);
    // Background/auto sync must never pop Google login — token expired until user taps sync.
    if (!interactive) return Promise.resolve(null);
    return new Promise(function (resolve) {
      if (!googleTokenClient) initGoogleAuth();
      if (!googleTokenClient) {
        resolve(null);
        return;
      }
      tokenPromiseResolve = resolve;
      googleTokenClient.requestAccessToken({ prompt: prompt || "" });
    });
  }

  function driveFindFile(token) {
    var q = "name='" + DRIVE_FILE + "' and 'appDataFolder' in parents and trashed=false";
    return fetch(
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" +
      encodeURIComponent(q) + "&fields=files(id,modifiedTime)",
      { headers: { Authorization: "Bearer " + token } }
    ).then(function (r) { return r.json(); }).then(function (data) {
      return data.files && data.files[0] ? data.files[0] : null;
    });
  }

  function driveCreateFile(token, payload) {
    var boundary = "solara_boundary";
    var meta = JSON.stringify({ name: DRIVE_FILE, parents: ["appDataFolder"] });
    var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      meta + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" +
      JSON.stringify(payload) + "\r\n--" + boundary + "--";
    return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "multipart/related; boundary=" + boundary
      },
      body: body
    }).then(function (r) { return r.json(); });
  }

  function driveUpdateFile(token, fileId, payload) {
    return fetch(
      "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );
  }

  function keepDriveSession(prev, next) {
    if (prev.settings.googleClientId) next.settings.googleClientId = prev.settings.googleClientId;
    next.settings.googleConnected = prev.settings.googleConnected;
    next.settings.autoSync = prev.settings.autoSync !== false;
    return next;
  }

  // Automatic git-like sync when connected + autoSync on.
  // opts.allowPrompt: boot / return-to-app may re-login once; interval stays silent.
  function autoDriveSync(opts) {
    opts = opts || {};
    if (!state.settings.googleConnected || state.settings.autoSync === false) {
      return Promise.resolve();
    }
    return driveSync({ push: true, allowPrompt: !!opts.allowPrompt });
  }

  function startAutoSyncLoop() {
    clearInterval(autoSyncTimer);
    if (!state.settings.googleConnected || state.settings.autoSync === false) return;
    autoSyncTimer = setInterval(function () {
      // Interval never pops login — only boot/return auto-logon may prompt.
      if (document.visibilityState === "visible") autoDriveSync();
    }, AUTO_SYNC_MS);
  }

  // Git-like Drive sync: fetch → merge → push (never push empty over cloud).
  // Always fetch+merge first; push only when needed. Queues one follow-up if busy.
  function driveSync(opts) {
    opts = opts || {};
    var wantPush = opts.push !== false;
    if (!state.settings.googleConnected) return Promise.resolve();
    // Scheduled/background sync respects autoSync; manual force always runs.
    if (!opts.force && state.settings.autoSync === false) return Promise.resolve();
    if (syncInFlight) {
      syncQueued = true;
      return syncInFlight;
    }
    setSyncStatus("syncing");
    var runQueued = function (value) {
      syncInFlight = null;
      if (syncQueued) {
        syncQueued = false;
        return driveSync({ push: true, force: !!opts.force }).then(function () {
          return value;
        });
      }
      return value;
    };
    // Manual force always prompts. Boot/return may prompt once for auto-logon.
    // Interval / edit debounce stay silent so Google UI does not spam.
    var wantInteractive = !!(opts.force || (opts.allowPrompt && !authPromptSkipped));
    var tokenOpts = { interactive: wantInteractive };
    var p = getAccessToken(opts.force ? "" : "", tokenOpts).then(function (token) {
      if (!token) {
        if (wantInteractive && !opts.force) authPromptSkipped = true;
        setSyncStatus(opts.force ? "failed" : "needsAuth");
        return runQueued();
      }
      authPromptSkipped = false;
      return driveFindFile(token).then(function (file) {
        var loadRemote = !file
          ? Promise.resolve({ file: null, remote: null, remoteTs: 0 })
          : fetch(
            "https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media",
            { headers: { Authorization: "Bearer " + token } }
          ).then(function (r) { return r.json(); }).then(function (remote) {
            return {
              file: file,
              remote: remote,
              remoteTs: new Date(file.modifiedTime).getTime()
            };
          });
        return loadRemote.then(function (pack) {
          var prev = state;
          var fromEmpty = syncContentWeight(normalizeState(state)) === 0 &&
            Object.keys(state.tombstones || {}).length === 0;
          var result;
          if (pack.remote) {
            result = mergeSyncState(state, pack.remote, pack.remoteTs);
          } else {
            result = {
              state: normalizeState(state),
              winner: "local",
              action: syncContentWeight(state) > 0 ? "push" : "noop"
            };
          }
          state = keepDriveSession(prev, result.state);
          if (pack.remoteTs) state.syncBaseAt = pack.remoteTs;
          saveStateLocal();
          applyTheme();
          render();
          if (fromEmpty && (result.winner === "remote" || result.winner === "merged")) {
            toast("已從雲端還原資料");
          }
          var doPush = wantPush && shouldPushAfterMerge(result, !!pack.file);
          // Extra guard: never upload empty snapshot onto a non-empty cloud file.
          if (doPush && syncContentWeight(state) === 0 && pack.remote &&
            syncContentWeight(normalizeState(pack.remote)) > 0 &&
            Object.keys(state.tombstones || {}).length === 0) {
            doPush = false;
          }
          if (!doPush) {
            setSyncStatus("synced");
            return runQueued(result);
          }
          var payload = state;
          var write = pack.file
            ? driveUpdateFile(token, pack.file.id, payload)
            : driveCreateFile(token, payload);
          return write.then(function () {
            state.syncBaseAt = Date.now();
            saveStateLocal();
            setSyncStatus("synced");
            return runQueued(result);
          });
        });
      });
    });
    syncInFlight = p;
    p.catch(function () {
      if (syncInFlight === p) syncInFlight = null;
      setSyncStatus("failed");
      if (syncQueued) {
        syncQueued = false;
        driveSync({ push: true, force: !!opts.force });
      }
    });
    return p;
  }

  function drivePull() {
    // Fetch+merge only (git fetch/merge), no upload.
    return driveSync({ push: false, force: true });
  }

  function drivePush() {
    // Full sync like `git pull && git push`.
    return driveSync({ push: true, force: true });
  }

  function scheduleDriveUpload() {
    if (!state.settings.googleConnected || state.settings.autoSync === false) return;
    clearTimeout(uploadDebounce);
    // Automatic fetch+merge before push after every real edit.
    uploadDebounce = setTimeout(function () {
      autoDriveSync();
    }, 1500);
  }

  function connectGoogleDrive() {
    var idEl = document.getElementById("googleClientId");
    if (idEl) state.settings.googleClientId = idEl.value.trim();
    if (!state.settings.googleClientId) return toast("請輸入 OAuth Client ID");
    saveStateLocal();
    initGoogleAuth();
    if (!googleTokenClient) return toast("Google 登入載入中，請稍後再試");
    setSyncStatus("syncing");
    authPromptSkipped = false;
    getAccessToken("consent", { interactive: true }).then(function (token) {
      if (!token) {
        setSyncStatus("failed");
        toast("連接失敗");
        return;
      }
      state.settings.googleConnected = true;
      state.settings.autoSync = true;
      saveStateLocal();
      driveSync({ push: true, force: true }).then(function () {
        startAutoSyncLoop();
        toast("已連接 Google Drive");
        render();
      });
    });
  }

  function disconnectGoogleDrive() {
    state.settings.googleConnected = false;
    clearStoredToken();
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
    saveStateLocal();
    setSyncStatus("disconnected");
    toast("已中斷連接");
    render();
  }

  function touch(obj) {
    obj.updatedAt = Date.now();
    return obj;
  }

  function syncContentWeight(s) {
    var n = s && s.habits ? s : normalizeState(s);
    return (n.habits.length || 0) + (n.checkins.length || 0) +
      (n.events.length || 0) + (n.countdowns.length || 0) +
      (n.goals.length || 0) + (n.blocks.length || 0) +
      (n.focusSessions.length || 0) + ((n.dayEntries && n.dayEntries.length) || 0) +
      ((n.transactions && n.transactions.length) || 0);
  }

  function mergeTombstones(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function (k) {
      out[k] = Math.max(Number(out[k]) || 0, Number(b[k]) || 0);
    });
    return out;
  }

  function applyTombstones(list, tombstones) {
    var stones = tombstones || {};
    return (list || []).filter(function (item) {
      if (!item) return false;
      var key = item.id;
      var alt = "";
      if (item.habitId && item.date) alt = item.habitId + "|" + item.date;
      else if (item.date && !item.habitId) alt = "day|" + item.date;
      var delAt = Math.max(Number(stones[key]) || 0, Number(stones[alt]) || 0);
      if (!delAt) return true;
      return (Number(item.updatedAt) || 0) > delAt;
    });
  }

  function mergeEntityLists(localList, remoteList, keyFn) {
    var map = {};
    var order = [];
    function put(item) {
      if (!item) return;
      var key = keyFn(item);
      if (key == null || key === "") return;
      var prev = map[key];
      if (!prev) {
        map[key] = item;
        order.push(key);
        return;
      }
      var pt = Number(prev.updatedAt) || 0;
      var it = Number(item.updatedAt) || 0;
      map[key] = it >= pt ? item : prev;
    }
    (remoteList || []).forEach(put);
    (localList || []).forEach(put);
    return order.map(function (k) { return map[k]; });
  }

  // Git-like merge — keep in sync with solara-core.mjs.
  function mergeSyncState(local, remote, remoteUpdatedAt) {
    var localNorm = normalizeState(local);
    var remoteNorm = normalizeState(remote);
    var localTs = Number(localNorm.syncUpdatedAt) || 0;
    var remoteTs = Number(remoteUpdatedAt) || Number(remoteNorm.syncUpdatedAt) || 0;
    var localWeight = syncContentWeight(localNorm);
    var remoteWeight = syncContentWeight(remoteNorm);
    var localHasTombs = Object.keys(localNorm.tombstones || {}).length > 0;

    if (remoteWeight > 0 && localWeight === 0 && !localHasTombs) {
      remoteNorm.syncUpdatedAt = Math.max(remoteTs, localTs);
      remoteNorm.syncBaseAt = remoteTs;
      return { state: remoteNorm, winner: "remote", action: "fast-forward" };
    }
    if (localWeight > 0 && remoteWeight === 0) {
      localNorm.syncBaseAt = remoteTs || localNorm.syncBaseAt || 0;
      return { state: localNorm, winner: "local", action: "push" };
    }
    if (localWeight === 0 && remoteWeight === 0 && !localHasTombs) {
      return { state: localNorm, winner: "local", action: "noop" };
    }

    var merged = normalizeState({
      version: Math.max(localNorm.version || 1, remoteNorm.version || 1),
      settings: remoteTs > localTs
        ? Object.assign({}, localNorm.settings, remoteNorm.settings)
        : Object.assign({}, remoteNorm.settings, localNorm.settings)
    });
    merged.tombstones = mergeTombstones(localNorm.tombstones, remoteNorm.tombstones);
    merged.habits = applyTombstones(
      mergeEntityLists(localNorm.habits, remoteNorm.habits, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.checkins = applyTombstones(
      mergeEntityLists(localNorm.checkins, remoteNorm.checkins, function (x) {
        return x.habitId + "|" + x.date;
      }),
      merged.tombstones
    );
    merged.blocks = applyTombstones(
      mergeEntityLists(localNorm.blocks, remoteNorm.blocks, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.countdowns = applyTombstones(
      mergeEntityLists(localNorm.countdowns, remoteNorm.countdowns, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.focusSessions = applyTombstones(
      mergeEntityLists(localNorm.focusSessions, remoteNorm.focusSessions, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.goals = applyTombstones(
      mergeEntityLists(localNorm.goals, remoteNorm.goals, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.events = applyTombstones(
      mergeEntityLists(localNorm.events, remoteNorm.events, function (x) { return x.id; }),
      merged.tombstones
    );
    merged.dayEntries = applyTombstones(
      mergeEntityLists(localNorm.dayEntries || [], remoteNorm.dayEntries || [], function (x) {
        return x.date || x.id;
      }),
      merged.tombstones
    );
    if (localNorm.transactions || remoteNorm.transactions) {
      merged.transactions = applyTombstones(
        mergeEntityLists(
          localNorm.transactions || [],
          remoteNorm.transactions || [],
          function (x) { return x.id; }
        ),
        merged.tombstones
      );
    }
    merged.syncUpdatedAt = Math.max(localTs, remoteTs, Date.now());
    merged.syncBaseAt = remoteTs;
    return { state: merged, winner: "merged", action: "merge" };
  }

  function shouldPushAfterMerge(result, hasRemoteFile) {
    var weight = syncContentWeight(result.state);
    var tombs = Object.keys((result.state && result.state.tombstones) || {}).length;
    if (weight <= 0 && tombs === 0) return false;
    if (!hasRemoteFile) return weight > 0 || tombs > 0;
    if (result.action === "fast-forward" || result.action === "noop") return false;
    return result.action === "push" || result.action === "merge" || result.winner === "local";
  }

  function applyTheme() {
    var t = state.settings.theme || "sunshine";
    document.body.setAttribute("data-theme", t);
    var scene = document.getElementById("themeScene");
    if (scene) scene.setAttribute("data-scene", t);
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", THEME_COLORS[t] || THEME_COLORS.sunshine);
    if (t === "photo" && state.settings.photoDataUrl) {
      // Washed photo sit-back treatment (Organic .washed feel)
      document.body.style.setProperty("--photo",
        "linear-gradient(180deg, rgba(251,246,238,0.72), rgba(245,234,216,0.82)), url('" + state.settings.photoDataUrl + "')");
      if (state.settings.palette && state.settings.palette[0]) {
        var a0 = state.settings.palette[0];
        var a1 = state.settings.palette[1] || a0;
        document.documentElement.style.setProperty("--color-accent", a0);
        document.documentElement.style.setProperty("--color-accent-2", a1);
        document.documentElement.style.setProperty("--accent", a0);
        document.documentElement.style.setProperty("--accent-2", a1);
        document.documentElement.style.setProperty("--accent-soft", "color-mix(in srgb, " + a0 + " 22%, white)");
      }
    } else {
      document.body.style.removeProperty("--photo");
      document.documentElement.style.removeProperty("--color-accent");
      document.documentElement.style.removeProperty("--color-accent-2");
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-2");
      document.documentElement.style.removeProperty("--accent-soft");
    }
  }

  function clearNotifyTimers() {
    notifyTimers.forEach(function (id) { clearTimeout(id); });
    notifyTimers = [];
    if (notifyIntervalId) {
      clearInterval(notifyIntervalId);
      notifyIntervalId = null;
    }
  }

  function scheduleHabitNotifications() {
    clearNotifyTimers();
    if (!state.settings.notifyEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var now = Date.now();
    if (state.settings.notifyHabits !== false) {
      state.habits.filter(function (h) { return !h.archived && h.timeOfDay; }).forEach(function (h) {
        var parts = String(h.timeOfDay).split(":");
        var target = new Date();
        target.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
        if (target.getTime() <= now) target.setDate(target.getDate() + 1);
        var key = dateKey(target);
        if (!habitDueOn(h, key)) return;
        if (isHabitDone(h, key)) return;
        var ms = target.getTime() - now;
        var tid = setTimeout(function () {
          if (Notification.permission === "granted") {
            try {
              new Notification("Solara 習慣提醒", {
                body: h.name + " 的時間到了",
                tag: "habit-" + h.id + "-" + key,
                silent: false
              });
            } catch (e) { /* ignore */ }
          }
        }, ms);
        notifyTimers.push(tid);
      });
    }
    if (state.settings.notifyEvents !== false) {
      var today = todayKey();
      eventsForDate(today).forEach(function (ev) {
        if (ev.allDay || !ev.start) return;
        var parts = String(ev.start).split(":");
        var target = parseKey(today);
        target.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
        var ms = target.getTime() - now;
        if (ms < 0 || ms > 86400000) return;
        var tid = setTimeout(function () {
          if (Notification.permission === "granted") {
            try {
              new Notification("Solara 行程提醒", {
                body: ev.title + (ev.start ? " · " + ev.start : ""),
                tag: "event-" + ev.id + "-" + today,
                silent: false
              });
            } catch (e) { /* ignore */ }
          }
        }, ms);
        notifyTimers.push(tid);
      });
    }
    if (state.settings.notifyCountdowns !== false) {
      var morning = new Date();
      morning.setHours(9, 0, 0, 0);
      var msCd = morning.getTime() - now;
      if (msCd < 0) msCd += 86400000;
      state.countdowns.forEach(function (c) {
        var days = countdownDaysLeft(c);
        if (days > 3) return;
        var tid = setTimeout(function () {
          if (Notification.permission !== "granted") return;
          try {
            var body = days <= 0
              ? (c.title + " 就是今天")
              : (c.title + " 還有 " + days + " 天");
            new Notification("Solara 倒數提醒", {
              body: body,
              tag: "countdown-" + c.id + "-" + todayKey(),
              silent: false
            });
          } catch (e) { /* ignore */ }
        }, msCd);
        notifyTimers.push(tid);
      });
    }
    notifyIntervalId = setInterval(scheduleHabitNotifications, 3600000);
  }

  function requestNotifyPermission(cb) {
    if (!("Notification" in window)) {
      toast("此瀏覽器不支援通知");
      if (cb) cb("unsupported");
      return;
    }
    if (Notification.permission === "granted") {
      if (cb) cb("granted");
      return;
    }
    if (Notification.permission === "denied") {
      toast("通知權限已被拒絕，請在瀏覽器設定中開啟");
      if (cb) cb("denied");
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === "granted") toast("已允許通知");
      else toast("未允許通知");
      if (cb) cb(perm);
      if (state.settings.notifyEnabled) scheduleHabitNotifications();
      renderSettingsBody();
    });
  }

  function ensureAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* ignore */ }
  }

  function playFocusChime() {
    if (state.settings.focusSoundEnabled === false) return;
    ensureAudio();
    if (!audioCtx) return;
    try {
      var now = audioCtx.currentTime;
      [523.25, 659.25].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        var t0 = now + i * 0.15;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.45);
      });
    } catch (e) { /* ignore */ }
  }

  function notifyFocusDone(mode) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var title = mode === "focus" ? "專注完成" : "休息結束";
    var body = mode === "focus" ? "休息一下，你做得很棒！" : "準備好繼續專注了嗎？";
    try {
      new Notification(title, { body: body, tag: "focus-done-" + mode, silent: false });
    } catch (e) { /* ignore */ }
  }

  function extractPalette(dataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      var size = 64;
      c.width = size;
      c.height = size;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      var data = ctx.getImageData(0, 0, size, size).data;
      var buckets = {};
      for (var i = 0; i < data.length; i += 16) {
        var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 180) continue;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max < 40 || min > 235) continue;
        var rq = Math.round(r / 24) * 24;
        var gq = Math.round(g / 24) * 24;
        var bq = Math.round(b / 24) * 24;
        var key = rq + "," + gq + "," + bq;
        buckets[key] = (buckets[key] || 0) + 1;
      }
      var sorted = Object.keys(buckets).sort(function (a, b) { return buckets[b] - buckets[a]; }).slice(0, 6);
      var palette = sorted.map(function (k) {
        var p = k.split(",").map(Number);
        return "#" + p.map(function (n) { return n.toString(16).padStart(2, "0"); }).join("");
      });
      cb(palette.length ? palette : BASE_COLORS.slice(0, 5));
    };
    img.onerror = function () { cb(BASE_COLORS.slice(0, 5)); };
    img.src = dataUrl;
  }

  function normalizeDayEntry(raw) {
    var d = raw || {};
    var ids = Array.isArray(d.holidayHabitIds)
      ? d.holidayHabitIds.map(String).filter(Boolean)
      : [];
    var holiday = ids.length > 0 ? true : !!d.holiday;
    return Object.assign({
      id: "",
      date: "",
      mood: 0,
      comment: "",
      holiday: false,
      holidayHabitIds: [],
      holidayReason: "",
      updatedAt: 0
    }, d, {
      mood: Math.max(0, Math.min(5, Number(d.mood) || 0)),
      comment: String(d.comment || ""),
      holiday: holiday,
      holidayHabitIds: ids,
      holidayReason: String(d.holidayReason || ""),
      date: String(d.date || "")
    });
  }

  function getDayEntry(key) {
    return (state.dayEntries || []).find(function (d) { return d.date === key; }) || null;
  }

  // Any excused habit that day (or legacy full-day holiday).
  function isHoliday(key) {
    var e = getDayEntry(key);
    if (!e) return false;
    if (e.holidayHabitIds && e.holidayHabitIds.length) return true;
    return !!e.holiday;
  }

  function holidayHabitIdList(key) {
    var e = getDayEntry(key);
    if (!e) return [];
    if (e.holidayHabitIds && e.holidayHabitIds.length) return e.holidayHabitIds.slice();
    // Legacy full-day: treat every non-archived habit as excused.
    if (e.holiday) {
      return state.habits.filter(function (h) { return !h.archived; }).map(function (h) { return h.id; });
    }
    return [];
  }

  function isHabitHoliday(habitOrId, key) {
    var id = typeof habitOrId === "string" ? habitOrId : (habitOrId && habitOrId.id);
    if (!id) return false;
    var e = getDayEntry(key);
    if (!e) return false;
    if (e.holidayHabitIds && e.holidayHabitIds.length) {
      return e.holidayHabitIds.indexOf(String(id)) >= 0;
    }
    return !!e.holiday;
  }

  function isFullDayHoliday(key) {
    var ids = holidayHabitIdList(key);
    if (!ids.length) return false;
    var active = state.habits.filter(function (h) { return !h.archived; });
    if (!active.length) return true;
    return active.every(function (h) { return ids.indexOf(h.id) >= 0; });
  }

  function setHolidayHabitIds(key, ids) {
    var clean = [];
    (ids || []).map(String).filter(Boolean).forEach(function (id) {
      if (clean.indexOf(id) < 0) clean.push(id);
    });
    upsertDayEntry(key, {
      holidayHabitIds: clean,
      holiday: clean.length > 0
    });
  }

  function toggleHabitHoliday(key, habitId) {
    var ids = holidayHabitIdList(key);
    var sid = String(habitId);
    var i = ids.indexOf(sid);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(sid);
    setHolidayHabitIds(key, ids);
  }

  function upsertDayEntry(key, patch) {
    var existing = getDayEntry(key);
    var now = Date.now();
    if (existing) {
      Object.assign(existing, patch);
      existing.date = key;
      if (Object.prototype.hasOwnProperty.call(patch, "holidayHabitIds")) {
        existing.holidayHabitIds = (patch.holidayHabitIds || []).map(String).filter(Boolean);
        existing.holiday = existing.holidayHabitIds.length > 0;
      } else if (Object.prototype.hasOwnProperty.call(patch, "holiday") && !patch.holiday) {
        existing.holiday = false;
        existing.holidayHabitIds = [];
      }
      touch(existing);
      return existing;
    }
    var created = touch(normalizeDayEntry(Object.assign({
      id: uid(),
      date: key,
      createdAt: now
    }, patch)));
    state.dayEntries.push(created);
    return created;
  }

  function moodLabel(n) {
    var map = { 1: "很低落", 2: "不太好", 3: "平常", 4: "不錯", 5: "很好" };
    return map[n] || "";
  }

  function moodEmoji(n) {
    var map = { 1: "😔", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };
    return map[n] || "·";
  }

  function habitDueOn(habit, key) {
    if (isHabitHoliday(habit, key)) return false;
    var d = parseKey(key).getDay();
    var freq = (habit.frequency || [0, 1, 2, 3, 4, 5, 6]).map(Number);
    if (freq.indexOf(d) < 0) return false;
    // Only createdAt gates history. Never use updatedAt — edits must not rewrite the past.
    var startMs = Number(habit.createdAt) || 0;
    if (startMs && key < dateKey(startMs)) return false;
    return true;
  }

  function getCheckin(habitId, key) {
    return state.checkins.find(function (c) { return c.habitId === habitId && c.date === key; });
  }

  function isHabitDone(habit, key) {
    var c = getCheckin(habit.id, key);
    if (!c) return false;
    if (habit.type === "yesno") return !!c.value;
    if (habit.type === "count") return Number(c.value) >= Number(habit.target || 1);
    if (habit.type === "duration") return Number(c.minutes || c.value || 0) >= Number(habit.target || 1);
    return !!c.value;
  }

  // Keep in sync with streakForHabit in solara-core.mjs.
  function streakFor(habit) {
    var n = 0;
    var d = new Date();
    for (var i = 0; i < 400; i++) {
      var key = dateKey(d);
      if (!habitDueOn(habit, key)) {
        // Habit holiday after check-in: still count completed days toward streak.
        if (isHabitHoliday(habit, key) && isHabitDone(habit, key)) n++;
        d.setDate(d.getDate() - 1);
        continue;
      }
      if (isHabitDone(habit, key)) {
        n++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return n;
  }

  function bestStreakFor(habit) {
    var best = 0;
    var cur = 0;
    var end = new Date();
    var start = new Date();
    start.setDate(start.getDate() - 730);
    var d = new Date(start);
    while (d <= end) {
      var key = dateKey(d);
      if (!habitDueOn(habit, key)) {
        // Match streakFor: done-then-excused days still count toward streak.
        if (isHabitHoliday(habit, key) && isHabitDone(habit, key)) {
          cur++;
          if (cur > best) best = cur;
        }
        d.setDate(d.getDate() + 1);
        continue;
      }
      if (isHabitDone(habit, key)) {
        cur++;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
      d.setDate(d.getDate() + 1);
    }
    return best;
  }

  function minutesOnDate(key) {
    var total = 0;
    state.checkins.forEach(function (c) {
      if (c.date !== key) return;
      total += Number(c.minutes || 0);
      if (!c.minutes) {
        var h = state.habits.find(function (x) { return x.id === c.habitId; });
        if (h && h.type === "duration") total += Number(c.value || 0);
      }
    });
    state.focusSessions.forEach(function (s) {
      if (dateKey(s.startedAt) === key) total += Number(s.minutes || 0);
    });
    return total;
  }

  function completionRate(key) {
    // Full-day holiday has no due habits to score; partial still scores the rest.
    if (isFullDayHoliday(key)) return null;
    var due = state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); });
    if (!due.length) {
      // All scheduled habits excused (mixed frequency) — not a 0% failure day.
      var excusedDue = state.habits.some(function (h) {
        return !h.archived && isHabitHoliday(h, key) && habitScheduleDueOn(h, key);
      });
      return excusedDue ? null : 0;
    }
    var done = due.filter(function (h) { return isHabitDone(h, key); }).length;
    return Math.round((done / due.length) * 100);
  }

  // Schedule due ignoring holiday (used to list excused habits that would have been due).
  function habitScheduleDueOn(habit, key) {
    var d = parseKey(key).getDay();
    var freq = (habit.frequency || [0, 1, 2, 3, 4, 5, 6]).map(Number);
    if (freq.indexOf(d) < 0) return false;
    var startMs = Number(habit.createdAt) || 0;
    if (startMs && key < dateKey(startMs)) return false;
    return true;
  }

  // Off-schedule weekday after the habit existed (e.g. Friday habit on Saturday).
  // Not holiday: holiday uses schedule-due + excused. Not pre-createdAt days.
  function isExtraDay(habit, key) {
    var d = parseKey(key).getDay();
    var freq = (habit.frequency || [0, 1, 2, 3, 4, 5, 6]).map(Number);
    if (freq.indexOf(d) >= 0) return false;
    var startMs = Number(habit.createdAt) || 0;
    if (startMs && key < dateKey(startMs)) return false;
    return true;
  }

  function holidayBannerText(key) {
    var dayWord = key === todayKey() ? "今天" : "當日";
    if (isFullDayHoliday(key)) {
      return dayWord + "全日放假——習慣已暫停，連續紀錄保留。";
    }
    var excusedDue = state.habits.filter(function (h) {
      return !h.archived && isHabitHoliday(h, key) && habitScheduleDueOn(h, key);
    });
    if (!excusedDue.length) return "";
    return dayWord + "有 " + excusedDue.length + " 個習慣放假，其餘仍可打卡。連續紀錄保留。";
  }

  function diaryDateChipLabel(key) {
    key = key || todayKey();
    var d = parseKey(key);
    var label = (d.getMonth() + 1) + "月" + d.getDate() + "日";
    if (key === todayKey()) return "今天 · " + label;
    return label + " · 星期" + DOW[d.getDay()];
  }

  function captureDayJournalDraft(key) {
    // Only the active view — a hidden calendar journal must not overwrite habits drafts.
    var root = document.querySelector('.view.active .day-journal[data-day-journal="' + key + '"]');
    if (!root) return;
    var commentEl = root.querySelector("textarea[data-day-comment]");
    var reasonEl = root.querySelector("input[data-holiday-reason]");
    var patch = {};
    if (commentEl) patch.comment = commentEl.value.trim();
    if (reasonEl) patch.holidayReason = reasonEl.value.trim();
    if (Object.keys(patch).length) upsertDayEntry(key, patch);
  }

  // Persist in-progress journal fields before a re-render that would wipe the DOM.
  function flushDayJournalDrafts() {
    captureDayJournalDraft(todayKey());
    if (ui.calSelected) captureDayJournalDraft(ui.calSelected);
    if (ui.diaryDate) captureDayJournalDraft(ui.diaryDate);
  }

  // Day journal: mood + comment (+ holiday reason). Per-habit holiday is on check-in rows (today)
  // or the diary holiday list (past/future days opened from calendar).
  function dayJournalHtml(key, surface) {
    surface = surface || "main";
    var entry = getDayEntry(key) || normalizeDayEntry({ date: key });
    var mood = Number(entry.mood) || 0;
    var holidayOn = isHoliday(key);
    var fullDay = isFullDayHoliday(key);
    var isToday = key === todayKey();
    var title = isToday ? "今日日記" : "當日日記";
    var moodAria = isToday ? "今日心情" : "當日心情";
    var uidSuffix = surface + "-" + key;
    var html = '<div class="day-journal" data-day-journal="' + escAttr(key) +
      '" data-journal-surface="' + escAttr(surface) + '">';
    html += '<div class="day-journal-head"><span class="section-title">' + title + "</span>";
    html += '<span class="date-chip diary-date-chip">' + esc(diaryDateChipLabel(key)) + "</span>";
    if (holidayOn) {
      html += '<span class="tag tag-accent-2">' +
        (fullDay ? "全日放假" : ("部分放假 " + holidayHabitIdList(key).length)) +
        " · 連續保留</span>";
    }
    html += "</div>";
    if (isToday) {
      html += '<p class="tiny muted day-journal-hint">記錄心情與說明。個別習慣放假請在「今天」打卡列的放假按鈕設定。</p>';
    } else {
      html += '<p class="tiny muted day-journal-hint">記錄當日心情與說明。放假可在下方習慣列設定。</p>';
    }
    html += '<div class="mood-row" role="group" aria-label="' + moodAria + '">';
    [1, 2, 3, 4, 5].forEach(function (n) {
      html += '<button type="button" class="mood-btn' + (mood === n ? " on" : "") +
        '" data-mood="' + n + '" data-day-key="' + escAttr(key) + '"' +
        ' aria-label="' + moodLabel(n) + '" aria-pressed="' + (mood === n ? "true" : "false") + '">' +
        '<span class="mood-emoji" aria-hidden="true">' + moodEmoji(n) + "</span>" +
        '<span class="mood-caption">' + moodLabel(n) + "</span></button>";
    });
    html += "</div>";
    html += '<div class="field day-journal-comment"><label for="dayComment-' + escAttr(uidSuffix) +
      '">說明</label><textarea id="dayComment-' + escAttr(uidSuffix) +
      '" data-day-comment rows="4" placeholder="例如：颱風只影響健身房；今天太累；完成後感覺很好…">' +
      esc(entry.comment || "") + "</textarea></div>";
    if (holidayOn) {
      html += '<div class="field"><label for="holidayReason-' + escAttr(uidSuffix) +
        '">放假原因</label><input id="holidayReason-' + escAttr(uidSuffix) +
        '" data-holiday-reason type="text" value="' + escAttr(entry.holidayReason || "") +
        '" placeholder="例如：颱風／旅行／病假" /></div>';
    }
    html += '<div class="row-actions"><button type="button" class="btn" data-save-day-journal="' +
      escAttr(key) + '">儲存日記</button></div>';
    html += "</div>";
    return html;
  }

  // Compact holiday toggles for a non-today diary date (calendar → 日記).
  function diaryHolidayListHtml(key) {
    var due = state.habits.filter(function (h) {
      return !h.archived && habitScheduleDueOn(h, key);
    });
    if (!due.length) return "";
    var html = '<div class="diary-holiday-list"><div class="habit-group-label">當日放假</div>';
    due.forEach(function (h) {
      html += '<div class="excused-habit-row">' +
        '<span class="holiday-habit-swatch" style="background:' + escAttr(h.color || colors()[0]) +
        '" aria-hidden="true"></span>' +
        '<span class="excused-habit-name">' + esc(h.name || "未命名") + "</span>" +
        holidayBtnHtml(h, key) +
        "</div>";
    });
    html += "</div>";
    return html;
  }

  // Compact entry on habits「今天」→ opens dedicated diary page.
  function dayJournalGateHtml(key) {
    var entry = getDayEntry(key) || normalizeDayEntry({ date: key });
    var mood = Number(entry.mood) || 0;
    var holidayIds = holidayHabitIdList(key);
    var holidayOn = holidayIds.length > 0;
    var fullDay = isFullDayHoliday(key);
    var html = '<button type="button" class="day-journal-gate day-journal-gate-slim" data-open-diary="' +
      escAttr(key) + '" aria-label="打開今日日記">';
    html += '<span class="day-journal-gate-title">今日日記</span>';
    if (holidayOn) {
      html += '<span class="tag tag-accent-2">' +
        (fullDay ? "全日放假" : ("部分放假 " + holidayIds.length)) + "</span>";
    } else if (mood) {
      html += '<span class="tag tag-accent">' + moodEmoji(mood) + " " + moodLabel(mood) + "</span>";
    }
    html += '<span class="day-journal-gate-cta">打開日記 →</span>';
    html += "</button>";
    return html;
  }

  function typeLabel(t) {
    if (t === "count") return "次數";
    if (t === "duration") return "計時";
    return "完成";
  }

  function normalizeGoal(g) {
    var raw = g || {};
    var unitMode = raw.unitMode || "";
    var unitRaw = String(raw.unit || "").trim();
    if (!unitMode) {
      if (unitRaw === "小時" || unitRaw === "hours" || unitRaw === "hr" || unitRaw === "小時數") {
        unitMode = "hours";
      } else if (!unitRaw || unitRaw === "次" || unitRaw === "count") {
        unitMode = "count";
      } else {
        unitMode = "custom";
      }
    }
    var unit = unitRaw;
    if (unitMode === "hours") unit = unit || "小時";
    if (unitMode === "count") unit = unit || "次";
    var createdAt = Number(raw.createdAt) || Number(raw.updatedAt) || null;
    return Object.assign({
      habitId: "",
      unit: "",
      unitMode: "count",
      current: 0,
      target: 1,
      kind: "short",
      goalType: "general",
      outcome: "",
      finishedAt: null,
      createdAt: null,
      color: "",
      lastBumpKey: "",
      lastBumpAmount: 0
    }, raw, {
      habitId: raw.habitId || "",
      unitMode: unitMode,
      unit: unit,
      goalType: raw.goalType || "general",
      outcome: raw.outcome || "",
      finishedAt: raw.finishedAt ? Number(raw.finishedAt) || null : null,
      createdAt: createdAt,
      color: raw.color || "",
      lastBumpKey: raw.lastBumpKey || "",
      lastBumpAmount: Number(raw.lastBumpAmount) || 0,
      current: Number(raw.current) || 0,
      target: Math.max(1, Number(raw.target) || 1)
    });
  }

  function isGoalFinished(g) { return !!(g && g.finishedAt); }
  function isGoalOpen(g) { return !isGoalFinished(g); }

  function goalUnitLabel(g) {
    if (!g) return "";
    if (g.unitMode === "hours") return "小時";
    if (g.unitMode === "count") return "次";
    return g.unit || "";
  }

  function goalTypeLabel(t) {
    if (t === "cert") return "證書";
    if (t === "outcome") return "成果";
    return "一般";
  }

  function maybeFinishGoal(g) {
    if (!g || g.finishedAt) return false;
    if (Number(g.current) < Number(g.target || 1)) return false;
    g.current = Math.max(Number(g.current) || 0, Number(g.target) || 1);
    g.finishedAt = Date.now();
    touch(g);
    return true;
  }

  function reopenGoal(g) {
    if (!g) return;
    g.finishedAt = null;
    touch(g);
  }

  // Sync linked goals from habit progress (hours goals accumulate same-day deltas).
  function bumpLinkedGoals(habit, key) {
    var names = [];
    var finishedNames = [];
    state.goals.forEach(function (g) {
      if (g.habitId !== habit.id) return;
      if (g.finishedAt) return;
      if (g.unitMode === "hours" && habit.type === "duration") {
        var c = getCheckin(habit.id, key);
        var mins = Number(c && (c.minutes != null ? c.minutes : c.value)) || 0;
        var hoursNow = Math.round((mins / 60) * 100) / 100;
        var prev = g.lastBumpKey === key ? (Number(g.lastBumpAmount) || 0) : 0;
        if (hoursNow === prev) return;
        g.current = Math.round((Number(g.current) - prev + hoursNow) * 100) / 100;
        if (g.current < 0) g.current = 0;
        g.lastBumpKey = key;
        g.lastBumpAmount = hoursNow;
      } else {
        if (g.lastBumpKey === key) return;
        g.current = Math.round((Number(g.current) + 1) * 100) / 100;
        g.lastBumpKey = key;
        g.lastBumpAmount = 1;
      }
      touch(g);
      names.push(g.title);
      if (maybeFinishGoal(g)) finishedNames.push(g.title);
    });
    return { bumped: names, finished: finishedNames };
  }

  function afterHabitCompleted(habit, key) {
    var result = bumpLinkedGoals(habit, key);
    // Check-in may already be saved; persist goal bumps too.
    if (result.bumped.length || result.finished.length) saveState();
    var s = streakFor(habit);
    var parts = [];
    if (s === 7 || s === 30 || s === 100) parts.push(habit.name + " 連續 " + s + " 天");
    if (result.bumped.length) {
      var goalBit = result.bumped.length === 1
        ? result.bumped[0] + " +1"
        : "目標進度 +" + result.bumped.length;
      parts.push((isExtraDay(habit, key) ? "已記為額外完成 · " : "") + goalBit);
    } else if (isExtraDay(habit, key)) {
      parts.push("已記為額外完成（不影響連續天數）");
    }
    if (result.finished.length) parts.push("成就解鎖：" + result.finished.join("、"));
    if (parts.length) toast(parts.join(" · "));
  }

  function toggleHabit(habitId, dateStr) {
    var habit = state.habits.find(function (h) { return h.id === habitId; });
    if (!habit) return;
    var key = dateStr || todayKey();
    var existing = getCheckin(habitId, key);
    if (habit.type === "yesno") {
      var wasDone = isHabitDone(habit, key);
      if (existing && existing.value) {
        state.checkins = state.checkins.filter(function (c) { return c.id !== existing.id; });
      } else if (existing) {
        existing.value = 1;
        if (isExtraDay(habit, key)) existing.extra = true;
        touch(existing);
      } else {
        state.checkins.push(touch({
          id: uid(), habitId: habitId, date: key, value: 1, minutes: 0, note: "",
          extra: isExtraDay(habit, key)
        }));
      }
      saveState();
      if (!wasDone && isHabitDone(habit, key)) afterHabitCompleted(habit, key);
      if (ui.habitDetailId) refreshHabitDetail();
      render();
      return;
    }
    openHabitLogModal(habit, key);
  }

  function openQuickAdd() {
    openModal(
      "<h3>快速新增</h3>" +
      '<p class="muted tiny" style="margin:0 0 12px">從任何頁面快速建立內容</p>' +
      '<div class="quick-add-grid">' +
      '<button type="button" class="quick-add-btn" id="qaHabit"><span>習慣</span><small>打卡追蹤</small></button>' +
      '<button type="button" class="quick-add-btn" id="qaEvent"><span>行程</span><small>可重複約會</small></button>' +
      '<button type="button" class="quick-add-btn" id="qaGoal"><span>目標</span><small>可連習慣</small></button>' +
      '<button type="button" class="quick-add-btn" id="qaCountdown"><span>倒數</span><small>生日／紀念日</small></button>' +
      "</div>" +
      '<div class="row-actions"><button class="btn ghost" id="qaCancel">取消</button></div>'
    );
    document.getElementById("qaCancel").onclick = closeModal;
    document.getElementById("qaHabit").onclick = function () { closeModal(); openHabitEditor(); };
    document.getElementById("qaEvent").onclick = function () {
      closeModal();
      if (ui.view !== "calendar") {
        ui.view = "calendar";
        ui.calMode = "month";
        setView("calendar");
      }
      openEventEditor();
    };
    document.getElementById("qaGoal").onclick = function () {
      closeModal();
      ui.settingsTab = "goals";
      setView("settings");
      openGoalEditor("short");
    };
    document.getElementById("qaCountdown").onclick = function () {
      closeModal();
      setView("countdown");
      openCountdownEditor();
    };
  }

  function openModal(html) {
    var modal = document.getElementById("modal");
    modal.style.transform = "";
    modal.classList.remove("sheet-dragging");
    modal.innerHTML = html;
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function closeModal() {
    ui.habitDetailId = "";
    var modal = document.getElementById("modal");
    modal.style.transform = "";
    modal.classList.remove("sheet-dragging");
    document.getElementById("modalBackdrop").classList.remove("open");
    modal.innerHTML = "";
  }

  // Pull sheet down (at scroll top) to dismiss — like iOS bottom sheet back.
  function bindModalPullDismiss() {
    var modal = document.getElementById("modal");
    var backdrop = document.getElementById("modalBackdrop");
    var startY = 0;
    var dragY = 0;
    var tracking = false;
    var dismissThreshold = 96;

    function sheetScroller() {
      return modal.querySelector(".habit-detail") || modal;
    }

    function onPointerDown(e) {
      if (!backdrop.classList.contains("open")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Don't steal pointer from buttons/inputs — otherwise click never fires.
      if (e.target.closest("button, a, input, select, textarea, label, [role='button']")) return;
      if (sheetScroller().scrollTop > 0) return;
      startY = e.clientY;
      dragY = 0;
      tracking = true;
    }

    function onPointerMove(e) {
      if (!tracking) return;
      if (sheetScroller().scrollTop > 0) {
        tracking = false;
        dragY = 0;
        modal.style.transform = "";
        modal.classList.remove("sheet-dragging");
        return;
      }
      var dy = e.clientY - startY;
      if (dy < 0) dy = 0;
      dragY = dy;
      if (dy <= 0) return;
      modal.classList.add("sheet-dragging");
      modal.style.transform = "translateY(" + dy + "px)";
      if (e.cancelable) e.preventDefault();
    }

    function onPointerUp() {
      if (!tracking) return;
      tracking = false;
      modal.classList.remove("sheet-dragging");
      if (dragY >= dismissThreshold) {
        modal.style.transform = "";
        closeModal();
      } else {
        modal.style.transform = "";
      }
      dragY = 0;
    }

    modal.addEventListener("pointerdown", onPointerDown);
    modal.addEventListener("pointermove", onPointerMove, { passive: false });
    modal.addEventListener("pointerup", onPointerUp);
    modal.addEventListener("pointercancel", onPointerUp);
  }

  document.getElementById("modalBackdrop").addEventListener("click", function (e) {
    if (e.target.id === "modalBackdrop") closeModal();
  });

  document.addEventListener("keydown", function (e) {
    // Ignore Escape while IME is composing Chinese/Japanese input.
    if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) closeModal();
  });

  bindModalPullDismiss();

  function renderTopChips() {
    var chip = document.getElementById("syncChip");
    if (chip) {
      chip.className = "chip sync-chip sync-" + syncStatus;
      chip.setAttribute("title", "雲端同步狀態");
      chip.setAttribute("aria-label", "雲端同步狀態：" + syncStatusLabel());
      chip.innerHTML = '<span class="sync-dot" aria-hidden="true"></span>' + syncStatusLabel();
    }
  }

  function dateChipLabel() {
    var d = new Date();
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  var VIEW_TITLES = {
    habits: "習慣",
    diary: "日記",
    calendar: "日曆",
    countdown: "倒數",
    focus: "專注",
    settings: "設定"
  };

  function appBarActionHtml(view) {
    if (view === "diary") {
      return '<button type="button" class="btn sm soft" data-nav="habits">返回習慣</button>';
    }
    if (view === "habits") {
      return '<button type="button" class="icon-btn" data-action="add-habit" aria-label="新增習慣">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
    }
    if (view === "calendar" && ui.calMode === "timetable") {
      return '<button type="button" class="btn sm soft" data-action="add-block">+ 時段</button>';
    }
    if (view === "calendar") {
      return '<button type="button" class="btn sm soft" data-action="add-event">+ 行程</button>';
    }
    if (view === "countdown") {
      return '<button type="button" class="btn sm soft" data-action="add-countdown">+ 新增</button>';
    }
    return "";
  }

  function renderAppBar() {
    var view = ui.view;
    var title = view === "habits" ? "Solara" : (VIEW_TITLES[view] || "Solara");
    var html = '<div class="app-bar-start' + (view === "habits" ? " app-bar-brand" : "") + '">';
    if (view === "habits") {
      html += '<div class="app-bar-brand-text">' +
        '<h1 class="app-bar-title" aria-label="Solara">' + title + "</h1>" +
        '<div class="app-bar-sub">' + dateChipLabel() + "</div></div>";
    } else {
      html += '<h1 class="app-bar-title">' + title + "</h1>";
      if (view === "diary") {
        html += '<span class="date-chip">' + esc(diaryDateChipLabel(ui.diaryDate || todayKey())) + "</span>";
      }
    }
    html += '</div><div class="app-bar-actions">' + appBarActionHtml(view);
    if (view === "habits") {
      var key = todayKey();
      var todayHabits = state.habits.filter(function (h) {
        return !h.archived && habitDueOn(h, key);
      });
      var doneCount = todayHabits.filter(function (h) { return isHabitDone(h, key); }).length;
      html += '<button type="button" class="chip sync-chip sync-' + syncStatus +
        '" id="syncChip" data-sync="drive-pull" title="' +
        (syncStatus === "needsAuth" ? "登入已過期，點一下重新同步" : "點一下立即同步") +
        '" aria-label="雲端同步狀態：' + escAttr(syncStatusLabel()) +
        '"><span class="sync-dot" aria-hidden="true"></span>' + syncStatusLabel() + "</button>";
      html += appBarProgressRingHtml(doneCount, todayHabits.length);
    }
    html += "</div>";
    var bar = document.getElementById("appBar");
    if (bar) bar.innerHTML = html;
  }

  function todayHeaderLabel() {
    var d = new Date();
    return "今天 · " + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + DOW[d.getDay()];
  }

  function todayStatusText(h, dateStr) {
    var key = dateStr || todayKey();
    var done = isHabitDone(h, key);
    var c = getCheckin(h.id, key);
    var time = habitTimeLabel(h);
    var timeBit = time ? " · " + time : "";
    if (isExtraDay(h, key)) {
      if (done) return "已額外打卡" + timeBit;
      if (h.type === "yesno") return "今日非排程 · 可加做" + timeBit;
      if (h.type === "count") return "加做 · " + (c ? c.value : 0) + " / " + (h.target || 1) + " 次" + timeBit;
      return "加做 · " + fmtMin(c ? (c.minutes || c.value || 0) : 0) + " / " + fmtMin(h.target || 1) + timeBit;
    }
    if (!habitDueOn(h, key)) return "休息日";
    if (h.type === "yesno") return (done ? "已完成" : "未完成") + timeBit;
    if (h.type === "count") return (c ? c.value : 0) + " / " + (h.target || 1) + " 次" + timeBit;
    return fmtMin(c ? (c.minutes || c.value || 0) : 0) + " / " + fmtMin(h.target || 1) + timeBit;
  }

  function checkBtnHtml(h, key, cls) {
    key = key || todayKey();
    var done = isHabitDone(h, key);
    var mark = done
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
      : "";
    return '<button type="button" class="' + (cls || "check") + (done ? " on" : "") +
      '" style="--hcolor:' + h.color + '" data-toggle="' + h.id +
      (key !== todayKey() ? '" data-toggle-date="' + key : "") +
      '" aria-label="' + (done ? "取消完成" : "完成") + '">' + mark + "</button>";
  }

  function appBarProgressRingHtml(doneCount, total) {
    var r = 19;
    var circ = 2 * Math.PI * r;
    var pct = total ? doneCount / total : 0;
    var offset = circ * (1 - pct);
    // Track uses ink-tinted stroke so the circle reads at 0% (empty accent arc).
    return '<div class="app-bar-ring" aria-label="今天完成 ' + doneCount + "/" + total + '">' +
      '<svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">' +
      '<circle class="ring-track" cx="23" cy="23" r="19" fill="none" stroke="color-mix(in srgb, var(--color-text) 32%, var(--color-neutral-300))" stroke-width="5"></circle>' +
      '<circle class="ring-fill" cx="23" cy="23" r="19" fill="none" stroke="var(--color-accent)" stroke-width="5" stroke-linecap="round" ' +
      'stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) +
      '" transform="rotate(-90 23 23)"></circle></svg>' +
      '<span class="app-bar-ring-label">' + doneCount + "/" + total + "</span></div>";
  }

  function progressRingHtml(pct, size) {
    size = size || 72;
    return '<div class="progress-ring" style="--p:' + pct + '%;--ring-size:' + size + 'px" aria-label="今天完成 ' + pct + '%">' +
      '<div class="progress-ring-inner"><strong>' + pct + '</strong><span>%</span></div></div>';
  }

  function todayStripHtml(todayHabits) {
    var key = todayKey();
    var fullHoliday = isFullDayHoliday(key);
    var excusedDue = state.habits.filter(function (h) {
      return !h.archived && isHabitHoliday(h, key) && habitScheduleDueOn(h, key);
    });
    var partialHoliday = !fullHoliday && excusedDue.length > 0;
    var holidayCount = excusedDue.length;
    var mins = minutesOnDate(key);
    var agenda = eventsForDate(key);
    // Header SVG ring is the sole completion meter — strip only carries holiday / agenda / minutes.
    if (!fullHoliday && !partialHoliday && !agenda.length && !mins) return "";
    var html = '<div class="today-strip today-strip-slim">';
    html += '<div class="today-strip-head">';
    if (fullHoliday) {
      html += '<div class="today-progress-text">今天全日放假 <strong>連續紀錄保留</strong>' +
        (mins ? '<span class="stat-sep" aria-hidden="true">·</span>投入 <strong>' + fmtMin(mins) + "</strong>" : "") +
        "</div>";
      html += '<div class="holiday-chip-ring" aria-label="全日放假">假</div></div>';
      html += '<div class="tiny muted" style="margin-top:8px">全日放假不會計入未完成。</div>';
    } else if (partialHoliday) {
      html += '<div class="today-progress-text">' +
        '<span class="today-stat today-stat-holiday">' + holidayCount + " 個放假</span>" +
        (mins ? '<span class="stat-sep" aria-hidden="true">·</span><span class="today-stat">投入 <strong>' +
          fmtMin(mins) + "</strong></span>" : "") +
        "</div></div>";
      html += '<div class="tiny muted" style="margin-top:8px">已放假習慣不計未完成，其餘仍可打卡。</div>';
    } else {
      html += '<div class="today-progress-text">' +
        '<span class="today-stat">投入 <strong>' + fmtMin(mins) + "</strong></span></div></div>";
    }
    if (agenda.length) {
      html += '<div class="today-agenda">';
      agenda.slice(0, 3).forEach(function (ev) {
        var t = ev.allDay ? "全天" : (ev.start || "");
        var rep = eventRepeatLabel(ev.repeat);
        html += '<button type="button" class="today-agenda-item" data-edit-event="' + ev.id + '">' +
          '<span class="cal-event-dot" style="background:' + (ev.color || colors()[0]) + '"></span>' +
          '<span class="today-agenda-title">' + esc(ev.title) + "</span>" +
          '<span class="muted tiny">' + esc(t) + (rep ? " · " + rep : "") + "</span></button>";
      });
      if (agenda.length > 3) {
        html += '<div class="muted tiny">還有 ' + (agenda.length - 3) + " 個行程</div>";
      }
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function groupOrderIndex(group) {
    var g = group || "";
    var idx = GROUPS.indexOf(g);
    return idx >= 0 ? idx : GROUPS.length;
  }

  function groupHabits(habits) {
    var map = {};
    habits.forEach(function (h) {
      var g = h.group || "其他";
      if (!map[g]) map[g] = [];
      map[g].push(h);
    });
    var keys = Object.keys(map).sort(function (a, b) {
      var da = groupOrderIndex(a);
      var db = groupOrderIndex(b);
      if (da !== db) return da - db;
      return a.localeCompare(b, "zh-Hant");
    });
    return keys.map(function (k) { return { group: k, habits: map[k] }; });
  }

  var chevronSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  function weekStripHtml(habit) {
    var d = new Date();
    var start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    var html = '<div class="week-strip" aria-label="本週記錄">';
    for (var i = 0; i < 7; i++) {
      var cur = new Date(start);
      cur.setDate(start.getDate() + i);
      var key = dateKey(cur);
      var due = habitDueOn(habit, key);
      var scheduleDue = habitScheduleDueOn(habit, key);
      var done = isHabitDone(habit, key);
      var cls = "week-cell";
      if (key === todayKey()) cls += " today";
      if (!scheduleDue && done) cls += " extra";
      else if (!scheduleDue || !due) cls += " off";
      else if (done) cls += " done";
      else if (key <= todayKey()) cls += " missed";
      else cls += " future";
      var inner = done ? "✓" : String(cur.getDate());
      html += '<span class="' + cls + '" style="--hcolor:' + habit.color + '">' + inner + "</span>";
    }
    html += "</div>";
    return html;
  }

  function habitListRowHtml(h) {
    var key = todayKey();
    var done = isHabitDone(h, key);
    var rate = monthRate(h);
    return '<article class="habit-card habit-row' + (done ? " done" : "") + '" style="--hcolor:' + h.color + '">' +
      checkBtnHtml(h, key, "check check-lg") +
      '<button type="button" class="habit-row-body" data-habit-open="' + h.id + '">' +
      '<div class="habit-row-name">' + habitEmoji(h) + esc(h.name) + "</div>" +
      '<div class="habit-row-meta">連續天數 ' + streakFor(h) + " · 最佳 " + bestStreakFor(h) +
      " · 本月完成率 " + rate + "%</div>" +
      weekStripHtml(h) +
      linkedGoalBadgeHtml(h) +
      "</button>" +
      '<button type="button" class="habit-row-chevron" data-habit-open="' + h.id + '" aria-label="詳情">' +
      chevronSvg + "</button></article>";
  }

  function habitEmoji(h) {
    return (h && h.emoji) ? h.emoji + " " : "";
  }

  // Habit suggested window label, e.g. 06:30–08:30
  function habitTimeLabel(h) {
    if (!h || !h.timeOfDay) return "";
    if (h.timeEnd && h.timeEnd !== h.timeOfDay) return h.timeOfDay + "–" + h.timeEnd;
    return h.timeOfDay;
  }

  function periodDoneCount(habit, mode) {
    var now = new Date();
    var count = 0;
    if (mode === "week") {
      var start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      for (var i = 0; i < 7; i++) {
        var cur = new Date(start);
        cur.setDate(start.getDate() + i);
        var key = dateKey(cur);
        if (habitDueOn(habit, key) && isHabitDone(habit, key)) count++;
      }
      return count;
    }
    return monthDoneDaysFor(habit, startOfMonth(now));
  }

  function monthDoneDaysFor(habit, month) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var days = new Date(y, m + 1, 0).getDate();
    var count = 0;
    for (var d = 1; d <= days; d++) {
      var key = dateKey(new Date(y, m, d));
      if (key > todayKey()) break;
      if (!habitDueOn(habit, key)) continue;
      if (isHabitDone(habit, key)) count++;
    }
    return count;
  }

  // Extra (off-schedule) completions in a month — kept separate from schedule rate.
  function monthExtraDaysFor(habit, month) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var days = new Date(y, m + 1, 0).getDate();
    var count = 0;
    for (var d = 1; d <= days; d++) {
      var key = dateKey(new Date(y, m, d));
      if (key > todayKey()) break;
      if (!isExtraDay(habit, key)) continue;
      if (isHabitDone(habit, key)) count++;
    }
    return count;
  }

  function monthExtraDays(habit) {
    return monthExtraDaysFor(habit, ui.habitDetailMonth || startOfMonth(new Date()));
  }

  function monthRateFor(habit, month) {
    var y = month.getFullYear();
    var m = month.getMonth();
    var days = new Date(y, m + 1, 0).getDate();
    var due = 0;
    var done = 0;
    for (var d = 1; d <= days; d++) {
      var key = dateKey(new Date(y, m, d));
      if (key > todayKey()) break;
      if (!habitDueOn(habit, key)) continue;
      due++;
      if (isHabitDone(habit, key)) done++;
    }
    return due ? Math.round((done / due) * 100) : 0;
  }

  function habitBoxDayCellHtml(habit, key, dayLabel) {
    var due = habitDueOn(habit, key);
    var scheduleDue = habitScheduleDueOn(habit, key);
    var done = isHabitDone(habit, key);
    var extra = !scheduleDue && done;
    var cls = "habit-box-day";
    if (key === todayKey()) cls += " today";
    if (extra) cls += " extra";
    else if (!scheduleDue && key <= todayKey()) cls += " can-extra";
    else if (!scheduleDue || !due) cls += " off";
    else if (done) cls += " done";
    else if (key > todayKey()) cls += " future";
    else cls += " missed";
    var inner = done ? "✓" : (!scheduleDue ? "–" : String(dayLabel));
    var style = ' style="--hcolor:' + habit.color + '"';
    // Past/today: allow schedule days and off-schedule extra check-ins.
    if (key <= todayKey()) {
      return '<button type="button" class="' + cls + '"' + style +
        ' data-habit-day="' + habit.id + "|" + key + '" aria-label="' + key +
        (scheduleDue ? "" : " 額外") + '">' + inner + "</button>";
    }
    return '<span class="' + cls + '"' + style + '>' + inner + "</span>";
  }

  function habitBoxMonthCalHtml(habit) {
    var month = startOfMonth(new Date());
    var y = month.getFullYear();
    var m = month.getMonth();
    var firstDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var html = '<div class="habit-box-cal habit-box-cal-month" style="--hcolor:' + habit.color + '"><div class="habit-box-grid">';
    for (var i = 0; i < firstDow; i++) html += '<span class="habit-box-day pad" aria-hidden="true"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dateKey(new Date(y, m, day));
      html += habitBoxDayCellHtml(habit, key, day);
    }
    html += "</div></div>";
    return html;
  }

  function habitBoxWeekCalHtml(habit) {
    var d = new Date();
    var start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    var html = '<div class="habit-box-cal habit-box-cal-week" style="--hcolor:' + habit.color + '"><div class="habit-box-grid week">';
    for (var i = 0; i < 7; i++) {
      var cur = new Date(start);
      cur.setDate(start.getDate() + i);
      var key = dateKey(cur);
      html += habitBoxDayCellHtml(habit, key, cur.getDate());
    }
    html += "</div></div>";
    return html;
  }

  function habitBoxMonthLabel() {
    var month = startOfMonth(new Date());
    return month.getFullYear() + "年" + (month.getMonth() + 1) + "月";
  }

  function habitBoxHtml(habit, mode) {
    mode = mode || state.settings.habitsBoardMode || "month";
    var rate = mode === "week"
      ? (function () {
        var now = new Date();
        var start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        var due = 0;
        var done = 0;
        for (var i = 0; i < 7; i++) {
          var cur = new Date(start);
          cur.setDate(start.getDate() + i);
          var key = dateKey(cur);
          if (!habitDueOn(habit, key)) continue;
          due++;
          if (isHabitDone(habit, key)) done++;
        }
        return due ? Math.round((done / due) * 100) : 0;
      })()
      : monthRate(habit);
    var checks = periodDoneCount(habit, mode === "week" ? "week" : "month");
    var streak = streakFor(habit);
    var best = bestStreakFor(habit);
    var cal = mode === "week" ? habitBoxWeekCalHtml(habit) : habitBoxMonthCalHtml(habit);
    var key = todayKey();
    return '<article class="habit-box" style="--hcolor:' + habit.color + '">' +
      '<div class="habit-box-top">' +
      '<button type="button" class="habit-box-head" data-habit-box-open="' + habit.id + '">' +
      '<span class="habit-box-emoji">' + esc(habit.emoji || "✓") + "</span>" +
      '<span class="habit-box-name">' + esc(habit.name) + "</span></button>" +
      checkBtnHtml(habit, key, "check check-lg") + "</div>" +
      '<div class="habit-box-month-label">' + habitBoxMonthLabel() + "</div>" +
      cal +
      '<div class="habit-box-stats">' +
      '<div class="habit-box-rate-wrap" style="--p:' + rate + '%;--hcolor:' + habit.color + '" aria-label="完成率 ' + rate + '%">' +
      '<span class="habit-box-rate">' + rate + "%</span></div>" +
      '<div class="habit-box-stat-items">' +
      '<span class="habit-box-checks" aria-label="完成次數">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
      checks + "</span>" +
      '<span class="habit-box-streak" aria-label="當前連續">連續 ' + streak + "</span>" +
      '<span class="habit-box-best" aria-label="最佳連續">最佳 ' + best + "</span>" +
      "</div></div>" +
      linkedGoalBadgeHtml(habit) +
      "</article>";
  }

  function linkedGoalBadgeHtml(habit, compact) {
    var gs = state.goals.filter(function (g) {
      return g.habitId === habit.id && isGoalOpen(g);
    });
    if (!gs.length) return "";
    if (compact) {
      // Check-in rows: one quiet chip — no nested progress card (avoids sticky clutter).
      var g0 = gs[0];
      var pct0 = Math.min(100, Math.round((Number(g0.current) / Math.max(1, Number(g0.target))) * 100));
      return '<span class="habit-goal-chip" style="--hcolor:' + escAttr(goalAccentColor(g0, habit)) + '">' +
        '<span class="goal-habit-dot" aria-hidden="true"></span>' +
        esc(g0.title) + " · " + pct0 + "%</span>";
    }
    var html = '<div class="habit-goal-badges">';
    gs.slice(0, 2).forEach(function (g) {
      var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
      var unit = goalUnitLabel(g);
      var start = startedLabel(g);
      html += '<div class="habit-goal-badge" style="--hcolor:' + escAttr(goalAccentColor(g, habit)) + '">' +
        '<span class="habit-goal-badge-title"><span class="goal-habit-dot" aria-hidden="true"></span>目標 · ' +
        esc(g.title) + "</span>" +
        '<span class="muted tiny">' + g.current + "/" + g.target +
        (unit ? " " + unit : "") + " · " + pct + "%" +
        (start ? " · " + start : "") + "</span>" +
        '<div class="progress-bar-slim"><i style="width:' + pct + '%"></i></div></div>';
    });
    html += "</div>";
    return html;
  }

  function todayCheckinRowHtml(h, opts) {
    opts = opts || {};
    var key = todayKey();
    var done = isHabitDone(h, key);
    var streak = streakFor(h);
    var emoji = (h && h.emoji) ? h.emoji : "🌱";
    var tint = "color-mix(in srgb, " + (h.color || "var(--color-accent)") + " 16%, var(--color-neutral-100))";
    var extra = !!opts.extra || isExtraDay(h, key);
    return '<article class="habit-card habit-checkin-row' + (done ? " done" : "") +
      (extra ? " is-extra" : "") + '" style="--hcolor:' + h.color + '">' +
      '<button type="button" class="habit-row-body" data-habit-open="' + h.id + '">' +
      '<span class="habit-emoji-tile" style="background:' + tint + '" aria-hidden="true">' + emoji + "</span>" +
      '<span class="habit-row-copy">' +
      '<span class="habit-row-name">' + esc(h.name) +
      (extra ? '<span class="extra-tag">額外</span>' : "") + "</span>" +
      '<span class="habit-row-meta">' + todayStatusText(h, key) +
      (streak ? '<span class="habit-row-streak">🔥 ' + streak + "</span>" : "") +
      linkedGoalBadgeHtml(h, true) +
      "</span>" +
      "</span></button>" +
      '<span class="habit-row-actions">' +
      (extra
        ? '<span class="habit-row-actions-spacer" aria-hidden="true"></span>'
        : holidayBtnHtml(h, key)) +
      checkBtnHtml(h, key, "check check-row") +
      "</span></article>";
  }

  function holidayBtnHtml(h, key) {
    key = key || todayKey();
    var on = isHabitHoliday(h, key);
    var dayBit = key === todayKey() ? "今天此習慣放假" : "此日此習慣放假";
    return '<button type="button" class="habit-holiday-btn' + (on ? " on" : "") +
      '" data-toggle-habit-holiday="' + escAttr(h.id) + '" data-day-key="' + escAttr(key) + '"' +
      ' aria-pressed="' + (on ? "true" : "false") + '"' +
      ' aria-label="' + (on ? "取消放假" : "設為放假") + '" title="' +
      (on ? "取消放假" : dayBit) + '">' +
      (on ? "取消" : "放假") + "</button>";
  }

  function todayUnifiedTimelineHtml() {
    var key = todayKey();
    var items = [];
    eventsForDate(key).forEach(function (ev) {
      items.push({
        sort: ev.allDay ? -1 : timeToMinutes(ev.start || "09:00"),
        time: ev.allDay ? "全天" : (ev.start || ""),
        title: ev.title,
        color: ev.color || colors()[0],
        kind: "行程",
        meta: eventRepeatLabel(ev.repeat),
        eventId: ev.id
      });
    });
    state.habits.filter(function (h) {
      return !h.archived && habitDueOn(h, key) && h.timeOfDay;
    }).forEach(function (h) {
      var done = isHabitDone(h, key);
      items.push({
        sort: timeToMinutes(h.timeOfDay),
        time: habitTimeLabel(h),
        title: h.name,
        color: h.color,
        kind: done ? "習慣 · 已完成" : "習慣 · 點此打卡",
        meta: "",
        habitId: h.id,
        done: done
      });
    });
    items.sort(function (a, b) { return a.sort - b.sort; });
    if (!items.length) return "";
    // Remember open state across re-renders (打卡/放假 must not collapse the rail).
    var html = '<details class="today-timeline-wrap"' + (ui.timelineOpen ? " open" : "") +
      '><summary class="today-timeline-summary">今日時間軸' +
      '<span class="today-timeline-count">' + items.length + "</span></summary>" +
      '<div class="today-timeline">';
    items.forEach(function (it) {
      if (it.habitId) {
        var hab = state.habits.find(function (x) { return x.id === it.habitId; });
        // Circular check matches DC habit rows; fixed rail keeps 放假/打卡 columns aligned.
        html += '<div class="today-timeline-item' + (it.done ? " done" : "") + '">' +
          '<span class="today-timeline-time">' + esc(it.time) + "</span>" +
          '<span class="today-timeline-dot" style="background:' + it.color + '"></span>' +
          '<button type="button" class="today-timeline-body" data-habit-open="' + it.habitId + '">' +
          "<strong>" + esc(it.title) + "</strong>" +
          '<span class="muted tiny">' + esc(it.kind) + "</span></button>" +
          '<span class="habit-row-actions">' +
          (hab ? holidayBtnHtml(hab, key) : '<span class="habit-row-actions-spacer" aria-hidden="true"></span>') +
          checkBtnHtml(hab || { id: it.habitId, color: it.color }, key, "check check-row") +
          "</span></div>";
      } else {
        html += '<button type="button" class="today-timeline-item" data-edit-event="' + it.eventId + '">' +
          '<span class="today-timeline-time">' + esc(it.time) + "</span>" +
          '<span class="today-timeline-dot" style="background:' + it.color + '"></span>' +
          '<span class="today-timeline-body"><strong>' + esc(it.title) + "</strong>" +
          '<span class="muted tiny">' + esc(it.kind) + (it.meta ? " · " + it.meta : "") +
          "</span></span></button>";
      }
    });
    html += "</div></details>";
    return html;
  }

  function todayCheckinHtml(todayHabits) {
    var key = todayKey();
    var excused = state.habits.filter(function (h) {
      return !h.archived && isHabitHoliday(h, key) && habitScheduleDueOn(h, key);
    });
    // Full-day holiday pauses everything — don't offer off-schedule extras.
    var extraHabits = isFullDayHoliday(key)
      ? []
      : state.habits.filter(function (h) {
        return !h.archived && isExtraDay(h, key);
      });
    if (!todayHabits.length) {
      if (excused.length && !extraHabits.length) {
        var emptyMsg = isFullDayHoliday(key)
          ? "今天全日放假，習慣已暫停，連續紀錄保留。"
          : "今日應做的習慣都放假了，連續紀錄保留。";
        return '<div class="empty compact"><p>' + emptyMsg + "</p></div>" +
          excusedHolidayListHtml(excused);
      }
      if (!extraHabits.length) {
        return '<div class="empty compact"><p>今天沒有需要完成的習慣</p>' +
          '<button class="btn sm" data-action="add-habit">+ 新增習慣</button></div>';
      }
      var onlyExtra = '<div class="empty compact"><p>今天沒有排程習慣</p></div>';
      onlyExtra += extraHabitsHtml(extraHabits);
      if (excused.length) onlyExtra += excusedHolidayListHtml(excused);
      return onlyExtra;
    }
    var html = '<div class="today-checkin">';
    var grouped = {};
    todayHabits.forEach(function (h) {
      var g = TIME_GROUPS.indexOf(h.group) >= 0 ? h.group : "其他";
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(h);
    });
    TIME_GROUPS.forEach(function (g) {
      if (!grouped[g] || !grouped[g].length) return;
      var doneInGroup = grouped[g].filter(function (h) { return isHabitDone(h, key); }).length;
      html += '<div class="habit-group-section">' +
        '<div class="habit-group-label"><span>' + g + "</span>" +
        '<span class="habit-group-count">' + doneInGroup + "/" + grouped[g].length + "</span></div>";
      html += grouped[g].map(function (h) { return todayCheckinRowHtml(h, { extra: false }); }).join("");
      html += "</div>";
    });
    html += "</div>";
    if (extraHabits.length) html += extraHabitsHtml(extraHabits);
    if (excused.length) html += excusedHolidayListHtml(excused);
    return html;
  }

  function extraHabitsHtml(extraHabits) {
    var html = '<div class="extra-habits">' +
      '<div class="habit-group-label extra-habits-label"><span>額外完成</span>' +
      '<span class="extra-habits-hint">今天沒排到，做了也能打卡並計入目標</span></div>';
    html += extraHabits.map(function (h) { return todayCheckinRowHtml(h, { extra: true }); }).join("");
    html += "</div>";
    return html;
  }

  function excusedHolidayListHtml(excused) {
    var key = todayKey();
    var html = '<div class="excused-habits"><div class="habit-group-label">今日放假</div>';
    excused.forEach(function (h) {
      html += '<div class="excused-habit-row">' +
        '<span class="holiday-habit-swatch" style="background:' + escAttr(h.color || colors()[0]) +
        '" aria-hidden="true"></span>' +
        '<span class="excused-habit-name">' + esc(h.name || "未命名") + "</span>" +
        holidayBtnHtml(h, key) +
        "</div>";
    });
    html += "</div>";
    return html;
  }

  function habitBoardHtml(active) {
    var mode = state.settings.habitsBoardMode || "month";
    var html = '<div class="habits-board">';
    html += '<div class="habits-board-toolbar">' +
      '<span class="section-title">儀表板</span>' +
      '<div class="seg seg-inline">' +
      '<button type="button" data-habits-board-mode="month" class="' + (mode === "month" ? "on" : "") + '">每月</button>' +
      '<button type="button" data-habits-board-mode="week" class="' + (mode === "week" ? "on" : "") + '">每週</button>' +
      '<button type="button" data-habits-board-mode="overview" class="' + (mode === "overview" ? "on" : "") + '">總覽</button>' +
      "</div></div>";
    if (mode === "overview") {
      html += '<div class="habit-groups">';
      groupHabits(active).forEach(function (section) {
        html += '<div class="habit-group-section"><div class="habit-group-label">' + esc(section.group) + "</div>";
        html += section.habits.map(habitListRowHtml).join("");
        html += "</div>";
      });
      html += "</div>";
    } else if (!active.length) {
      html += '<div class="empty compact board-empty"><p>還沒有習慣。新增一個開始追蹤。</p>' +
        '<button class="btn sm" data-action="add-habit">+ 新增習慣</button></div>';
    } else {
      html += '<div class="habit-box-grid-wrap">';
      active.forEach(function (h) { html += habitBoxHtml(h, mode); });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function countdownNextAt(c) {
    var now = Date.now();
    var target = new Date(c.targetAt || 0);
    var repeat = c.repeat || (c.kind === "birthday" ? "yearly" : "none");
    if (!c.targetAt || repeat === "none") return c.targetAt || 0;
    var nowD = new Date(now);
    if (repeat === "yearly") {
      var next = new Date(nowD.getFullYear(), target.getMonth(), target.getDate(), target.getHours(), target.getMinutes(), 0, 0);
      if (next.getTime() <= now) next.setFullYear(next.getFullYear() + 1);
      return next.getTime();
    }
    if (repeat === "monthly") {
      var nextM = new Date(nowD.getFullYear(), nowD.getMonth(), target.getDate(), target.getHours(), target.getMinutes(), 0, 0);
      if (nextM.getTime() <= now) nextM.setMonth(nextM.getMonth() + 1);
      return nextM.getTime();
    }
    if (repeat === "weekly") {
      var targetDow = target.getDay();
      var nextW = new Date(nowD);
      nextW.setHours(target.getHours(), target.getMinutes(), 0, 0);
      var diff = (targetDow - nowD.getDay() + 7) % 7;
      if (diff === 0 && nextW.getTime() <= now) diff = 7;
      nextW.setDate(nextW.getDate() + diff);
      return nextW.getTime();
    }
    return c.targetAt;
  }

  function countdownDaysLeft(c) {
    var diff = countdownNextAt(c) - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / 86400000);
  }

  function countdownDisplayAmount(days, unit) {
    if (unit === "weeks") return { value: Math.max(0, Math.ceil(days / 7)), label: "週" };
    if (unit === "months") return { value: Math.max(0, Math.ceil(days / 30)), label: "月" };
    return { value: days, label: "天" };
  }

  function birthdayAge(c) {
    if (!c.showAge || c.kind !== "birthday") return null;
    var birth = new Date(c.targetAt);
    var next = new Date(countdownNextAt(c));
    return next.getFullYear() - birth.getFullYear();
  }

  function monthDoneDays(habit) {
    return monthDoneDaysFor(habit, ui.habitDetailMonth || startOfMonth(new Date()));
  }

  function totalDoneDays(habit) {
    var dates = {};
    state.checkins.forEach(function (c) {
      if (c.habitId === habit.id && isHabitDone(habit, c.date)) dates[c.date] = true;
    });
    return Object.keys(dates).length;
  }

  function habitCalGridHtml(habit, month, prefix) {
    prefix = prefix || "habit";
    var y = month.getFullYear();
    var m = month.getMonth();
    var firstDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var html = '<div class="' + prefix + '-cal" style="--hcolor:' + habit.color + '">';
    html += '<div class="' + prefix + '-dow">';
    DOW.forEach(function (d) { html += "<span>" + d + "</span>"; });
    html += '</div><div class="' + prefix + '-grid">';
    for (var i = 0; i < firstDow; i++) html += '<span class="habit-day pad" aria-hidden="true"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dateKey(new Date(y, m, day));
      var due = habitDueOn(habit, key);
      var scheduleDue = habitScheduleDueOn(habit, key);
      var done = isHabitDone(habit, key);
      var cls = "habit-day";
      if (key === todayKey()) cls += " today";
      if (!scheduleDue && done) cls += " extra";
      else if (!scheduleDue && key <= todayKey()) cls += " can-extra";
      else if (!scheduleDue || !due) cls += " off";
      else if (key > todayKey()) cls += " future";
      else if (done) cls += " done";
      else cls += " missed";
      var label = done ? "✓" : String(day);
      html += '<button type="button" class="' + cls + '" style="--hcolor:' + habit.color +
        '" data-habit-day="' + habit.id + "|" + key + '" aria-label="' + key +
        (scheduleDue ? "" : " 額外") + '"' +
        (key <= todayKey() ? "" : " tabindex=\"-1\"") + ">" + label + "</button>";
    }
    html += "</div></div>";
    return html;
  }

  function habitStatTotal(h) {
    if (h.type === "duration") return { label: "累計時數", value: fmtMin(totalMinutes(h)) };
    if (h.type === "count") return { label: "累計次數", value: totalCount(h) + " 次" };
    return { label: "完成日數", value: totalDoneDays(h) + " 日" };
  }

  // Compact ~12-week contribution heatmap (Habitify-style glance).
  function habitYearHeatHtml(habit) {
    var end = new Date();
    var start = new Date();
    start.setDate(end.getDate() - 12 * 7 + 1);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
    var html = '<div class="habit-year-heat"><div class="section-title" style="padding:8px 0 4px">近 12 週</div>' +
      '<div class="habit-year-grid" aria-label="近十二週完成熱圖">';
    var cur = new Date(start);
    // Inclusive through today (fixed 84 cells used to stop 1–2 days early).
    while (dateKey(cur) <= todayKey()) {
      var key = dateKey(cur);
      var scheduleDue = habitScheduleDueOn(habit, key);
      var due = habitDueOn(habit, key);
      var done = isHabitDone(habit, key);
      var cls = "heat-cell";
      if (!scheduleDue && done) cls += " extra";
      else if (!scheduleDue || !due) cls += " off";
      else if (done) cls += " done";
      else cls += " missed";
      html += '<span class="' + cls + '" style="--hcolor:' + habit.color + '" title="' + key +
        (scheduleDue ? "" : (done ? " 額外完成" : " 非排程")) + '"></span>';
      cur.setDate(cur.getDate() + 1);
    }
    html += "</div></div>";
    return html;
  }

  function openHabitDetail(habit, month) {
    ui.habitDetailId = habit.id;
    ui.habitDetailMonth = month || ui.habitDetailMonth || startOfMonth(new Date());
    var ym = ui.habitDetailMonth;
    var stat = habitStatTotal(habit);
    var html = '<div class="habit-detail">' +
      '<div class="sheet-topbar">' +
      '<button type="button" class="sheet-back" id="hdBack" aria-label="返回習慣主頁">‹ 返回</button>' +
      '<div class="sheet-handle-wrap" aria-hidden="true"><span class="sheet-handle"></span></div>' +
      '<button type="button" class="btn sm soft sheet-top-edit" data-edit-habit="' + habit.id +
      '" aria-label="編輯習慣 ' + escAttr(habit.name) + '">編輯</button></div>' +
      '<div class="habit-detail-hero" style="--hcolor:' + habit.color + '">' +
      '<span class="dot dot-lg" style="--hcolor:' + habit.color + '"></span>' +
      "<h3>" + esc(habit.name) + "</h3>" +
      '<p class="muted">' + typeLabel(habit.type) + " · " + esc(habit.group || "未分組") +
      (habitTimeLabel(habit) ? " · " + esc(habitTimeLabel(habit)) : "") + "</p>" +
      goalMetaChipsHtml(habit) +
      '<p class="sheet-pull-hint">向下拉亦可返回主頁</p></div>' +
      '<div class="habit-detail-stats">' +
      '<div class="detail-stat"><div class="label">連續天數</div><div class="value">' + streakFor(habit) + "</div></div>" +
      '<div class="detail-stat"><div class="label">本月完成率</div><div class="value">' + monthRate(habit) + "%</div></div>" +
      '<div class="detail-stat"><div class="label">本月完成</div><div class="value">' + monthDoneDays(habit) + " 日</div></div>" +
      '<div class="detail-stat"><div class="label">本月額外</div><div class="value">' + monthExtraDays(habit) + " 日</div></div>" +
      '<div class="detail-stat"><div class="label">' + stat.label + '</div><div class="value">' + stat.value + "</div></div>" +
      "</div>" +
      '<div class="habit-detail-quick-actions" role="group" aria-label="習慣操作">' +
      '<button type="button" class="btn sm" data-edit-habit="' + habit.id + '">編輯</button>' +
      '<button type="button" class="btn sm ghost" data-archive-habit="' + habit.id + '">封存</button>' +
      '<button type="button" class="btn sm ghost" id="hdCloseTop">關閉</button></div>' +
      '<div class="habit-cal-nav">' +
      '<button type="button" class="btn sm ghost" data-hdetail-cal="prev" aria-label="上個月">‹</button>' +
      '<span class="muted cal-month-label">' + ym.getFullYear() + " 年 " + (ym.getMonth() + 1) + " 月</span>" +
      '<button type="button" class="btn sm ghost" data-hdetail-cal="next" aria-label="下個月">›</button></div>' +
      habitCalGridHtml(habit, ym, "habit-full") +
      habitYearHeatHtml(habit);
    var linkedGoals = state.goals.filter(function (g) { return g.habitId === habit.id; });
    if (linkedGoals.length) {
      html += '<div class="linked-goals-head"><span class="section-title">連結目標</span>' +
        '<button type="button" class="btn sm" data-nav-jump="settings-goals">管理目標</button></div>' +
        '<div class="habit-linked-goals">';
      linkedGoals.forEach(function (g) {
        var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
        var unit = goalUnitLabel(g);
        html += '<button type="button" class="habit-linked-goal" style="--hcolor:' +
          escAttr(goalAccentColor(g, habit)) + '" data-edit-goal="' + g.id + '">' +
          '<strong><span class="goal-habit-dot" aria-hidden="true"></span> ' + esc(g.title) + "</strong>" +
          ' <span class="goal-type-badge type-' + escAttr(g.goalType || "general") + '">' +
          goalTypeLabel(g.goalType) + (isGoalFinished(g) ? " · 成就" : "") + "</span>" +
          '<span class="muted tiny">' + g.current + " / " + g.target +
          (unit ? " " + esc(unit) : "") + " · " + pct + "%</span>" +
          goalMetaChipsHtml(g) +
          (g.outcome ? '<span class="tiny">' + esc(g.outcome) + "</span>" : "") +
          '<div class="progress-bar-slim"><i style="width:' + pct + '%"></i></div>' +
          "</button>";
      });
      html += "</div>";
    }
    html += '<div class="row-actions habit-detail-footer">' +
      '<button class="btn" data-edit-habit="' + habit.id + '">編輯</button>' +
      '<button class="btn ghost" data-archive-habit="' + habit.id + '">封存</button>' +
      '<button class="btn warn" data-delete-habit="' + habit.id + '">永久刪除</button>' +
      '<button class="btn ghost" id="hdClose">關閉</button></div></div>';
    openModal(html);
    document.getElementById("hdBack").onclick = closeModal;
    document.getElementById("hdClose").onclick = closeModal;
    var hdCloseTop = document.getElementById("hdCloseTop");
    if (hdCloseTop) hdCloseTop.onclick = closeModal;
  }

  // Permanently remove habit and related check-ins / links.
  function deleteHabitById(habitId) {
    if (!habitId) return;
    if (!window.confirm("確定永久刪除此習慣？相關打卡紀錄亦會刪除。")) return;
    markTombstone(habitId);
    state.checkins.forEach(function (c) {
      if (c.habitId === habitId) {
        if (c.id) markTombstone(c.id);
        if (c.date) markTombstone(habitId + "|" + c.date);
      }
    });
    state.habits = state.habits.filter(function (h) { return h.id !== habitId; });
    state.checkins = state.checkins.filter(function (c) { return c.habitId !== habitId; });
    state.goals.forEach(function (g) {
      if (g.habitId === habitId) {
        g.habitId = "";
        touch(g);
      }
    });
    state.blocks.forEach(function (b) {
      if (b.habitId === habitId) {
        b.habitId = "";
        touch(b);
      }
    });
    if (ui.focus.habitId === habitId) ui.focus.habitId = "";
    saveState();
    closeModal();
    toast("已刪除習慣");
    render();
  }

  function restoreHabitById(habitId) {
    var h = state.habits.find(function (x) { return x.id === habitId; });
    if (!h) return;
    h.archived = false;
    touch(h);
    saveState();
    toast("已還原習慣");
    render();
  }

  function archivedHabitsHtml() {
    var archived = state.habits.filter(function (h) { return h.archived; });
    var html = '<div class="archived-habits">';
    if (!archived.length) {
      html += '<div class="settings-row"><span class="settings-row-label muted">尚無封存習慣。在習慣詳情或編輯頁可按「封存」。</span></div>';
    } else {
      archived.forEach(function (h) {
        html += '<div class="archived-habit-row">' +
          '<div><strong>' + habitEmoji(h) + esc(h.name) + "</strong>" +
          (habitTimeLabel(h) ? '<div class="muted tiny">' + esc(habitTimeLabel(h)) + "</div>" : "") +
          "</div>" +
          '<div class="row-actions">' +
          '<button type="button" class="btn sm soft" data-restore-habit="' + h.id + '">還原</button>' +
          '<button type="button" class="btn sm warn" data-delete-habit="' + h.id + '">永久刪除</button>' +
          "</div></div>";
      });
    }
    html += "</div>";
    return html;
  }

  function refreshHabitDetail() {
    if (!ui.habitDetailId) return;
    var h = state.habits.find(function (x) { return x.id === ui.habitDetailId; });
    if (h && !h.archived) openHabitDetail(h, ui.habitDetailMonth);
    else closeModal();
  }

  function emptyHabitsHtml() {
    return '<div class="empty">' +
      '<div class="empty-illus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>' +
      "<p><strong>開始你的每日節奏</strong></p>" +
      '<ol class="empty-steps">' +
      "<li>新增一個習慣（例如晨跑）</li>" +
      "<li>每天在這裡打卡</li>" +
      "<li>可為習慣連結目標追蹤進度</li></ol>" +
      '<button class="btn" data-action="add-habit">+ 新增習慣</button>' +
      '<button class="btn soft" data-action="quick-add" style="margin-top:8px">快速新增其他</button></div>';
  }

  function activeGoalsStripHtml() {
    var open = state.goals.filter(isGoalOpen).slice(0, 3);
    if (!open.length) return "";
    var html = '<div class="goals-strip">';
    html += '<div class="goals-strip-head"><span class="section-title">進行中目標</span>' +
      '<button type="button" class="btn sm" data-nav-jump="settings-goals" aria-label="前往管理目標">管理目標</button></div>';
    open.forEach(function (g) {
      var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
      var habit = g.habitId ? state.habits.find(function (h) { return h.id === g.habitId; }) : null;
      var unit = goalUnitLabel(g);
      var gcolor = goalAccentColor(g, habit);
      html += '<button type="button" class="goals-strip-item' + (gcolor ? " has-habit" : "") + '"' +
        (gcolor ? ' style="--hcolor:' + escAttr(gcolor) + '"' : "") +
        ' data-edit-goal="' + g.id + '">' +
        '<div class="goals-strip-top"><strong>' + esc(g.title) + "</strong>" +
        '<span class="goal-strip-pct">' + pct + "%</span></div>" +
        '<div class="tiny">' + goalTypeLabel(g.goalType) +
        (habit ? ' · <span class="goal-habit-chip" style="--hcolor:' + escAttr(habit.color) + '">' +
          '<span class="goal-habit-dot" aria-hidden="true"></span>' + esc(habit.name) + "</span>" : "") +
        " · " + g.current + "/" + g.target + (unit ? " " + unit : "") + "</div>" +
        goalMetaChipsHtml(g) +
        '<div class="goal-progress-wrap">' +
        '<div class="progress-bar-slim"><i style="width:' + pct + '%"></i></div>' +
        '<div class="goal-pct-ring" style="--p:' + pct + '%" aria-label="完成 ' + pct + '%"><span>' + pct +
        "%</span></div></div></button>";
    });
    html += "</div>";
    return html;
  }

  // One-line jump only — full goal cards stay on 儀表板 / 設定.
  function goalsTodayTeaserHtml() {
    var n = state.goals.filter(isGoalOpen).length;
    if (!n) return "";
    return '<button type="button" class="goals-teaser" data-habits-panel="board" aria-label="在儀表板查看進行中目標">' +
      '<span class="goals-teaser-label">進行中目標</span>' +
      '<span class="goals-teaser-count">' + n + "</span>" +
      '<span class="goals-teaser-cta">儀表板 →</span></button>';
  }

  function weekSummaryHtml() {
    var start = new Date();
    start.setDate(start.getDate() - start.getDay());
    var due = 0;
    var done = 0;
    var evtCount = 0;
    var dots = "";
    var d = new Date(start);
    var today = todayKey();
    for (var i = 0; i < 7; i++) {
      var key = dateKey(d);
      var dayDue = 0;
      var dayDone = 0;
      state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); }).forEach(function (h) {
        dayDue++;
        due++;
        if (isHabitDone(h, key)) {
          dayDone++;
          done++;
        }
      });
      evtCount += eventsForDate(key).length;
      var frac = dayDue ? dayDone / dayDue : 0;
      var isToday = key === today;
      var cls = "week-dot-cell";
      if (isToday) cls += " today";
      if (frac >= 1 && dayDue) cls += " full";
      else if (frac > 0) cls += " partial";
      dots += '<div class="week-dot-col">' +
        '<div class="' + cls + '" style="--heat:' + Math.max(0.12, frac) + '">' + d.getDate() + "</div>" +
        '<span class="week-dot-label">' + DOW[d.getDay()] + "</span></div>";
      d.setDate(d.getDate() + 1);
    }
    var rate = due ? Math.round((done / due) * 100) : 0;
    return '<div class="week-summary week-summary-card">' +
      '<div class="week-summary-head">' +
      '<span class="week-summary-title">本週</span>' +
      '<span class="week-summary-meta">最佳連續 ' + bestStreak() + " 天 🔥</span></div>" +
      '<div class="week-dots">' + dots + "</div>" +
      '<div class="week-summary-foot muted tiny">達成 ' + rate + "% · 打卡 " + done + "/" + due +
      " · 行程 " + evtCount + "</div></div>";
  }

  function renderHabits() {
    var key = todayKey();
    var todayHabits = state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); });
    var active = state.habits.filter(function (h) { return !h.archived; });
    var panel = ui.habitsPanel === "board" ? "board" : "today";
    var html = weekSummaryHtml();
    html += todayStripHtml(todayHabits);
    html += '<div class="seg habits-seg">' +
      '<button type="button" data-habits-panel="today" class="' + (panel === "today" ? "on" : "") +
      '">今天</button>' +
      '<button type="button" data-habits-panel="board" class="' + (panel === "board" ? "on" : "") +
      '">儀表板</button></div>';
    if (!active.length) {
      html += dayJournalGateHtml(key);
      html += emptyHabitsHtml();
    } else if (panel === "board") {
      html += habitBoardHtml(active);
      html += activeGoalsStripHtml();
    } else {
      // Soft habit cards first (DC Organic primary); goals live on 儀表板 to avoid crowding.
      html += todayCheckinHtml(todayHabits);
      html += goalsTodayTeaserHtml();
      html += dayJournalGateHtml(key);
      html += todayUnifiedTimelineHtml();
    }
    document.getElementById("view-habits").innerHTML = html;
  }

  function renderDiary() {
    var key = ui.diaryDate || todayKey();
    var banner = holidayBannerText(key);
    var html = '<div class="diary-page">';
    if (key === todayKey()) {
      html += '<p class="tiny muted diary-page-hint">日記專頁。放假請在習慣列的「放假」按鈕設定。</p>';
    } else {
      html += '<p class="tiny muted diary-page-hint">正在編輯 ' + esc(diaryDateChipLabel(key)) +
        "。放假可在下方設定。</p>";
    }
    if (banner) html += '<div class="holiday-banner">' + esc(banner) + "</div>";
    html += dayJournalHtml(key, "diary");
    if (key !== todayKey()) html += diaryHolidayListHtml(key);
    html += "</div>";
    document.getElementById("view-diary").innerHTML = html;
  }

  function typeIcon(t) {
    if (t === "count") return "#";
    if (t === "duration") return "⏱";
    return "✓";
  }

  function totalCount(habit) {
    return state.checkins.reduce(function (sum, c) {
      if (c.habitId !== habit.id) return sum;
      return sum + Number(c.value || 0);
    }, 0);
  }

  function monthRate(habit) {
    var now = new Date();
    var days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var due = 0, done = 0;
    for (var d = 1; d <= days; d++) {
      var key = dateKey(new Date(now.getFullYear(), now.getMonth(), d));
      if (key > todayKey()) break;
      if (!habitDueOn(habit, key)) continue;
      due++;
      if (isHabitDone(habit, key)) done++;
    }
    return due ? Math.round((done / due) * 100) : 0;
  }

  function totalMinutes(habit) {
    return state.checkins.reduce(function (sum, c) {
      if (c.habitId !== habit.id) return sum;
      return sum + Number(c.minutes || (habit.type === "duration" ? c.value : 0) || 0);
    }, 0);
  }

  function monthTotalMinutes() {
    var now = new Date();
    var prefix = now.getFullYear() + "-" + pad(now.getMonth() + 1);
    var total = 0;
    for (var d = 1; d <= 31; d++) {
      var key = prefix + "-" + pad(d);
      if (key.length === 10) total += minutesOnDate(key);
    }
    return total;
  }

  function bestStreak() {
    var best = 0;
    state.habits.forEach(function (h) {
      if (h.archived) return;
      best = Math.max(best, streakFor(h));
    });
    return best;
  }

  function defaultTimeForGroup(group) {
    var map = { "早上": "07:30", "下午": "14:00", "晚上": "21:00", "健康": "08:00", "工作": "10:00", "生活": "19:00" };
    return map[group] || "09:00";
  }

  function openHabitEditor(habit) {
    ui.habitDetailId = "";
    var h = habit || {
      id: "", name: "", color: colors()[0], type: "yesno",
      frequency: [0, 1, 2, 3, 4, 5, 6], group: "早上", target: 1,
      timeOfDay: defaultTimeForGroup("早上"),
      timeEnd: "",
      emoji: "", note: ""
    };
    var freq = h.frequency || [];
    var palette = colors();
    openModal(
      "<h3>" + (h.id ? "編輯習慣" : "新增習慣") + "</h3>" +
      '<div class="field"><label>名稱</label><input id="hName" value="' + escAttr(h.name) + '" placeholder="例如：健身" /></div>' +
      '<div class="grid-2"><div class="field"><label>圖示 Emoji</label><input id="hEmoji" value="' + escAttr(h.emoji || "") + '" maxlength="4" placeholder="🏃" /></div>' +
      '<div class="field"><label>類型</label><select id="hType">' +
      opt("yesno", "是 / 否", h.type) + opt("count", "數量", h.type) + opt("duration", "計時（分鐘）", h.type) +
      "</select></div></div>" +
      '<div class="field"><label>目標（數量或分鐘）</label><input id="hTarget" type="number" min="1" value="' + (h.target || 1) + '" /></div>' +
      '<div class="field"><label>分組</label><select id="hGroup">' +
      GROUPS.map(function (g) { return opt(g, g, h.group); }).join("") + "</select></div>" +
      '<div class="grid-2"><div class="field"><label>開始時間</label><input id="hTime" type="time" value="' +
      escAttr(h.timeOfDay || defaultTimeForGroup(h.group || "早上")) + '" /></div>' +
      '<div class="field"><label>結束時間（可選）</label><input id="hTimeEnd" type="time" value="' +
      escAttr(h.timeEnd || "") + '" /></div></div>' +
      '<p class="muted tiny" style="margin:-4px 0 10px">例如健身可設 06:30–08:30；只填開始亦可。</p>' +
      '<div class="field"><label>備註（可選）</label><input id="hNote" value="' + escAttr(h.note || "") + '" placeholder="補充說明" /></div>' +
      '<div class="field"><label>顏色</label><div class="swatches" id="hColors">' +
      palette.map(function (c) {
        return '<button type="button" class="swatch' + (c === h.color ? " active" : "") +
          '" data-color="' + c + '" style="background:' + c + '"></button>';
      }).join("") + '</div><input type="hidden" id="hColor" value="' + escAttr(h.color) + '" /></div>' +
      '<div class="field"><label>重複星期</label><div class="freq-picks" id="hFreq">' +
      DOW.map(function (label, i) {
        return '<button type="button" data-dow="' + i + '" class="' + (freq.indexOf(i) >= 0 ? "on" : "") + '">' + label + "</button>";
      }).join("") + "</div></div>" +
      '<div class="row-actions">' +
      '<button class="btn" id="hSave">儲存</button>' +
      (h.id ? '<button class="btn ghost" id="hArchive">封存</button>' : "") +
      (h.id ? '<button class="btn warn" id="hDelete">永久刪除</button>' : "") +
      '<button class="btn ghost" id="hCancel">取消</button></div>'
    );

    var selectedColor = h.color;
    document.getElementById("hColors").onclick = function (e) {
      var b = e.target.closest("[data-color]");
      if (!b) return;
      selectedColor = b.getAttribute("data-color");
      document.getElementById("hColor").value = selectedColor;
      Array.prototype.forEach.call(document.querySelectorAll("#hColors .swatch"), function (el) {
        el.classList.toggle("active", el.getAttribute("data-color") === selectedColor);
      });
    };
    document.getElementById("hFreq").onclick = function (e) {
      var b = e.target.closest("[data-dow]");
      if (!b) return;
      b.classList.toggle("on");
    };
    document.getElementById("hGroup").onchange = function () {
      var timeEl = document.getElementById("hTime");
      if (!h.id || !timeEl.value) timeEl.value = defaultTimeForGroup(this.value);
    };
    document.getElementById("hCancel").onclick = closeModal;
    document.getElementById("hSave").onclick = function () {
      var name = document.getElementById("hName").value.trim();
      if (!name) return toast("請輸入名稱");
      var frequency = [];
      Array.prototype.forEach.call(document.querySelectorAll("#hFreq button.on"), function (b) {
        frequency.push(Number(b.getAttribute("data-dow")));
      });
      if (!frequency.length) return toast("至少選一日");
      var groupVal = document.getElementById("hGroup").value;
      var timeVal = document.getElementById("hTime").value || defaultTimeForGroup(groupVal);
      var timeEndVal = document.getElementById("hTimeEnd").value || "";
      if (timeEndVal && timeToMinutes(timeEndVal) < timeToMinutes(timeVal)) {
        return toast("結束時間不可早於開始時間");
      }
      var payload = {
        name: name,
        type: document.getElementById("hType").value,
        target: Number(document.getElementById("hTarget").value) || 1,
        group: groupVal,
        timeOfDay: timeVal,
        timeEnd: timeEndVal,
        note: document.getElementById("hNote").value.trim(),
        emoji: document.getElementById("hEmoji").value.trim(),
        color: document.getElementById("hColor").value || colors()[0],
        frequency: frequency,
        archived: false
      };
      if (h.id) {
        Object.assign(h, payload);
        touch(h);
      } else {
        state.habits.push(touch(Object.assign({ id: uid(), createdAt: Date.now() }, payload)));
      }
      saveState();
      closeModal();
      toast("習慣已儲存");
      render();
    };
    if (h.id) {
      document.getElementById("hArchive").onclick = function () {
        h.archived = true;
        touch(h);
        saveState();
        closeModal();
        toast("已封存");
        render();
      };
      document.getElementById("hDelete").onclick = function () {
        deleteHabitById(h.id);
      };
    }
  }

  function openHabitLogModal(habit, dateStr) {
    var key = dateStr || todayKey();
    var c = getCheckin(habit.id, key);
    openModal(
      "<h3>記錄：" + esc(habit.name) + "</h3>" +
      (habit.type === "count"
        ? '<div class="field"><label>數量</label><input id="logVal" type="number" min="0" value="' + (c ? c.value : 0) + '" /></div>'
        : '<div class="field"><label>分鐘</label><input id="logVal" type="number" min="0" value="' + (c ? (c.minutes || c.value || 0) : 0) + '" /></div>') +
      '<div class="field"><label>備註</label><input id="logNote" value="' + escAttr(c && c.note || "") + '" /></div>' +
      '<div class="row-actions"><button class="btn" id="logSave">儲存</button>' +
      '<button class="btn ghost" id="logCancel">取消</button></div>'
    );
    document.getElementById("logCancel").onclick = closeModal;
    document.getElementById("logSave").onclick = function () {
      var val = Number(document.getElementById("logVal").value) || 0;
      var note = document.getElementById("logNote").value.trim();
      var wasDone = isHabitDone(habit, key);
      if (!c) {
        c = touch({
          id: uid(), habitId: habit.id, date: key, value: val,
          minutes: habit.type === "duration" ? val : 0, note: note,
          extra: isExtraDay(habit, key)
        });
        state.checkins.push(c);
      } else {
        c.value = val;
        c.minutes = habit.type === "duration" ? val : (c.minutes || 0);
        c.note = note;
        if (isExtraDay(habit, key)) c.extra = true;
        touch(c);
      }
      saveState();
      closeModal();
      var nowDone = isHabitDone(habit, key);
      // Duration always re-syncs hours goals; count/yesno only on newly completed.
      if (habit.type === "duration") {
        afterHabitCompleted(habit, key);
      } else if (!wasDone && nowDone) {
        afterHabitCompleted(habit, key);
      } else {
        toast("已記錄");
      }
      if (ui.habitDetailId) refreshHabitDetail();
      render();
    };
  }

  function calDayHabitsHtml(selected) {
    var active = state.habits.filter(function (h) { return !h.archived; });
    var due = active.filter(function (h) { return habitDueOn(h, selected); });
    // Only past/today: future days must not list every off-schedule habit as 額外.
    // Full-day holiday: no extra check-ins (same pause as scheduled habits).
    var extra = (selected <= todayKey() && !isFullDayHoliday(selected))
      ? active.filter(function (h) { return isExtraDay(h, selected); })
      : [];
    if (!due.length && !extra.length) {
      return '<div class="empty compact">當日沒有需要完成的習慣</div>';
    }
    var html = "";
    if (due.length) {
      html += '<div class="cal-habit-list">';
      due.forEach(function (h) {
        var done = isHabitDone(h, selected);
        html += '<div class="cal-habit-row' + (done ? " done" : "") + '">' +
          checkBtnHtml(h, selected, "check check-md") +
          '<div class="cal-habit-info"><strong>' + esc(h.name) + '</strong>' +
          '<span class="muted">' + todayStatusText(h, selected) + "</span></div></div>";
      });
      html += "</div>";
    } else {
      html += '<div class="empty compact">當日沒有排程習慣</div>';
    }
    if (extra.length) {
      html += '<div class="extra-habits cal-extra-habits">' +
        '<div class="habit-group-label extra-habits-label"><span>額外完成</span></div>' +
        '<div class="cal-habit-list">';
      extra.forEach(function (h) {
        var done = isHabitDone(h, selected);
        html += '<div class="cal-habit-row is-extra' + (done ? " done" : "") + '">' +
          checkBtnHtml(h, selected, "check check-md") +
          '<div class="cal-habit-info"><strong>' + esc(h.name) +
          ' <span class="extra-tag">額外</span></strong>' +
          '<span class="muted">' + todayStatusText(h, selected) + "</span></div></div>";
      });
      html += "</div></div>";
    }
    return html;
  }

  function timeToMinutes(t) {
    if (!t) return 0;
    var p = String(t).split(":");
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }

  function timelineFlowHtml(selected) {
    var dayBlocks = blocksForDate(selected);
    var dayEvents = eventsForDate(selected);
    var dayHabits = state.habits.filter(function (h) {
      return !h.archived && habitDueOn(h, selected) && h.timeOfDay;
    }).map(function (h) {
      return {
        id: "habit-" + h.id,
        title: h.name,
        start: h.timeOfDay,
        end: h.timeEnd || "",
        color: h.color,
        kind: "habit",
        done: isHabitDone(h, selected),
        allDay: false
      };
    });
    var flow = dayBlocks.map(function (b) {
      return { id: b.id, title: b.title, start: b.start, end: b.end, color: b.color, kind: "block", allDay: false };
    }).concat(dayEvents.map(function (ev) {
      return {
        id: ev.id,
        title: ev.title,
        start: ev.allDay ? "00:00" : (ev.start || "09:00"),
        end: ev.allDay ? "" : (ev.end || ""),
        color: ev.color,
        kind: "event",
        allDay: !!ev.allDay,
        repeatLabel: eventRepeatLabel(ev.repeat)
      };
    })).concat(dayHabits).sort(function (a, b) {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return String(a.start).localeCompare(String(b.start));
    });
    if (!flow.length) {
      return '<div class="empty compact" style="padding:20px">當日沒有行程</div>';
    }
    var startHour = 6;
    var endHour = 23;
    var pxPerMin = 1.2;
    var totalH = (endHour - startHour) * 60 * pxPerMin;
    var html = '<div class="timeline-flow" style="height:' + Math.max(200, totalH + 24) + 'px">';
    html += '<div class="timeline-gutter">';
    for (var h = startHour; h <= endHour; h++) {
      var top = (h - startHour) * 60 * pxPerMin;
      html += '<div class="timeline-hour" style="top:' + top + 'px">' + pad(h) + ":00</div>";
    }
    html += "</div>";
    flow.forEach(function (item) {
      var mins = timeToMinutes(item.start);
      var top = Math.max(0, (mins - startHour * 60) * pxPerMin);
      var dur = item.allDay ? 30 : (item.end ? Math.max(30, timeToMinutes(item.end) - mins) : 45);
      // Keep enough height for padded title text (Organic: text must not kiss edges).
      var height = Math.max(48, dur * pxPerMin);
      var shortCls = height < 64 ? " is-short" : "";
      var kindLabel = item.kind === "habit"
        ? (item.done ? "習慣 · 已完成" : "習慣 · 未完成")
        : (item.kind === "event"
          ? ("行程 · " + (item.allDay ? "全天" : esc(item.start) + (item.end ? "–" + esc(item.end) : "")) +
            (item.repeatLabel ? " · " + item.repeatLabel : ""))
          : (esc(item.start) + (item.end ? "–" + esc(item.end) : "")));
      html += '<div class="timeline-block' + shortCls + '" style="top:' + top + "px;height:" + height +
        "px;background:" + item.color + '"><span class="timeline-block-title">' + esc(item.title) +
        '</span><div class="tiny">' + kindLabel +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function calWeekViewHtml() {
    var month = ui.calMonth;
    var y = month.getFullYear();
    var m = month.getMonth();
    var start = new Date(y, m, 1);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
    var html = '<div class="cal-week-grid">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var key = dateKey(d);
      var cls = "cal-week-col";
      if (key === todayKey()) cls += " today";
      if (key === ui.calSelected) cls += " selected";
      html += '<button type="button" class="' + cls + '" data-day="' + key + '">';
      html += '<div class="cal-week-col-head">' + DOW[d.getDay()] + "<br>" + d.getDate() + "</div>";
      var slots = 4;
      eventsForDate(key).slice(0, 2).forEach(function (ev) {
        if (slots <= 0) return;
        slots--;
        var rep = eventRepeatLabel(ev.repeat);
        html += '<div class="cal-week-item" style="background:' + (ev.color || colors()[0]) + '">' +
          esc(ev.title) + (rep ? " ·" : "") + "</div>";
      });
      blocksForDate(key).slice(0, 2).forEach(function (b) {
        if (slots <= 0) return;
        slots--;
        html += '<div class="cal-week-item" style="background:' + b.color + '">' + esc(b.title) + "</div>";
      });
      if (state.settings.calShowHabits !== false) {
        var due = state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); });
        due.slice(0, slots).forEach(function (h) {
          var done = isHabitDone(h, key);
          html += '<div class="cal-week-item" style="background:' + h.color + ";opacity:" + (done ? "1" : "0.55") + '">' +
            esc(h.name) + "</div>";
        });
      }
      html += "</button>";
    }
    html += "</div>";
    return html;
  }

  function renderCalendar() {
    var month = ui.calMonth;
    var selected = ui.calSelected;
    var y = month.getFullYear();
    var m = month.getMonth();
    var html = "";
    if (ui.calMode !== "timetable") {
      html += '<div class="cal-toolbar">' +
        '<button class="btn sm ghost icon-only" data-cal="prev" aria-label="上個月">‹</button>' +
        '<h2>' + y + " 年 " + (m + 1) + " 月</h2>" +
        '<button class="btn sm ghost icon-only" data-cal="next" aria-label="下個月">›</button></div>';
    }

    html += '<div class="seg seg-3"><button type="button" data-cal-mode="month" class="' +
      (ui.calMode === "month" ? "on" : "") + '">月</button><button type="button" data-cal-mode="week" class="' +
      (ui.calMode === "week" ? "on" : "") + '">週</button><button type="button" data-cal-mode="timetable" class="' +
      (ui.calMode === "timetable" ? "on" : "") + '">時間表</button></div>';
    if (ui.calMode !== "timetable") {
      html += '<p class="tiny muted cal-page-hint">日曆專頁：查看達成、行程與習慣。日記請按當日「日記」。</p>';
    }

    if (ui.calMode === "timetable") {
      html += renderTimetablePanel();
      document.getElementById("view-calendar").innerHTML = html;
      return;
    }

    html += '<div class="cal-view-opts">' +
      '<label class="cal-opt"><input type="checkbox" data-cal-opt="habits"' +
      (state.settings.calShowHabits !== false ? " checked" : "") + " /> 顯示習慣</label>" +
      '<label class="cal-opt"><input type="checkbox" data-cal-opt="countdowns"' +
      (state.settings.calShowCountdowns !== false ? " checked" : "") + " /> 顯示倒數</label></div>";

    if (ui.calMode === "week") {
      html += calWeekViewHtml();
    } else {
      var firstDow = new Date(y, m, 1).getDay();
      var daysInMonth = new Date(y, m + 1, 0).getDate();
      html += '<div class="cal-grid-wrap"><div class="cal-grid">';
      DOW.forEach(function (d) { html += '<div class="cal-dow">' + d + "</div>"; });
      for (var i = 0; i < firstDow; i++) html += '<div></div>';
      for (var day = 1; day <= daysInMonth; day++) {
        var key = dateKey(new Date(y, m, day));
        var rate = completionRate(key);
        var fullDayHoliday = isFullDayHoliday(key);
        var partialHoliday = isHoliday(key) && !fullDayHoliday;
        var cls = "cal-day";
        if (key === todayKey()) cls += " today";
        if (key === selected) cls += " selected";
        if (fullDayHoliday) cls += " holiday";
        else if (partialHoliday) cls += " partial-holiday";
        if (!fullDayHoliday && rate > 0) cls += " has-heat";
        var heatStyle = !fullDayHoliday && rate > 0 ? ' style="--heat:' + Math.max(0.12, rate / 100) + '"' : "";
        var dayEvts = eventsForDate(key);
        var dotsHtml = "";
        if (dayEvts.length) {
          dotsHtml = '<span class="cal-day-dots">';
          dayEvts.slice(0, 3).forEach(function (ev) {
            dotsHtml += '<span class="cal-day-dot" style="background:' + (ev.color || colors()[0]) + '"></span>';
          });
          dotsHtml += "</span>";
        }
        var pctHtml = "";
        if (fullDayHoliday) {
          pctHtml = '<span class="cal-day-pct">假</span>';
        } else if (rate > 0) {
          pctHtml = '<span class="cal-day-pct">' + rate + "%</span>";
          if (partialHoliday) pctHtml += '<span class="cal-day-hol-mark" aria-label="部分放假">假</span>';
        } else if (partialHoliday) {
          pctHtml = '<span class="cal-day-hol-mark" aria-label="部分放假">假</span>';
        }
        html += '<button type="button" class="' + cls + '" data-day="' + key + '"' + heatStyle + ">" +
          '<span class="cal-day-num">' + day + "</span>" +
          pctHtml +
          dotsHtml +
          "</button>";
      }
      html += "</div></div>";
    }

    var selRate = completionRate(selected);
    var selMins = minutesOnDate(selected);
    var selLabel = selected === todayKey() ? "今天" : selected.slice(5).replace("-", "月") + "日";
    var holidayToday = isHoliday(selected);
    var fullHolidayToday = isFullDayHoliday(selected);
    var rateIsRest = fullHolidayToday || (holidayToday && selRate === null);
    var holidayTag = fullHolidayToday ? "全日放假" : (selRate === null ? "放假" : "部分放假");
    html += '<div class="day-panel">';
    html += '<div class="day-panel-head"><strong>' + selLabel + '</strong>' +
      '<span class="muted">星期' + DOW[parseKey(selected).getDay()] + '</span>' +
      (holidayToday ? '<span class="tag tag-accent-2">' + holidayTag + "</span>" : "") +
      '<button type="button" class="btn sm soft" data-open-diary="' + escAttr(selected) +
      '">日記</button>' +
      '<button type="button" class="btn sm soft" data-action="add-event">+ 行程</button></div>';
    html += '<div class="day-panel-stats">' +
      '<div class="stat-cell"><div class="label">達成率</div><div class="value">' +
      (rateIsRest ? "放假" : (selRate === null ? "—" : (selRate + "%"))) + '</div></div>' +
      '<div class="stat-cell"><div class="label">投入時數</div><div class="value">' + fmtMin(selMins) + "</div></div>" +
      "</div>";
    var selEvents = eventsForDate(selected);
    if (selEvents.length) {
      html += '<div class="section-title" style="padding-top:4px">當日行程</div><div class="cal-event-list">';
      selEvents.forEach(function (ev) {
        var timeLabel = ev.allDay ? "全天" : ((ev.start || "") + (ev.end ? "–" + ev.end : ""));
        var rep = eventRepeatLabel(ev.repeat);
        html += '<div class="cal-event-row">' +
          '<span class="cal-event-dot" style="background:' + (ev.color || colors()[0]) + '"></span>' +
          '<div class="cal-event-info"><strong>' + esc(ev.title) + '</strong>' +
          '<span class="muted tiny">' + esc(timeLabel) + (rep ? " · " + rep : "") + "</span></div>" +
          '<button type="button" class="btn sm ghost" data-edit-event="' + ev.id + '">編輯</button></div>';
      });
      html += "</div>";
    }
    html += timelineFlowHtml(selected);
    if (state.settings.calShowCountdowns !== false) {
      var cds = state.countdowns.filter(function (c) {
        return countdownDaysLeft(c) >= 0 && countdownDaysLeft(c) <= 30;
      });
      if (cds.length) {
        html += '<div class="section-title" style="padding-top:8px">近期倒數</div><div class="cal-countdown-list">';
        cds.slice(0, 4).forEach(function (c) {
          var days = countdownDaysLeft(c);
          html += '<div class="cal-countdown-item"><span>' + esc(c.emoji || "🎯") + "</span><strong>" +
            esc(c.title) + '</strong><span class="muted">還有 ' + days + " 天</span></div>";
        });
        html += "</div>";
      }
    }
    if (state.settings.calShowHabits !== false) {
      html += '<div class="section-title" style="padding-top:8px">當日習慣</div>';
      html += calDayHabitsHtml(selected);
    }
    html += "</div>";

    document.getElementById("view-calendar").innerHTML = html;
  }

  function blocksForDate(key) {
    var dow = parseKey(key).getDay();
    return state.blocks.filter(function (b) {
      if (b.date) return b.date === key;
      return Number(b.dayOfWeek) === dow;
    }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
  }

  function eventsForDate(key) {
    return state.events.filter(function (ev) { return eventOccursOn(ev, key); }).sort(function (a, b) {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
  }

  function openBlockEditor(block) {
    var b = block || {
      id: "", title: "", dayOfWeek: new Date().getDay(), date: "",
      start: "09:00", end: "10:00", color: colors()[1], habitId: ""
    };
    var habitOpts = '<option value="">—</option>' + state.habits.filter(function (h) { return !h.archived; }).map(function (h) {
      return opt(h.id, h.name, b.habitId || "");
    }).join("");
    openModal(
      "<h3>" + (b.id ? "編輯時段" : "新增時段") + "</h3>" +
      '<div class="field"><label>標題</label><input id="bTitle" value="' + escAttr(b.title) + '" /></div>' +
      '<div class="grid-2"><div class="field"><label>開始</label><input id="bStart" type="time" value="' + escAttr(b.start) + '" /></div>' +
      '<div class="field"><label>結束</label><input id="bEnd" type="time" value="' + escAttr(b.end) + '" /></div></div>' +
      '<div class="field"><label>重複（星期）</label><select id="bDow">' +
      DOW.map(function (label, i) { return opt(String(i), "逢星期" + label, b.date ? "once" : String(b.dayOfWeek)); }).join("") +
      '<option value="once"' + (b.date ? " selected" : "") + ">只限選定日期</option></select></div>" +
      '<div class="field"><label>顏色</label><select id="bColor">' +
      colors().map(function (c) { return opt(c, c, b.color); }).join("") + "</select></div>" +
      '<div class="field"><label>連結習慣（可選）</label><select id="bHabit">' + habitOpts + "</select></div>" +
      '<div class="row-actions"><button class="btn" id="bSave">儲存</button>' +
      (b.id ? '<button class="btn warn" id="bDel">刪除</button>' : "") +
      '<button class="btn ghost" id="bCancel">取消</button></div>'
    );
    document.getElementById("bCancel").onclick = closeModal;
    document.getElementById("bSave").onclick = function () {
      var title = document.getElementById("bTitle").value.trim();
      if (!title) return toast("請輸入標題");
      var dowVal = document.getElementById("bDow").value;
      var payload = {
        title: title,
        start: document.getElementById("bStart").value,
        end: document.getElementById("bEnd").value,
        color: document.getElementById("bColor").value,
        habitId: document.getElementById("bHabit").value || "",
        dayOfWeek: dowVal === "once" ? null : Number(dowVal),
        date: dowVal === "once" ? ui.calSelected : ""
      };
      if (b.id) {
        Object.assign(b, payload);
        touch(b);
      } else {
        state.blocks.push(touch(Object.assign({ id: uid() }, payload)));
      }
      saveState();
      closeModal();
      toast("時段已儲存");
      render();
    };
    if (b.id) {
      document.getElementById("bDel").onclick = function () {
        if (!window.confirm("確定刪除此時段？")) return;
        state.blocks = state.blocks.filter(function (x) { return x.id !== b.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function openEventEditor(event) {
    var ev = event || {
      id: "",
      title: "",
      date: ui.calSelected || todayKey(),
      start: "09:00",
      end: "10:00",
      allDay: false,
      note: "",
      color: colors()[2],
      repeat: "none",
      until: ""
    };
    var repeat = ev.repeat || "none";
    openModal(
      "<h3>" + (ev.id ? "編輯行程" : "新增行程") + "</h3>" +
      '<p class="muted tiny" style="margin:0 0 10px">行程可重複，與習慣分開管理。</p>' +
      '<div class="field"><label>標題</label><input id="eTitle" value="' + escAttr(ev.title) + '" placeholder="約會、會議…" /></div>' +
      '<div class="field"><label>日期</label><input id="eDate" type="date" value="' + escAttr(ev.date || ui.calSelected) + '" /></div>' +
      '<div class="field"><label class="inline-check"><input type="checkbox" id="eAllDay"' +
      (ev.allDay ? " checked" : "") + " /> 全天</label></div>" +
      '<div class="grid-2" id="eTimeFields">' +
      '<div class="field"><label>開始</label><input id="eStart" type="time" value="' + escAttr(ev.start || "09:00") + '"' +
      (ev.allDay ? " disabled" : "") + " /></div>" +
      '<div class="field"><label>結束</label><input id="eEnd" type="time" value="' + escAttr(ev.end || "10:00") + '"' +
      (ev.allDay ? " disabled" : "") + " /></div></div>" +
      '<div class="grid-2"><div class="field"><label>重複</label><select id="eRepeat">' +
      opt("none", "不重複", repeat) +
      opt("daily", "每日", repeat) +
      opt("weekly", "每週", repeat) +
      opt("monthly", "每月", repeat) +
      opt("yearly", "每年", repeat) +
      "</select></div>" +
      '<div class="field"><label>結束於（可選）</label><input id="eUntil" type="date" value="' +
      escAttr(ev.until || "") + '" /></div></div>' +
      '<div class="field"><label>備註</label><textarea id="eNote" rows="2">' + esc(ev.note || "") + "</textarea></div>" +
      '<div class="field"><label>顏色</label><select id="eColor">' +
      colors().map(function (c) { return opt(c, c, ev.color); }).join("") + "</select></div>" +
      '<div class="row-actions"><button class="btn" id="eSave">儲存</button>' +
      (ev.id ? '<button class="btn warn" id="eDel">刪除</button>' : "") +
      '<button class="btn ghost" id="eCancel">取消</button></div>'
    );
    var allDayEl = document.getElementById("eAllDay");
    var toggleTimes = function () {
      var on = allDayEl.checked;
      document.getElementById("eStart").disabled = on;
      document.getElementById("eEnd").disabled = on;
    };
    allDayEl.onchange = toggleTimes;
    document.getElementById("eCancel").onclick = closeModal;
    document.getElementById("eSave").onclick = function () {
      var title = document.getElementById("eTitle").value.trim();
      if (!title) return toast("請輸入標題");
      var dateVal = document.getElementById("eDate").value;
      if (!dateVal) return toast("請選擇日期");
      var allDay = allDayEl.checked;
      var untilVal = document.getElementById("eUntil").value;
      if (untilVal && untilVal < dateVal) return toast("結束日期不可早於開始日期");
      var payload = {
        title: title,
        date: dateVal,
        start: allDay ? "" : document.getElementById("eStart").value,
        end: allDay ? "" : document.getElementById("eEnd").value,
        allDay: allDay,
        note: document.getElementById("eNote").value.trim(),
        color: document.getElementById("eColor").value,
        repeat: document.getElementById("eRepeat").value || "none",
        until: untilVal || ""
      };
      if (ev.id) {
        Object.assign(ev, payload);
        touch(ev);
      } else {
        state.events.push(touch(Object.assign({ id: uid() }, payload)));
      }
      saveState();
      closeModal();
      toast("行程已儲存");
      if (ui.view === "calendar") ui.calSelected = dateVal;
      render();
    };
    if (ev.id) {
      document.getElementById("eDel").onclick = function () {
        if (!window.confirm("確定刪除此行程？")) return;
        state.events = state.events.filter(function (x) { return x.id !== ev.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderTimetable() {
    if (ui.view === "calendar") renderCalendar();
  }

  function renderCountdown() {
    document.getElementById("view-countdown").innerHTML = renderCountdownPanel();
  }

  function renderFocus() {
    document.getElementById("view-focus").innerHTML =
      '<div class="focus-view"><div class="focus-panel">' + renderFocusPanelInner() + "</div></div>";
  }

  function renderSettings() {
    var tabs = [
      ["goals", "目標"],
      ["archive", "封存"],
      ["theme", "主題"],
      ["notify", "提醒"],
      ["sync", "同步"]
    ];
    var html = '<div class="settings-wrap"><div class="seg settings-seg">';
    tabs.forEach(function (t) {
      html += '<button type="button" data-settings="' + t[0] + '" class="' +
        (ui.settingsTab === t[0] ? "on" : "") + '">' + t[1] + "</button>";
    });
    html += '</div><div id="settingsBody"></div></div>';
    document.getElementById("view-settings").innerHTML = html;
    renderSettingsBody();
  }

  function renderSettingsBody() {
    var el = document.getElementById("settingsBody");
    if (!el) return;
    var map = {
      sync: renderSyncPanel,
      goals: renderGoalsPanel,
      archive: renderArchivePanel,
      theme: renderThemePanel,
      notify: renderNotifyPanel
    };
    el.innerHTML = (map[ui.settingsTab] || renderGoalsPanel)();
  }

  function renderArchivePanel() {
    return '<div class="settings-group"><div class="settings-group-title">已封存習慣</div>' +
      archivedHabitsHtml() + "</div>";
  }

  function renderTimetablePanel() {
    var dow = ui.timetableDow;
    var html = '<div class="timetable-wrap">';
    html += '<div class="week-picks" id="ttDow">';
    DOW.forEach(function (label, i) {
      html += '<button type="button" data-tt-dow="' + i + '" class="' + (i === dow ? "on" : "") + '">' + label + "</button>";
    });
    html += "</div>";
    var blocks = state.blocks.filter(function (b) {
      if (b.date) return false;
      return Number(b.dayOfWeek) === dow;
    }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    html += '<div class="schedule-day">';
    if (!blocks.length) {
      html += '<div class="timetable-skeleton" aria-hidden="true">';
      ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"].forEach(function (h) {
        html += '<div class="tt-skel-row"><span class="tt-skel-hour">' + h + '</span><span class="tt-skel-block"></span></div>';
      });
      html += "</div>";
      html += '<div class="empty compact timetable-empty">' +
        '<p>這一天還沒有時間表區塊。</p>' +
        '<p class="muted tiny">可新增上課、通勤、固定會議等每週重複時段。</p>' +
        '<button class="btn sm" data-action="add-block">+ 新增時段</button></div>';
    } else {
      blocks.forEach(function (b) {
        html += '<div class="schedule-block"><div class="schedule-time">' + esc(b.start) +
          (b.end ? "<br>" + esc(b.end) : "") + '</div><div class="schedule-body" style="--bcolor:' + b.color +
          '"><strong>' + esc(b.title) + '</strong><div class="muted">逢星期' + DOW[b.dayOfWeek] + "</div>" +
          '<button class="btn sm ghost" style="margin-top:6px" data-edit-block="' + b.id + '">編輯</button></div></div>';
      });
    }
    html += "</div>";
    html += '<button type="button" class="fab" data-action="add-block" aria-label="新增時段">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
    html += "</div>";
    return html;
  }

  function countdownLabel(ts) {
    var diff = ts - Date.now();
    if (diff <= 0) return "已到達";
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return "還有 " + days + " 天 " + hours + " 小時";
    var mins = Math.floor((diff % 3600000) / 60000);
    return "還有 " + hours + " 小時 " + mins + " 分";
  }

  function countdownKindLabel(kind) {
    if (kind === "birthday") return "生日";
    if (kind === "anniversary") return "紀念日";
    return "倒數";
  }

  function renderCountdownPanel() {
    var unit = ui.countdownUnit || "days";
    var html = '<div class="countdown-unit-seg seg seg-inline">' +
      '<button type="button" data-countdown-unit="days" class="' + (unit === "days" ? "on" : "") + '">天</button>' +
      '<button type="button" data-countdown-unit="weeks" class="' + (unit === "weeks" ? "on" : "") + '">週</button>' +
      '<button type="button" data-countdown-unit="months" class="' + (unit === "months" ? "on" : "") + '">月</button>' +
      "</div>";
    html += '<div class="countdown-cards">';
    if (!state.countdowns.length) {
      html += '<div class="empty"><div class="empty-illus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 15"/></svg></div>' +
        "<p><strong>用倒數抓住重要日子</strong></p>" +
        '<ol class="empty-steps">' +
        "<li>新增考試、旅行或生日</li>" +
        "<li>用天／週／月檢視距離</li>" +
        "<li>到日前可收到提醒</li></ol>" +
        '<button class="btn" data-action="add-countdown">+ 新增倒數</button></div>';
    } else {
      state.countdowns.slice().sort(function (a, b) {
        return countdownNextAt(a) - countdownNextAt(b);
      }).forEach(function (c) {
        var days = countdownDaysLeft(c);
        var disp = countdownDisplayAmount(days, unit);
        var nextAt = countdownNextAt(c);
        var age = birthdayAge(c);
        html += '<div class="countdown-card" style="--cdcolor:' + (c.color || colors()[0]) + '">' +
          '<div class="countdown-hero">' + disp.value + '<span class="countdown-unit">' + disp.label + "</span></div>" +
          "<div><strong>" + esc(c.emoji || "🎯") + " " + esc(c.title) + "</strong>" +
          '<div class="muted">' + countdownKindLabel(c.kind || "countdown") +
          " · " + new Date(nextAt).toLocaleDateString("zh-HK", { year: "numeric", month: "long", day: "numeric" }) +
          (days <= 0 ? " · 已到達" : " · 還有 " + days + " 天") +
          (age != null ? " · " + age + " 歲" : "") +
          (c.repeat && c.repeat !== "none" ? " · " + ({ yearly: "每年", monthly: "每月", weekly: "每週" }[c.repeat] || "") : "") +
          "</div></div>" +
          '<button class="btn sm ghost" data-edit-countdown="' + c.id + '">編輯</button></div>';
      });
    }
    html += "</div>";
    return html;
  }

  function openCountdownEditor(item) {
    var c = item || {
      id: "", title: "", targetAt: Date.now() + 86400000 * 7,
      emoji: "🎯", color: colors()[0], kind: "countdown", repeat: "none", showAge: false, note: ""
    };
    var local = new Date(c.targetAt);
    var localVal = local.getFullYear() + "-" + pad(local.getMonth() + 1) + "-" + pad(local.getDate()) +
      "T" + pad(local.getHours()) + ":" + pad(local.getMinutes());
    var palette = colors();
    openModal(
      "<h3>" + (c.id ? "編輯倒數" : "新增倒數") + "</h3>" +
      '<div class="field"><label>標題</label><input id="cTitle" value="' + escAttr(c.title) + '" /></div>' +
      '<div class="grid-2"><div class="field"><label>類型</label><select id="cKind">' +
      opt("countdown", "倒數", c.kind || "countdown") +
      opt("birthday", "生日", c.kind || "countdown") +
      opt("anniversary", "紀念日", c.kind || "countdown") +
      "</select></div>" +
      '<div class="field"><label>重複</label><select id="cRepeat">' +
      opt("none", "不重複", c.repeat || "none") +
      opt("yearly", "每年", c.repeat || "none") +
      opt("monthly", "每月", c.repeat || "none") +
      opt("weekly", "每週", c.repeat || "none") +
      "</select></div></div>" +
      '<div class="field"><label>目標時間</label><input id="cAt" type="datetime-local" value="' + localVal + '" /></div>' +
      '<div class="grid-2"><div class="field"><label>Emoji</label><input id="cEmoji" value="' + escAttr(c.emoji || "🎯") + '" maxlength="4" /></div>' +
      '<div class="field"><label>顏色</label><select id="cColor">' +
      palette.map(function (col) { return opt(col, col, c.color || palette[0]); }).join("") +
      "</select></div></div>" +
      '<div class="field"><label><input type="checkbox" id="cShowAge"' + (c.showAge ? " checked" : "") + " /> 顯示年齡（生日）</label></div>" +
      '<div class="field"><label>備註（可選）</label><input id="cNote" value="' + escAttr(c.note || "") + '" /></div>' +
      '<div class="row-actions"><button class="btn" id="cSave">儲存</button>' +
      (c.id ? '<button class="btn warn" id="cDel">刪除</button>' : "") +
      '<button class="btn ghost" id="cCancel">取消</button></div>'
    );
    var kindEl = document.getElementById("cKind");
    var repeatEl = document.getElementById("cRepeat");
    kindEl.onchange = function () {
      if (kindEl.value === "birthday" && repeatEl.value === "none") repeatEl.value = "yearly";
    };
    document.getElementById("cCancel").onclick = closeModal;
    document.getElementById("cSave").onclick = function () {
      var title = document.getElementById("cTitle").value.trim();
      var at = new Date(document.getElementById("cAt").value).getTime();
      if (!title || !at) return toast("請填齊資料");
      var kind = document.getElementById("cKind").value;
      var repeat = document.getElementById("cRepeat").value;
      if (kind === "birthday" && repeat === "none") repeat = "yearly";
      var payload = {
        title: title,
        targetAt: at,
        emoji: document.getElementById("cEmoji").value || "🎯",
        color: document.getElementById("cColor").value || colors()[0],
        kind: kind,
        repeat: repeat,
        showAge: !!document.getElementById("cShowAge").checked,
        note: document.getElementById("cNote").value.trim()
      };
      if (c.id) {
        Object.assign(c, payload);
        touch(c);
      } else {
        state.countdowns.push(touch(Object.assign({ id: uid() }, payload)));
      }
      saveState();
      closeModal();
      toast("倒數已儲存");
      render();
    };
    if (c.id) {
      document.getElementById("cDel").onclick = function () {
        if (!window.confirm("確定刪除此倒數？")) return;
        state.countdowns = state.countdowns.filter(function (x) { return x.id !== c.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderFocusPanelInner() {
    var total = Math.max(1, ui.focus.totalMs);
    var remain = Math.max(0, ui.focus.remainMs);
    var elapsed = 1 - remain / total;
    var r = 110;
    var circ = 2 * Math.PI * r;
    var offset = circ * (1 - elapsed);
    var mm = Math.floor(remain / 60000);
    var ss = Math.floor((remain % 60000) / 1000);
    var modeLabel = ui.focus.mode === "focus" ? "專注 · 番茄鐘" : "休息 · 恢復中";
    var presets = [25, 15, 5];
    var curMin = Number(state.settings.focusMin || 25);
    var html = '<div class="seg focus-presets">';
    presets.forEach(function (m) {
      html += '<button type="button" data-focus-preset="' + m + '" class="' +
        (curMin === m && ui.focus.mode === "focus" && !ui.focus.running ? "on" : "") +
        '">' + m + " 分</button>";
    });
    html += "</div>";
    // DC Organic: 260 SVG ring, Caprasimo time, thick 14px stroke.
    html += '<div class="focus-ring" aria-label="' + modeLabel + " " + pad(mm) + ":" + pad(ss) + '">' +
      '<svg width="260" height="260" viewBox="0 0 260 260" aria-hidden="true">' +
      '<circle class="focus-ring-track" cx="130" cy="130" r="' + r +
      '" fill="none" stroke="var(--color-neutral-200)" stroke-width="14"></circle>' +
      '<circle class="focus-ring-fill" cx="130" cy="130" r="' + r +
      '" fill="none" stroke="var(--color-accent)" stroke-width="14" stroke-linecap="round" ' +
      'stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) +
      '" transform="rotate(-90 130 130)"></circle></svg>' +
      '<div class="focus-ring-center">' +
      '<div class="time">' + pad(mm) + ":" + pad(ss) + "</div>" +
      '<div class="focus-ring-sub">' + modeLabel + "</div></div></div>";
    var bound = ui.focus.habitId
      ? state.habits.find(function (h) { return h.id === ui.focus.habitId; })
      : null;
    html += '<div class="focus-habit-pill">' +
      (bound ? "綁定 · " + esc(bound.name) : (ui.focus.running ? "進行中" : "未綁定習慣")) +
      "</div>";
    html += '<div class="field"><label>綁定習慣（可選）</label><select id="focusHabit"><option value="">—</option>';
    state.habits.filter(function (h) { return !h.archived && h.type === "duration"; }).forEach(function (h) {
      html += '<option value="' + h.id + '"' + (ui.focus.habitId === h.id ? " selected" : "") + ">" + esc(h.name) + "</option>";
    });
    html += "</select></div>";
    html += '<div class="grid-2"><div class="field"><label>專注（分）</label><input id="focusMin" type="number" min="1" value="' +
      (state.settings.focusMin || 25) + '" /></div>' +
      '<div class="field"><label>休息（分）</label><input id="breakMin" type="number" min="1" value="' +
      (state.settings.breakMin || 5) + '" /></div></div>';
    html += '<div class="settings-row" style="padding:0;margin-top:8px"><label class="settings-row-label">' +
      '<input type="checkbox" id="focusSoundEnabled"' +
      (state.settings.focusSoundEnabled !== false ? " checked" : "") + " /> 提示音</label></div>";
    html += '<div class="focus-actions">' +
      '<button class="btn" data-focus="' + (ui.focus.running ? "pause" : "start") + '">' +
      (ui.focus.running ? "暫停" : "開始") + "</button>" +
      '<button class="btn ghost" data-focus="reset" aria-label="重設">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>' +
      '<button class="btn soft" data-focus="switch">' +
      (ui.focus.mode === "focus" ? "切去休息" : "切去專注") + "</button></div>";
    var todayFocus = state.focusSessions.filter(function (s) { return dateKey(s.startedAt) === todayKey(); });
    var sum = todayFocus.reduce(function (a, s) { return a + Number(s.minutes || 0); }, 0);
    var weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    var weekSum = 0;
    var weekCount = 0;
    state.focusSessions.forEach(function (s) {
      var d = new Date(s.startedAt);
      if (d >= weekStart) {
        weekSum += Number(s.minutes || 0);
        weekCount++;
      }
    });
    html += '<div class="focus-stats"><span>今天已完成</span>' +
      '<strong class="focus-stats-value">' + todayFocus.length + " 節</strong></div>";
    html += '<div class="focus-stats-sub muted tiny">今日 ' + fmtMin(sum) +
      " · 本週 " + weekCount + " 次 · " + fmtMin(weekSum) + "</div>";
    var recent = state.focusSessions.slice().sort(function (a, b) {
      return Number(b.startedAt) - Number(a.startedAt);
    }).slice(0, 8);
    html += '<div class="focus-history"><div class="section-title">最近專注</div>';
    if (recent.length) {
      recent.forEach(function (s) {
        var habit = s.habitId ? state.habits.find(function (h) { return h.id === s.habitId; }) : null;
        html += '<div class="focus-history-row"><div><strong>' + fmtMin(s.minutes) + "</strong>" +
          '<span class="muted tiny"> · ' + dateKey(s.startedAt) +
          (habit ? " · " + esc(habit.name) : "") + "</span></div>" +
          '<button type="button" class="btn sm ghost" data-delete-focus="' + s.id + '">刪除</button></div>';
      });
    } else {
      html += '<div class="empty compact" style="padding:16px 8px">' +
        "<p>尚無專注紀錄</p>" +
        '<p class="muted tiny">按「開始」完成一輪番茄鐘後，這裡會列出時間與可刪除紀錄。</p></div>';
    }
    html += "</div>";
    return html;
  }

  function focusTick() {
    if (!ui.focus.running) return;
    ui.focus.remainMs -= 250;
      if (ui.focus.remainMs <= 0) {
      ui.focus.remainMs = 0;
      ui.focus.running = false;
      clearInterval(ui.focus.timerId);
      ui.focus.timerId = null;
      var doneMode = ui.focus.mode;
      playFocusChime();
      notifyFocusDone(doneMode);
      if (ui.focus.mode === "focus") {
        var mins = Math.round(ui.focus.totalMs / 60000);
        state.focusSessions.push(touch({
          id: uid(),
          startedAt: Date.now() - ui.focus.totalMs,
          minutes: mins,
          habitId: ui.focus.habitId || "",
          label: "Pomodoro"
        }));
        if (ui.focus.habitId) {
          var habit = state.habits.find(function (h) { return h.id === ui.focus.habitId; });
          if (habit && habit.type === "duration") {
            var key = todayKey();
            var c = getCheckin(habit.id, key);
            if (!c) {
              state.checkins.push(touch({
                id: uid(), habitId: habit.id, date: key, value: mins, minutes: mins, note: "來自專注",
                extra: isExtraDay(habit, key)
              }));
            } else {
              c.minutes = Number(c.minutes || 0) + mins;
              c.value = c.minutes;
              if (isExtraDay(habit, key)) c.extra = true;
              touch(c);
            }
            afterHabitCompleted(habit, key);
          }
        }
        saveState();
        toast("專注完成！休息一下");
        ui.focus.mode = "break";
        ui.focus.totalMs = (state.settings.breakMin || 5) * 60000;
        ui.focus.remainMs = ui.focus.totalMs;
      } else {
        toast("休息結束，繼續加油");
        ui.focus.mode = "focus";
        ui.focus.totalMs = (state.settings.focusMin || 25) * 60000;
        ui.focus.remainMs = ui.focus.totalMs;
      }
      if (ui.view === "focus") renderFocus();
      else renderTopChips();
      return;
    }
    if (ui.view === "focus") {
      var fill = document.querySelector(".focus-ring-fill");
      var time = document.querySelector(".focus-ring .time");
      if (fill && time) {
        var total = Math.max(1, ui.focus.totalMs);
        var remain = Math.max(0, ui.focus.remainMs);
        var circ = 2 * Math.PI * 110;
        fill.setAttribute("stroke-dashoffset", (circ * (remain / total)).toFixed(2));
        var mm = Math.floor(remain / 60000);
        var ss = Math.floor((remain % 60000) / 1000);
        time.textContent = pad(mm) + ":" + pad(ss);
      }
    }
  }

  function focusControl(cmd) {
    if (cmd === "start") {
      ensureAudio();
      var fm = Number(document.getElementById("focusMin") && document.getElementById("focusMin").value) || state.settings.focusMin || 25;
      var bm = Number(document.getElementById("breakMin") && document.getElementById("breakMin").value) || state.settings.breakMin || 5;
      state.settings.focusMin = fm;
      state.settings.breakMin = bm;
      var hab = document.getElementById("focusHabit");
      if (hab) ui.focus.habitId = hab.value;
      if (!ui.focus.running) {
        if (ui.focus.remainMs <= 0 || ui.focus.remainMs === ui.focus.totalMs) {
          ui.focus.totalMs = (ui.focus.mode === "focus" ? fm : bm) * 60000;
          ui.focus.remainMs = ui.focus.totalMs;
        }
        ui.focus.running = true;
        clearInterval(ui.focus.timerId);
        ui.focus.timerId = setInterval(focusTick, 250);
        saveState();
        toast(ui.focus.mode === "focus" ? "專注開始" : "休息開始");
      }
    } else if (cmd === "pause") {
      ui.focus.running = false;
      clearInterval(ui.focus.timerId);
      ui.focus.timerId = null;
      toast("已暫停");
    } else if (cmd === "reset") {
      ui.focus.running = false;
      clearInterval(ui.focus.timerId);
      ui.focus.timerId = null;
      ui.focus.mode = "focus";
      ui.focus.totalMs = (state.settings.focusMin || 25) * 60000;
      ui.focus.remainMs = ui.focus.totalMs;
      toast("已重設");
    } else if (cmd === "switch") {
      ui.focus.running = false;
      clearInterval(ui.focus.timerId);
      ui.focus.timerId = null;
      ui.focus.mode = ui.focus.mode === "focus" ? "break" : "focus";
      ui.focus.totalMs = (ui.focus.mode === "focus" ? state.settings.focusMin : state.settings.breakMin) * 60000;
      ui.focus.remainMs = ui.focus.totalMs;
    }
    render();
  }

  function renderGoalsPanel() {
    var html = '<div class="settings-group"><div class="settings-group-title">短期目標</div>';
    var shorts = state.goals.filter(function (g) { return g.kind === "short" && isGoalOpen(g); });
    if (!shorts.length) html += '<div class="settings-row"><span class="settings-row-label muted">尚無進行中短期目標</span></div>';
    else shorts.forEach(function (g) { html += goalRow(g); });
    html += '<div class="settings-row"><button class="btn sm block" data-action="add-goal-short">+ 新增短期目標</button></div>';
    html += '</div><div class="settings-group"><div class="settings-group-title">長期目標</div>';
    var longs = state.goals.filter(function (g) { return g.kind === "long" && isGoalOpen(g); });
    if (!longs.length) html += '<div class="settings-row"><span class="settings-row-label muted">尚無進行中長期目標</span></div>';
    else longs.forEach(function (g) { html += goalRow(g); });
    html += '<div class="settings-row"><button class="btn sm block" data-action="add-goal-long">+ 新增長期目標</button></div></div>';

    var achievements = state.goals.filter(isGoalFinished).sort(function (a, b) {
      return Number(b.finishedAt) - Number(a.finishedAt);
    });
    html += '<div class="settings-group achievements-group"><div class="settings-group-title">成就列表</div>';
    if (!achievements.length) {
      html += '<div class="settings-row"><span class="settings-row-label muted">' +
        "完成目標後會出現在這裡，例如 AWS 證書或職業成果。</span></div>";
    } else {
      html += '<div class="achievements-list" role="list">';
      achievements.forEach(function (g) { html += achievementRow(g); });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function goalRow(g) {
    var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
    var habit = g.habitId ? state.habits.find(function (h) { return h.id === g.habitId; }) : null;
    var unit = goalUnitLabel(g);
    var plusLabel = g.unitMode === "hours" ? "+1 小時" : "+1";
    var gcolor = goalAccentColor(g, habit);
    var habitLine = habit
      ? '<div class="goal-habit-line">' +
        '<button type="button" class="goal-habit-chip" style="--hcolor:' + escAttr(habit.color) +
        '" data-habit-open="' + habit.id + '"><span class="goal-habit-dot" aria-hidden="true"></span>' +
        "連結習慣：" + esc(habit.name) + "</button>" +
        '<span class="muted tiny">' +
        (isHabitDone(habit, todayKey()) ? "今日已打卡" : "今日未打卡") + "</span></div>"
      : "";
    return '<div class="settings-row goal-row' + (gcolor ? " has-habit" : "") + '"' +
      ' style="--hcolor:' + escAttr(gcolor) + ';flex-direction:column;align-items:stretch">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%">' +
      '<span class="settings-row-label"><strong>' + esc(g.title) + "</strong>" +
      ' <span class="goal-type-badge type-' + escAttr(g.goalType || "general") + '">' +
      goalTypeLabel(g.goalType) + "</span></span>" +
      '<span class="settings-row-value">' + g.current + " / " + g.target +
      (unit ? " " + esc(unit) : "") + " · " + pct + "%</span></div>" +
      (g.outcome ? '<div class="tiny goal-outcome-preview">成果：' + esc(g.outcome) + "</div>" : "") +
      (g.dueAt ? '<div class="tiny">期限 ' + dateKey(g.dueAt) + "</div>" : "") +
      goalMetaChipsHtml(g) +
      habitLine +
      '<div class="goal-progress-wrap">' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="goal-pct-ring" style="--p:' + pct + '%" aria-label="完成 ' + pct + '%"><span>' + pct + "%</span></div>" +
      "</div>" +
      '<div class="row-actions" style="margin-top:6px">' +
      '<button class="btn sm soft" data-goal-plus="' + g.id + '" aria-label="' + escAttr(plusLabel + " " + g.title) +
      '">' + plusLabel + "</button>" +
      (habit ? '<button class="btn sm soft" data-goal-check="' + g.id + '" aria-label="打卡並推進 ' +
        escAttr(g.title) + '">打卡並推進</button>' : "") +
      '<button class="btn sm soft" data-goal-finish="' + g.id + '" aria-label="標記完成 ' + escAttr(g.title) +
      '">標記完成</button>' +
      '<button class="btn sm ghost" data-edit-goal="' + g.id + '" aria-label="編輯目標 ' + escAttr(g.title) +
      '">編輯</button>' +
      '<button class="btn sm warn" data-delete-goal="' + g.id + '" aria-label="刪除目標 ' + escAttr(g.title) +
      '">刪除</button></div></div>';
  }

  function achievementRow(g) {
    var unit = goalUnitLabel(g);
    var when = "";
    if (g.finishedAt) {
      var d = new Date(g.finishedAt);
      when = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    }
    var label = esc(g.title) + "（" + goalTypeLabel(g.goalType) + "成就）";
    return '<div class="settings-row achievement-row" style="flex-direction:column;align-items:stretch" role="listitem" aria-label="' +
      escAttr(label) + '">' +
      '<div class="achievement-head">' +
      '<span class="achievement-mark" aria-hidden="true">★</span>' +
      '<div class="achievement-body">' +
      '<div class="achievement-title"><strong>' + esc(g.title) + "</strong>" +
      ' <span class="goal-type-badge type-' + escAttr(g.goalType || "general") + '">' +
      goalTypeLabel(g.goalType) + "</span></div>" +
      '<div class="tiny">' + g.current + " / " + g.target + (unit ? " " + esc(unit) : "") +
      (when ? " · 完成於 " + when : "") + "</div>" +
      (g.outcome ? '<div class="achievement-outcome">' + esc(g.outcome) + "</div>" : "") +
      "</div></div>" +
      '<div class="row-actions" style="margin-top:6px">' +
      '<button class="btn sm ghost" data-edit-goal="' + g.id + '" aria-label="查看或編輯成就 ' + escAttr(g.title) +
      '">查看／編輯</button>' +
      '<button class="btn sm soft" data-goal-reopen="' + g.id + '" aria-label="將 ' + escAttr(g.title) +
      ' 移回進行中">移回進行中</button>' +
      '<button class="btn sm warn" data-delete-goal="' + g.id + '" aria-label="刪除成就 ' + escAttr(g.title) +
      '">刪除</button></div></div>';
  }

  function openGoalEditor(kind, item) {
    var g = normalizeGoal(item || {
      id: "", title: "", kind: kind || "short", target: 10, current: 0,
      unitMode: "count", unit: "次", dueAt: "", habitId: "", goalType: "general",
      outcome: "", color: colors()[1] || colors()[0]
    });
    var due = g.dueAt ? dateKey(g.dueAt) : "";
    var palette = goalColorPalette();
    var linkedHabit = g.habitId
      ? state.habits.find(function (h) { return h.id === g.habitId; })
      : null;
    // Match strip accent so a no-op save does not overwrite displayed color.
    var selectedColor = goalAccentColor(g, linkedHabit) || palette[0];
    var habitOpts = '<option value="">— 不連結 —</option>' +
      state.habits.filter(function (h) { return !h.archived; }).map(function (h) {
        return opt(h.id, h.name, g.habitId || "");
      }).join("");
    var typeOpts =
      opt("general", "一般目標", g.goalType) +
      opt("cert", "證書（如 AWS）", g.goalType) +
      opt("outcome", "成果（如職業／頭銜）", g.goalType);
    var unitOpts =
      opt("count", "次數", g.unitMode) +
      opt("hours", "小時", g.unitMode) +
      opt("custom", "自訂單位", g.unitMode);
    openModal(
      "<h3>" + (g.id ? "編輯目標" : (g.kind === "long" ? "新增長期目標" : "新增短期目標")) + "</h3>" +
      '<div class="field"><label>標題</label><input id="gTitle" value="' + escAttr(g.title) +
      '" placeholder="例如：取得 AWS SAA 證書" /></div>' +
      '<div class="field"><label>類型</label><select id="gType">' + typeOpts + "</select></div>" +
      '<div class="grid-2"><div class="field"><label>目前進度</label><input id="gCur" type="number" step="0.1" value="' +
      g.current + '" /></div>' +
      '<div class="field"><label>目標數值</label><input id="gTarget" type="number" step="0.1" value="' +
      g.target + '" /></div></div>' +
      '<div class="field"><label>計算單位</label><select id="gUnitMode">' + unitOpts + "</select></div>" +
      '<div class="field" id="gUnitCustomWrap"' + (g.unitMode === "custom" ? "" : ' style="display:none"') +
      '><label>自訂單位名稱</label><input id="gUnit" value="' + escAttr(g.unitMode === "custom" ? g.unit : "") +
      '" placeholder="頁 / km / 場" /></div>' +
      '<div class="field"><label>顏色（選一個）</label><div class="swatches" id="gColors" role="listbox" aria-label="目標顏色">' +
      palette.map(function (c) {
        var on = c === selectedColor;
        return '<button type="button" class="swatch' + (on ? " active" : "") +
          '" data-color="' + c + '" style="background:' + c + '"' +
          ' role="option" aria-selected="' + (on ? "true" : "false") + '"' +
          ' aria-label="目標顏色 ' + c + '"></button>';
      }).join("") +
      '</div><p class="tiny muted" style="margin:6px 0 0">每個目標只會套用一個顏色。</p>' +
      '<input type="hidden" id="gColor" value="' + escAttr(selectedColor) + '" /></div>' +
      '<div class="field"><label>成果／結果（可選）</label><textarea id="gOutcome" rows="2" placeholder="例如：拿到 AWS Solutions Architect Associate；或成為職業聯賽選手">' +
      esc(g.outcome || "") + "</textarea></div>" +
      '<div class="field"><label>期限（可選）</label><input id="gDue" type="date" value="' + due + '" /></div>' +
      '<div class="field"><label>連結習慣（可選）</label><select id="gHabit">' + habitOpts + "</select>" +
      '<p class="tiny muted" style="margin:6px 0 0">打卡（含非排程額外日）會自動推進目標；小時目標若連結「計時」習慣，會按分鐘換算。</p></div>' +
      '<div class="row-actions"><button class="btn" id="gSave">儲存</button>' +
      (g.id ? '<button class="btn warn" id="gDel">刪除</button>' : "") +
      '<button class="btn ghost" id="gCancel">取消</button></div>'
    );
    var unitModeEl = document.getElementById("gUnitMode");
    var customWrap = document.getElementById("gUnitCustomWrap");
    unitModeEl.onchange = function () {
      customWrap.style.display = unitModeEl.value === "custom" ? "" : "none";
    };
    document.getElementById("gColors").onclick = function (e) {
      var b = e.target.closest("[data-color]");
      if (!b) return;
      selectedColor = b.getAttribute("data-color");
      document.getElementById("gColor").value = selectedColor;
      Array.prototype.forEach.call(document.querySelectorAll("#gColors .swatch"), function (el) {
        var on = el.getAttribute("data-color") === selectedColor;
        el.classList.toggle("active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
    };
    document.getElementById("gCancel").onclick = closeModal;
    document.getElementById("gSave").onclick = function () {
      var title = document.getElementById("gTitle").value.trim();
      if (!title) return toast("請輸入標題");
      var dueVal = document.getElementById("gDue").value;
      var unitMode = document.getElementById("gUnitMode").value || "count";
      var unit = unitMode === "hours" ? "小時" : unitMode === "count" ? "次" :
        document.getElementById("gUnit").value.trim();
      if (unitMode === "custom" && !unit) return toast("請輸入自訂單位");
      var now = Date.now();
      var payload = normalizeGoal({
        title: title,
        kind: g.kind,
        goalType: document.getElementById("gType").value || "general",
        current: Number(document.getElementById("gCur").value) || 0,
        target: Number(document.getElementById("gTarget").value) || 1,
        unitMode: unitMode,
        unit: unit,
        color: document.getElementById("gColor").value || selectedColor || palette[0],
        outcome: document.getElementById("gOutcome").value.trim(),
        dueAt: dueVal ? parseKey(dueVal).getTime() : null,
        habitId: document.getElementById("gHabit").value || "",
        finishedAt: g.finishedAt || null,
        createdAt: g.createdAt || (g.id ? null : now),
        lastBumpKey: g.lastBumpKey || "",
        lastBumpAmount: g.lastBumpAmount || 0
      });
      if (g.id) {
        var existing = state.goals.find(function (x) { return x.id === g.id; });
        if (existing) {
          var keepCreated = existing.createdAt || g.createdAt || now;
          Object.assign(existing, payload);
          existing.createdAt = keepCreated;
          if (Number(existing.current) < Number(existing.target)) existing.finishedAt = null;
          else maybeFinishGoal(existing);
          touch(existing);
        }
      } else {
        var created = touch(Object.assign({ id: uid(), createdAt: now }, payload));
        maybeFinishGoal(created);
        state.goals.push(created);
      }
      saveState();
      closeModal();
      var doneNow = Number(payload.current) >= Number(payload.target);
      toast(doneNow ? "已存入成就列表" : "目標已儲存");
      render();
    };
    if (g.id) {
      document.getElementById("gDel").onclick = function () {
        if (!window.confirm("確定刪除此目標？")) return;
        markTombstone(g.id);
        state.goals = state.goals.filter(function (x) { return x.id !== g.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  // Mark linked habit done / sync hours; linked goals bump via afterHabitCompleted.
  function goalCheckAndPlus(goalId) {
    var goal = state.goals.find(function (x) { return x.id === goalId; });
    if (!goal || goal.finishedAt) return;
    var key = todayKey();
    if (goal.habitId) {
      var habit = state.habits.find(function (h) { return h.id === goal.habitId; });
      if (habit && habit.type === "yesno" && !isHabitDone(habit, key)) {
        var existing = getCheckin(habit.id, key);
        if (existing) {
          existing.value = 1;
          if (isExtraDay(habit, key)) existing.extra = true;
          touch(existing);
        } else {
          state.checkins.push(touch({
            id: uid(), habitId: habit.id, date: key, value: 1, minutes: 0, note: "",
            extra: isExtraDay(habit, key)
          }));
        }
        saveState();
        afterHabitCompleted(habit, key);
        render();
        return;
      }
      if (habit && goal.unitMode === "hours" && habit.type === "duration") {
        var result = bumpLinkedGoals(habit, key);
        saveState();
        render();
        if (result.finished.length) toast("成就解鎖：" + result.finished.join("、"));
        else if (result.bumped.length) toast("已同步小時進度");
        else toast("今日尚未有計時紀錄，請先打卡或專注");
        return;
      }
    }
    goal.current = Math.round((Number(goal.current) + 1) * 100) / 100;
    touch(goal);
    var finished = maybeFinishGoal(goal);
    saveState();
    render();
    toast(finished ? "成就解鎖：" + goal.title : "已更新目標進度");
  }

  function renderNotifyPanel() {
    var supported = "Notification" in window;
    var perm = supported ? Notification.permission : "unsupported";
    var permLabel = { granted: "已允許", denied: "已拒絕", default: "尚未詢問", unsupported: "不支援" };
    var html = '<div class="settings-group"><div class="settings-group-title">提醒</div>';
    html += '<div class="settings-row" style="flex-direction:column;align-items:stretch">' +
      '<p class="muted tiny" style="margin:0">本機提醒僅在 App 開啟時有效。iOS 背景通知有限；加到主畫面後 iOS 16.4+ 可支援 Web Push。</p></div>';
    html += '<div class="settings-row"><span class="settings-row-label">通知權限</span>' +
      '<span class="settings-row-value">' + (permLabel[perm] || perm) + "</span></div>";
    if (supported && perm !== "granted") {
      html += '<div class="settings-row"><button class="btn sm block" data-notify="request">請求通知權限</button></div>';
    }
    html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="notifyEnabled"' +
      (state.settings.notifyEnabled ? " checked" : "") + (supported ? "" : " disabled") +
      " /> 啟用提醒</label></div>";
    html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="notifyHabits"' +
      (state.settings.notifyHabits !== false ? " checked" : "") +
      (state.settings.notifyEnabled && supported ? "" : " disabled") +
      " /> 習慣提醒（使用習慣的建議時段）</label></div>";
    html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="notifyEvents"' +
      (state.settings.notifyEvents !== false ? " checked" : "") +
      (state.settings.notifyEnabled && supported ? "" : " disabled") +
      " /> 行程提醒（當日開始時間）</label></div>";
    html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="notifyCountdowns"' +
      (state.settings.notifyCountdowns !== false ? " checked" : "") +
      (state.settings.notifyEnabled && supported ? "" : " disabled") +
      " /> 倒數提醒（3 日內，早上 9 時）</label></div>";
    html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="settingsFocusSound"' +
      (state.settings.focusSoundEnabled !== false ? " checked" : "") +
      " /> 專注提示音</label></div>";
    html += "</div>";
    return html;
  }

  function renderThemePanel() {
    var cur = state.settings.theme || "sunshine";
    var themes = [
      { id: "sunshine", name: "Organic 暖沙", previewClass: "preview-sunshine" },
      { id: "sea", name: "Organic 海霧", previewClass: "preview-sea" },
      { id: "fire", name: "Organic 赤陶", previewClass: "preview-fire" },
      { id: "ocean", name: "海岸晴空", previewClass: "preview-ocean" },
      { id: "nightcity", name: "夜景城市", previewClass: "preview-nightcity" },
      { id: "forest", name: "林間晨光", previewClass: "preview-forest" },
      { id: "mountain", name: "山嵐薄霧", previewClass: "preview-mountain" },
      { id: "aurora", name: "極光夜空", previewClass: "preview-aurora" },
      { id: "dusk", name: "黃昏海岸", previewClass: "preview-dusk" },
      { id: "photo", name: "自訂相片", previewClass: "preview-photo", photo: state.settings.photoDataUrl }
    ];
    var html = '<div class="settings-group"><div class="settings-group-title">主題</div>';
    html += '<p class="muted tiny" style="margin:0 16px 8px">風景主題會在背景顯示場景；亦可上傳自己的相片。</p>';
    html += '<div style="padding:12px 16px"><div class="theme-grid">';
    themes.forEach(function (th) {
      var previewStyle = th.photo ? ' style="background-image:linear-gradient(180deg,rgba(255,255,255,0.4),rgba(0,0,0,0.3)),url(' + th.photo + ');background-size:cover"' : "";
      html += '<button type="button" class="theme-card' + (cur === th.id ? " on" : "") + '" data-theme-pick="' + th.id + '">' +
        '<div class="preview ' + th.previewClass + '"' + previewStyle + '></div><strong>' + esc(th.name) + '</strong></button>';
    });
    html += '</div></div>';
    html += '<div class="settings-row" style="flex-direction:column;align-items:stretch">' +
      '<label class="settings-row-label">上傳相片（自訂主題）</label>' +
      '<input type="file" id="photoUpload" accept="image/*" /></div>';
    if (state.settings.palette && state.settings.palette.length) {
      html += '<div class="settings-row" style="flex-direction:column;align-items:stretch"><span class="settings-row-label">抽取色板</span><div class="swatches">';
      state.settings.palette.forEach(function (c) {
        html += '<span class="swatch" style="background:' + c + '"></span>';
      });
      html += "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function renderSyncPanel() {
    var connected = state.settings.googleConnected;
    var autoOn = state.settings.autoSync !== false;
    var html = '<div class="settings-group"><div class="settings-group-title">Google Drive 自動同步</div>';
    html += '<div class="settings-row"><span class="settings-row-label">狀態</span>' +
      '<span class="chip sync-chip sync-' + syncStatus + '">' + syncStatusLabel() + "</span></div>";
    html += '<div class="settings-row" style="flex-direction:column;align-items:stretch">' +
      '<p class="muted tiny" style="margin:0">Git 式同步：先拉取合併，再上傳（' + DRIVE_FILE +
      "）。空本機不會覆寫雲端。開啟 App 或返回時會自動登入並同步；背景定時同步不會反覆彈出 Google 視窗。若你關閉登入視窗，可按「立即同步」再登。</p></div>";
    html += '<div class="settings-row" style="flex-direction:column;align-items:stretch">' +
      '<label class="settings-row-label">OAuth Client ID</label>' +
      '<input id="googleClientId" value="' + escAttr(state.settings.googleClientId || "") +
      '" placeholder="123456789.apps.googleusercontent.com" /></div>';
    if (connected) {
      html += '<div class="settings-row"><label class="settings-row-label"><input type="checkbox" id="autoSyncToggle"' +
        (autoOn ? " checked" : "") + " /> 自動同步</label></div>" +
        '<div class="settings-row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn sm soft" data-sync="drive-pull">立即同步</button>' +
        '<button class="btn sm ghost" data-sync="disconnect">中斷連接</button></div>';
    } else {
      html += '<div class="settings-row"><button class="btn block" data-sync="connect">連接 Google Drive</button></div>';
    }
    html += '<div class="settings-row" style="gap:8px;flex-wrap:wrap">' +
      '<button class="btn sm ghost" data-sync="export">匯出備份</button>' +
      '<button class="btn sm ghost" data-sync="import">匯入備份</button></div>';
    if (state.syncUpdatedAt) {
      html += '<div class="settings-row"><span class="settings-row-value">上次更新：' +
        new Date(state.syncUpdatedAt).toLocaleString("zh-HK") + "</span></div>";
    }
    html += '<details class="advanced-sync" style="margin:0 16px 16px"><summary>進階／舊版同步</summary>' +
      '<p class="muted tiny">舊版 Apps Script 手動拉取／推送。</p>' +
      '<div class="field"><label>Apps Script URL</label><input id="cloudUrl" value="' +
      escAttr(state.settings.cloudUrl || "") + '" placeholder="https://script.google.com/macros/s/..." /></div>' +
      '<div class="field"><label>Token</label><input id="cloudToken" type="password" value="' +
      escAttr(state.settings.cloudToken || "") + '" placeholder="SOLARA_TOKEN" /></div>' +
      '<div class="row-actions">' +
      '<button class="btn sm ghost" data-sync="pull">從雲端拉取</button>' +
      '<button class="btn sm ghost" data-sync="push">推送到雲端</button></div></details>';
    html += '<input type="file" id="importFile" accept="application/json,.json" style="display:none" /></div>';
    return html;
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "solara-backup-" + todayKey() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已匯出");
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = normalizeState(JSON.parse(reader.result));
        state = data;
        state.syncUpdatedAt = Date.now();
        saveState();
        applyTheme();
        toast("匯入成功");
        render();
      } catch (e) {
        toast("匯入失敗：格式錯誤");
      }
    };
    reader.readAsText(file);
  }

  function cloudUrl() {
    var url = (state.settings.cloudUrl || "").trim();
    if (!url) throw new Error("no_url");
    return url;
  }

  function cloudToken() {
    return (state.settings.cloudToken || "").trim();
  }

  function saveCloudSettings() {
    var urlEl = document.getElementById("cloudUrl");
    var tokEl = document.getElementById("cloudToken");
    if (urlEl) state.settings.cloudUrl = urlEl.value.trim();
    if (tokEl) state.settings.cloudToken = tokEl.value.trim();
    saveState();
  }

  function cloudPull() {
    saveCloudSettings();
    var url = cloudUrl();
    var token = cloudToken();
    if (!token) return toast("請輸入 Token");
    toast("拉取中…");
    fetch(url + "?token=" + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "fail");
        if (!res.data) {
          toast("雲端尚無備份");
          return;
        }
        var merged = mergeSyncState(state, res.data, res.updatedAt);
        state = merged.state;
        saveState();
        applyTheme();
        toast(merged.winner === "remote" ? "已用雲端資料覆蓋" : "本機較新，保留本機");
        render();
      })
      .catch(function () { toast("拉取失敗"); });
  }

  function cloudPush() {
    saveCloudSettings();
    var url = cloudUrl();
    var token = cloudToken();
    if (!token) return toast("請輸入 Token");
    saveState();
    toast("推送中…");
    fetch(url + "?token=" + encodeURIComponent(token) + "&mode=merge", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ data: state, mode: "merge" })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "fail");
        toast("已推送到雲端");
      })
      .catch(function () { toast("推送失敗"); });
  }

  function goMoreTab(tab) {
    ui.view = "settings";
    ui.settingsTab = tab === "goals" || tab === "archive" || tab === "theme" || tab === "sync" || tab === "notify" ? tab : "goals";
    if (tab === "countdown") {
      setView("countdown");
      return;
    }
    if (tab === "focus") {
      setView("focus");
      return;
    }
    setView("settings");
  }

  function setView(name) {
    flushDayJournalDrafts();
    saveState();
    ui.view = name;
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.getAttribute("data-view") === name);
    });
    // Diary is a child page of habits — keep 習慣 tab lit.
    var navName = name === "diary" ? "habits" : name;
    document.querySelectorAll("#nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === navName);
    });
    render();
  }

  function render() {
    // Capture unsaved diary fields before any re-render (incl. auto-sync).
    flushDayJournalDrafts();
    applyTheme();
    renderAppBar();
    renderTopChips();
    if (ui.view === "habits") renderHabits();
    else if (ui.view === "diary") renderDiary();
    else if (ui.view === "calendar") renderCalendar();
    else if (ui.view === "countdown") renderCountdown();
    else if (ui.view === "focus") renderFocus();
    else if (ui.view === "settings") renderSettings();
    var fab = document.getElementById("globalFab");
    if (fab) {
      fab.hidden = ui.view === "calendar" && ui.calMode === "timetable" || ui.view === "diary";
    }
    if (state.settings.notifyEnabled) scheduleHabitNotifications();
  }

  document.getElementById("nav").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-nav]");
    if (!btn) return;
    setView(btn.getAttribute("data-nav"));
  });

  // Modal is outside #app — same handler must cover both, or detail「編輯／刪除」會失效。
  function handleUiClick(e) {
    var t = e.target;

    // App-bar / in-page nav (e.g. 日記 → 返回習慣)
    var inPageNav = t.closest("#app [data-nav], #modal [data-nav]");
    if (inPageNav && !inPageNav.closest("#nav")) {
      setView(inPageNav.getAttribute("data-nav"));
      return;
    }

    var navSettings = t.closest("[data-settings]");
    if (navSettings) {
      ui.settingsTab = navSettings.getAttribute("data-settings");
      document.querySelectorAll("[data-settings]").forEach(function (btn) {
        btn.classList.toggle("on", btn.getAttribute("data-settings") === ui.settingsTab);
      });
      renderSettingsBody();
      return;
    }

    var habitsPanel = t.closest("[data-habits-panel]");
    if (habitsPanel) {
      flushDayJournalDrafts();
      saveState();
      var nextPanel = habitsPanel.getAttribute("data-habits-panel");
      ui.habitsPanel = nextPanel === "board" ? "board" : "today";
      renderHabits();
      return;
    }

    var openDiary = t.closest("[data-open-diary]");
    if (openDiary) {
      flushDayJournalDrafts();
      saveState();
      ui.diaryDate = openDiary.getAttribute("data-open-diary") || todayKey();
      setView("diary");
      return;
    }

    var boardMode = t.closest("[data-habits-board-mode]");
    if (boardMode) {
      state.settings.habitsBoardMode = boardMode.getAttribute("data-habits-board-mode");
      saveStateLocal();
      renderHabits();
      return;
    }

    var habitDay = t.closest("[data-habit-day]");
    if (habitDay) {
      var parts = habitDay.getAttribute("data-habit-day").split("|");
      toggleHabit(parts[0], parts[1]);
      return;
    }

    var habitBoxOpen = t.closest("[data-habit-box-open]");
    if (habitBoxOpen) {
      var boxId = habitBoxOpen.getAttribute("data-habit-box-open");
      var boxHabit = state.habits.find(function (x) { return x.id === boxId; });
      if (boxHabit) openHabitDetail(boxHabit, startOfMonth(new Date()));
      return;
    }

    var cdUnit = t.closest("[data-countdown-unit]");
    if (cdUnit) {
      ui.countdownUnit = cdUnit.getAttribute("data-countdown-unit");
      renderCountdown();
      return;
    }

    var hdetailNav = t.closest("[data-hdetail-cal]");
    if (hdetailNav) {
      ui.habitDetailMonth = addMonths(ui.habitDetailMonth, hdetailNav.getAttribute("data-hdetail-cal") === "prev" ? -1 : 1);
      refreshHabitDetail();
      return;
    }

    var toggle = t.closest("[data-toggle]");
    if (toggle) {
      var dateAttr = toggle.getAttribute("data-toggle-date");
      toggleHabit(toggle.getAttribute("data-toggle"), dateAttr || (ui.view === "calendar" ? ui.calSelected : null));
      return;
    }

    var habitOpen = t.closest("[data-habit-open]");
    if (habitOpen) {
      var hid = habitOpen.getAttribute("data-habit-open");
      var habit = state.habits.find(function (x) { return x.id === hid; });
      if (habit) openHabitDetail(habit, startOfMonth(new Date()));
      return;
    }

    var go = t.closest("[data-go]");
    if (go) {
      goMoreTab(go.getAttribute("data-go"));
      return;
    }

    var archiveHabit = t.closest("[data-archive-habit]");
    if (archiveHabit) {
      var ah = state.habits.find(function (x) { return x.id === archiveHabit.getAttribute("data-archive-habit"); });
      if (ah) {
        ah.archived = true;
        touch(ah);
        saveState();
        closeModal();
        toast("已封存");
        render();
      }
      return;
    }

    var deleteHabit = t.closest("[data-delete-habit]");
    if (deleteHabit) {
      deleteHabitById(deleteHabit.getAttribute("data-delete-habit"));
      return;
    }

    var restoreHabit = t.closest("[data-restore-habit]");
    if (restoreHabit) {
      restoreHabitById(restoreHabit.getAttribute("data-restore-habit"));
      return;
    }

    var deleteFocus = t.closest("[data-delete-focus]");
    if (deleteFocus) {
      var fid = deleteFocus.getAttribute("data-delete-focus");
      if (window.confirm("刪除這筆專注紀錄？")) {
        state.focusSessions = state.focusSessions.filter(function (s) { return s.id !== fid; });
        saveState();
        toast("已刪除");
        render();
      }
      return;
    }

    var deleteGoal = t.closest("[data-delete-goal]");
    if (deleteGoal) {
      var dgid = deleteGoal.getAttribute("data-delete-goal");
      if (window.confirm("確定刪除此目標？")) {
        markTombstone(dgid);
        state.goals = state.goals.filter(function (x) { return x.id !== dgid; });
        saveState();
        toast("已刪除");
        render();
      }
      return;
    }

    var jump = t.closest("[data-nav-jump]");
    if (jump) {
      var dest = jump.getAttribute("data-nav-jump");
      if (dest === "settings-goals") {
        closeModal();
        ui.settingsTab = "goals";
        // Must setView so .view/.nav active classes update (render alone keeps habits visible).
        setView("settings");
      }
      return;
    }

    var action = t.closest("[data-action]");
    if (action) {
      var act = action.getAttribute("data-action");
      if (act === "add-habit") openHabitEditor();
      else if (act === "add-block") openBlockEditor();
      else if (act === "add-countdown") openCountdownEditor();
      else if (act === "add-event") openEventEditor();
      else if (act === "add-goal-short") openGoalEditor("short");
      else if (act === "add-goal-long") openGoalEditor("long");
      else if (act === "quick-add") openQuickAdd();
      return;
    }

    var editHabit = t.closest("[data-edit-habit]");
    if (editHabit) {
      var h = state.habits.find(function (x) { return x.id === editHabit.getAttribute("data-edit-habit"); });
      if (h) openHabitEditor(h);
      return;
    }

    var editBlock = t.closest("[data-edit-block]");
    if (editBlock) {
      var b = state.blocks.find(function (x) { return x.id === editBlock.getAttribute("data-edit-block"); });
      if (b) openBlockEditor(b);
      return;
    }

    var editCd = t.closest("[data-edit-countdown]");
    if (editCd) {
      var c = state.countdowns.find(function (x) { return x.id === editCd.getAttribute("data-edit-countdown"); });
      if (c) openCountdownEditor(c);
      return;
    }

    var editEvent = t.closest("[data-edit-event]");
    if (editEvent) {
      var ev = state.events.find(function (x) { return x.id === editEvent.getAttribute("data-edit-event"); });
      if (ev) openEventEditor(ev);
      return;
    }

    var editGoal = t.closest("[data-edit-goal]");
    if (editGoal) {
      var g = state.goals.find(function (x) { return x.id === editGoal.getAttribute("data-edit-goal"); });
      if (g) openGoalEditor(g.kind, g);
      return;
    }

    var goalPlus = t.closest("[data-goal-plus]");
    if (goalPlus) {
      var gid = goalPlus.getAttribute("data-goal-plus");
      var goal = state.goals.find(function (x) { return x.id === gid; });
      if (goal && !goal.finishedAt) {
        goal.current = Math.round((Number(goal.current) + 1) * 100) / 100;
        touch(goal);
        var fin = maybeFinishGoal(goal);
        saveState();
        render();
        toast(fin ? "成就解鎖：" + goal.title : "已更新目標進度");
      }
      return;
    }

    var goalFinish = t.closest("[data-goal-finish]");
    if (goalFinish) {
      var fg = state.goals.find(function (x) {
        return x.id === goalFinish.getAttribute("data-goal-finish");
      });
      if (fg && !fg.finishedAt) {
        fg.current = Math.max(Number(fg.current) || 0, Number(fg.target) || 1);
        maybeFinishGoal(fg);
        saveState();
        render();
        toast("成就解鎖：" + fg.title);
      }
      return;
    }

    var goalReopen = t.closest("[data-goal-reopen]");
    if (goalReopen) {
      var rg = state.goals.find(function (x) {
        return x.id === goalReopen.getAttribute("data-goal-reopen");
      });
      if (rg) {
        reopenGoal(rg);
        saveState();
        render();
        toast("已移回進行中");
      }
      return;
    }

    var goalCheck = t.closest("[data-goal-check]");
    if (goalCheck) {
      goalCheckAndPlus(goalCheck.getAttribute("data-goal-check"));
      return;
    }

    var dayBtn = t.closest("[data-day]");
    if (dayBtn) {
      ui.calSelected = dayBtn.getAttribute("data-day");
      renderCalendar();
      return;
    }

    var moodBtn = t.closest("[data-mood]");
    if (moodBtn) {
      var moodKey = moodBtn.getAttribute("data-day-key") || todayKey();
      var moodVal = Number(moodBtn.getAttribute("data-mood")) || 0;
      captureDayJournalDraft(moodKey);
      upsertDayEntry(moodKey, { mood: moodVal });
      saveState();
      render();
      return;
    }

    var holidayBtn = t.closest("[data-toggle-holiday]");
    if (holidayBtn) {
      // Legacy control: select-all / clear-all for older bookmarks.
      var hKey = holidayBtn.getAttribute("data-toggle-holiday");
      captureDayJournalDraft(hKey);
      if (isHoliday(hKey)) setHolidayHabitIds(hKey, []);
      else {
        setHolidayHabitIds(hKey, state.habits.filter(function (h) {
          return !h.archived;
        }).map(function (h) { return h.id; }));
      }
      saveState();
      toast(isHoliday(hKey) ? "已標記全日放假，連續紀錄保留" : "已取消放假");
      render();
      return;
    }

    var habitHolidayCb = t.closest("[data-toggle-habit-holiday]");
    if (habitHolidayCb) {
      var hhKey = habitHolidayCb.getAttribute("data-day-key") || todayKey();
      var hhId = habitHolidayCb.getAttribute("data-toggle-habit-holiday");
      captureDayJournalDraft(hhKey);
      toggleHabitHoliday(hhKey, hhId);
      saveState();
      toast(isHabitHoliday(hhId, hhKey) ? "已為該習慣放假" : "已取消該習慣放假");
      render();
      return;
    }

    var selectAllHol = t.closest("[data-holiday-select-all]");
    if (selectAllHol) {
      var saKey = selectAllHol.getAttribute("data-holiday-select-all");
      captureDayJournalDraft(saKey);
      setHolidayHabitIds(saKey, state.habits.filter(function (h) {
        return !h.archived;
      }).map(function (h) { return h.id; }));
      saveState();
      toast("已全選放假，連續紀錄保留");
      render();
      return;
    }

    var clearAllHol = t.closest("[data-holiday-clear-all]");
    if (clearAllHol) {
      var caKey = clearAllHol.getAttribute("data-holiday-clear-all");
      captureDayJournalDraft(caKey);
      setHolidayHabitIds(caKey, []);
      upsertDayEntry(caKey, { holidayReason: "" });
      saveState();
      toast("已清除放假");
      render();
      return;
    }

    var saveJournal = t.closest("[data-save-day-journal]");
    if (saveJournal) {
      var jKey = saveJournal.getAttribute("data-save-day-journal");
      var root = saveJournal.closest(".day-journal") ||
        document.querySelector('.view.active .day-journal[data-day-journal="' + jKey + '"]');
      var commentEl = root ? root.querySelector("textarea[data-day-comment]") : null;
      var reasonEl = root ? root.querySelector("input[data-holiday-reason]") : null;
      var existing = getDayEntry(jKey) || {};
      upsertDayEntry(jKey, {
        comment: commentEl ? commentEl.value.trim() : (existing.comment || ""),
        holidayReason: reasonEl ? reasonEl.value.trim() : (existing.holidayReason || ""),
        mood: Number(existing.mood) || 0
      });
      saveState();
      toast("日記已儲存");
      render();
      return;
    }

    var calNav = t.closest("[data-cal]");
    if (calNav) {
      ui.calMonth = addMonths(ui.calMonth, calNav.getAttribute("data-cal") === "prev" ? -1 : 1);
      renderCalendar();
      return;
    }

    var calMode = t.closest("[data-cal-mode]");
    if (calMode) {
      ui.calMode = calMode.getAttribute("data-cal-mode");
      renderCalendar();
      return;
    }

    var ttDow = t.closest("[data-tt-dow]");
    if (ttDow) {
      ui.timetableDow = Number(ttDow.getAttribute("data-tt-dow"));
      if (ui.view === "calendar") renderCalendar();
      else renderTimetable();
      return;
    }

    var notifyBtn = t.closest("[data-notify]");
    if (notifyBtn) {
      requestNotifyPermission(function () { renderSettingsBody(); });
      return;
    }

    var themePick = t.closest("[data-theme-pick]");
    if (themePick) {
      state.settings.theme = themePick.getAttribute("data-theme-pick");
      saveState();
      applyTheme();
      renderSettingsBody();
      toast("主題已切換");
      return;
    }

    var focusPreset = t.closest("[data-focus-preset]");
    if (focusPreset) {
      if (ui.focus.running) {
        toast("計時中，請先暫停再改時長");
        return;
      }
      var mins = Number(focusPreset.getAttribute("data-focus-preset")) || 25;
      state.settings.focusMin = mins;
      ui.focus.mode = "focus";
      ui.focus.totalMs = mins * 60000;
      ui.focus.remainMs = ui.focus.totalMs;
      saveState();
      renderFocus();
      return;
    }

    var focusBtn = t.closest("[data-focus]");
    if (focusBtn) {
      focusControl(focusBtn.getAttribute("data-focus"));
      return;
    }

    var syncBtn = t.closest("[data-sync]");
    if (syncBtn) {
      var mode = syncBtn.getAttribute("data-sync");
      if (mode === "export") exportJSON();
      else if (mode === "import") document.getElementById("importFile").click();
      else if (mode === "pull") cloudPull();
      else if (mode === "push") cloudPush();
      else if (mode === "connect") connectGoogleDrive();
      else if (mode === "disconnect") disconnectGoogleDrive();
      else if (mode === "drive-pull") drivePush(); // 立即同步 = fetch+merge+push
      return;
    }
  }

  document.getElementById("app").addEventListener("click", handleUiClick);
  document.getElementById("modal").addEventListener("click", handleUiClick);

  // Keep 今日時間軸 open across check-in / 放假 re-renders.
  document.getElementById("app").addEventListener("toggle", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("today-timeline-wrap")) {
      ui.timelineOpen = !!t.open;
    }
  }, true);

  document.getElementById("app").addEventListener("change", function (e) {
    if (e.target.matches("[data-cal-opt]")) {
      var opt = e.target.getAttribute("data-cal-opt");
      if (opt === "habits") state.settings.calShowHabits = e.target.checked;
      if (opt === "countdowns") state.settings.calShowCountdowns = e.target.checked;
      saveStateLocal();
      renderCalendar();
      return;
    }
    if (e.target.id === "notifyEnabled") {
      state.settings.notifyEnabled = e.target.checked;
      saveStateLocal();
      if (state.settings.notifyEnabled) {
        requestNotifyPermission(function (perm) {
          if (perm !== "granted") {
            state.settings.notifyEnabled = false;
            saveStateLocal();
          }
          scheduleHabitNotifications();
          renderSettingsBody();
        });
      } else {
        clearNotifyTimers();
        renderSettingsBody();
      }
      toast(state.settings.notifyEnabled ? "已開啟提醒" : "已關閉提醒");
      return;
    }
    if (e.target.id === "notifyHabits") {
      state.settings.notifyHabits = e.target.checked;
      saveStateLocal();
      scheduleHabitNotifications();
      toast(state.settings.notifyHabits ? "已開啟習慣提醒" : "已關閉習慣提醒");
      return;
    }
    if (e.target.id === "notifyEvents") {
      state.settings.notifyEvents = e.target.checked;
      saveStateLocal();
      scheduleHabitNotifications();
      toast(state.settings.notifyEvents ? "已開啟行程提醒" : "已關閉行程提醒");
      return;
    }
    if (e.target.id === "notifyCountdowns") {
      state.settings.notifyCountdowns = e.target.checked;
      saveStateLocal();
      scheduleHabitNotifications();
      toast(state.settings.notifyCountdowns ? "已開啟倒數提醒" : "已關閉倒數提醒");
      return;
    }
    if (e.target.id === "focusSoundEnabled" || e.target.id === "settingsFocusSound") {
      state.settings.focusSoundEnabled = e.target.checked;
      saveStateLocal();
      toast(state.settings.focusSoundEnabled ? "已開啟提示音" : "已關閉提示音");
      if (ui.view === "focus") renderFocus();
      if (ui.view === "settings") renderSettingsBody();
      return;
    }
    if (e.target.id === "autoSyncToggle") {
      state.settings.autoSync = e.target.checked;
      saveStateLocal();
      if (state.settings.autoSync) {
        authPromptSkipped = false;
        startAutoSyncLoop();
        autoDriveSync({ allowPrompt: true });
        toast("已開啟自動同步");
      } else {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
        toast("已關閉自動同步");
      }
      return;
    }
    if (e.target.id === "googleClientId") {
      state.settings.googleClientId = e.target.value.trim();
      saveStateLocal();
      initGoogleAuth();
      return;
    }
    if (e.target.id === "photoUpload" && e.target.files && e.target.files[0]) {
      var file = e.target.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        extractPalette(dataUrl, function (palette) {
          state.settings.photoDataUrl = dataUrl;
          state.settings.palette = palette;
          state.settings.theme = "photo";
          saveState();
          applyTheme();
          renderSettingsBody();
          toast("相片主題已套用");
        });
      };
      reader.readAsDataURL(file);
    }
    if (e.target.id === "importFile" && e.target.files && e.target.files[0]) {
      importJSON(e.target.files[0]);
      e.target.value = "";
    }
  });

  // Auto fetch+merge when returning to the app (re-login if token expired).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      autoDriveSync({ allowPrompt: !getStoredToken() });
    }
  });

  // Auto fetch+merge when network comes back (re-login if needed).
  window.addEventListener("online", function () {
    autoDriveSync({ allowPrompt: !getStoredToken() });
  });

  function bootSync() {
    function start() {
      if (state.settings.googleClientId) initGoogleAuth();
      if (state.settings.googleConnected) {
        if (state.settings.autoSync === false) {
          setSyncStatus("synced");
        } else {
          setSyncStatus("syncing");
          // Auto-logon on open: may show Google once if the access token expired.
          autoDriveSync({ allowPrompt: true });
          startAutoSyncLoop();
        }
      } else {
        setSyncStatus("disconnected");
      }
    }
    if (window.google && window.google.accounts) {
      start();
      return;
    }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.google && window.google.accounts) {
        clearInterval(timer);
        start();
      } else if (tries > 60) {
        clearInterval(timer);
        setSyncStatus("disconnected");
      }
    }, 100);
  }

  applyTheme();
  if (state.settings.notifyEnabled) scheduleHabitNotifications();
  bootSync();
  render();
})();
