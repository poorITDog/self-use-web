(function () {
  "use strict";

  var STORAGE_KEY = "solara-v1";
  var BASE_COLORS = ["#F4A261", "#2A9D8F", "#E76F51", "#457B9D", "#E9C46A", "#90BE6D", "#F28482", "#1D8A99"];
  var GROUPS = ["朝早", "下午", "晚上", "健康", "工作", "生活"];
  var MONEY_CATS = ["飲食", "交通", "住屋", "娛樂", "購物", "薪資", "其他"];
  var DOW = ["日", "一", "二", "三", "四", "五", "六"];

  var state = loadState();
  var ui = {
    view: "today",
    moreTab: "timetable",
    calMonth: startOfMonth(new Date()),
    calSelected: dateKey(new Date()),
    focus: {
      running: false,
      mode: "focus",
      remainMs: (state.settings.focusMin || 25) * 60000,
      totalMs: (state.settings.focusMin || 25) * 60000,
      timerId: null,
      habitId: ""
    }
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

  function fmtMoney(n) {
    var v = Number(n) || 0;
    return (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("zh-HK", { maximumFractionDigits: 2 });
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
      settings: {
        theme: "sunshine",
        photoDataUrl: "",
        palette: [],
        cloudUrl: "",
        cloudToken: "",
        focusMin: 25,
        breakMin: 5,
        currencyLabel: "HKD"
      },
      habits: [],
      checkins: [],
      blocks: [],
      countdowns: [],
      focusSessions: [],
      goals: [],
      transactions: []
    };
  }

  function normalizeState(data) {
    var base = defaultState();
    if (!data || typeof data !== "object") return base;
    var out = Object.assign({}, base, data);
    out.settings = Object.assign({}, base.settings, data.settings || {});
    ["habits", "checkins", "blocks", "countdowns", "focusSessions", "goals", "transactions"].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    out.syncUpdatedAt = Number(out.syncUpdatedAt) || 0;
    return out;
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
  }

  function touch(obj) {
    obj.updatedAt = Date.now();
    return obj;
  }

  function mergeSyncState(local, remote, remoteUpdatedAt) {
    var localNorm = normalizeState(local);
    var remoteNorm = normalizeState(remote);
    var localTs = Number(localNorm.syncUpdatedAt) || 0;
    var remoteTs = Number(remoteUpdatedAt) || Number(remoteNorm.syncUpdatedAt) || 0;
    if (remoteTs > localTs) {
      remoteNorm.syncUpdatedAt = remoteTs;
      return { state: remoteNorm, winner: "remote" };
    }
    return { state: localNorm, winner: "local" };
  }

  function applyTheme() {
    var t = state.settings.theme || "sunshine";
    document.body.setAttribute("data-theme", t);
    if (t === "photo" && state.settings.photoDataUrl) {
      document.body.style.setProperty("--photo", "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,248,240,0.72)), url('" + state.settings.photoDataUrl + "')");
      if (state.settings.palette && state.settings.palette[0]) {
        document.documentElement.style.setProperty("--accent", state.settings.palette[0]);
        document.documentElement.style.setProperty("--accent-2", state.settings.palette[1] || state.settings.palette[0]);
        document.documentElement.style.setProperty("--accent-soft", "color-mix(in srgb, " + state.settings.palette[0] + " 22%, white)");
      }
    } else {
      document.body.style.removeProperty("--photo");
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-2");
      document.documentElement.style.removeProperty("--accent-soft");
    }
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

  function habitDueOn(habit, key) {
    var d = parseKey(key).getDay();
    var freq = (habit.frequency || [0, 1, 2, 3, 4, 5, 6]).map(Number);
    return freq.indexOf(d) >= 0;
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

  function streakFor(habit) {
    var n = 0;
    var d = new Date();
    for (var i = 0; i < 400; i++) {
      var key = dateKey(d);
      if (!habitDueOn(habit, key)) {
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
    var due = state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); });
    if (!due.length) return 0;
    var done = due.filter(function (h) { return isHabitDone(h, key); }).length;
    return Math.round((done / due.length) * 100);
  }

  function toggleHabit(habitId) {
    var habit = state.habits.find(function (h) { return h.id === habitId; });
    if (!habit) return;
    var key = todayKey();
    var existing = getCheckin(habitId, key);
    if (habit.type === "yesno") {
      if (existing && existing.value) {
        state.checkins = state.checkins.filter(function (c) { return c.id !== existing.id; });
      } else if (existing) {
        existing.value = 1;
        touch(existing);
      } else {
        state.checkins.push(touch({
          id: uid(), habitId: habitId, date: key, value: 1, minutes: 0, note: ""
        }));
      }
      saveState();
      render();
      return;
    }
    openHabitLogModal(habit);
  }

  function openModal(html) {
    document.getElementById("modal").innerHTML = html;
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function closeModal() {
    document.getElementById("modalBackdrop").classList.remove("open");
    document.getElementById("modal").innerHTML = "";
  }

  document.getElementById("modalBackdrop").addEventListener("click", function (e) {
    if (e.target.id === "modalBackdrop") closeModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  function renderTopChips() {
    var key = todayKey();
    document.getElementById("topChips").innerHTML =
      '<span class="chip">今日達成 <strong>' + completionRate(key) + '%</strong></span>' +
      '<span class="chip">投入 <strong>' + fmtMin(minutesOnDate(key)) + '</strong></span>';
  }

  function renderToday() {
    var key = todayKey();
    var habits = state.habits.filter(function (h) { return !h.archived && habitDueOn(h, key); });
    var nextCd = state.countdowns
      .filter(function (c) { return c.targetAt > Date.now(); })
      .sort(function (a, b) { return a.targetAt - b.targetAt; })[0];
    var shortGoals = state.goals.filter(function (g) { return g.kind === "short"; }).slice(0, 2);

    var html = '<div class="grid-2 hero-stats">' +
      '<div class="stat"><div class="label">今日完成</div><div class="value">' + completionRate(key) + '%</div></div>' +
      '<div class="stat"><div class="label">今日時數</div><div class="value">' + fmtMin(minutesOnDate(key)) + '</div></div>' +
      '</div>';

    if (nextCd) {
      html += '<div class="panel"><div class="section-head"><h2>下一個倒數</h2></div>' +
        '<div class="list-item"><div style="font-size:1.4rem">' + (nextCd.emoji || "⏳") + '</div>' +
        '<div><strong>' + esc(nextCd.title) + '</strong><div class="muted">' + countdownLabel(nextCd.targetAt) + '</div></div>' +
        '<button class="btn sm ghost" data-go="countdown">查看</button></div></div>';
    }

    html += '<div class="panel"><div class="section-head"><h2>今日習慣</h2>' +
      '<button class="btn sm soft" data-action="add-habit">+ 新增</button></div>';
    if (!habits.length) {
      html += '<div class="empty">今日未有習慣。去「習慣」建立第一個吧。</div>';
    } else {
      html += '<div class="habit-list">' + habits.map(habitRowHtml).join("") + "</div>";
    }
    html += "</div>";

    if (shortGoals.length) {
      html += '<div class="panel"><div class="section-head"><h2>短期目標</h2>' +
        '<button class="btn sm ghost" data-go="goals">全部</button></div><div class="list">';
      shortGoals.forEach(function (g) {
        var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
        html += '<div class="list-item" style="grid-template-columns:1fr"><div><strong>' + esc(g.title) +
          '</strong><div class="muted">' + g.current + " / " + g.target + " " + esc(g.unit || "") +
          '</div><div class="progress"><i style="width:' + pct + '%"></i></div></div></div>';
      });
      html += "</div></div>";
    }

    html += '<div class="row-actions" style="margin-top:14px">' +
      '<button class="btn" data-go="focus">開始專注</button>' +
      '<button class="btn ghost" data-go="money">記一筆</button></div>';

    document.getElementById("view-today").innerHTML = html;
  }

  function habitRowHtml(h) {
    var key = todayKey();
    var done = isHabitDone(h, key);
    var c = getCheckin(h.id, key);
    var detail = h.type === "yesno" ? (done ? "已完成" : "未完成")
      : h.type === "count" ? ((c ? c.value : 0) + " / " + (h.target || 1))
      : fmtMin(c ? (c.minutes || c.value || 0) : 0) + " / " + fmtMin(h.target || 1);
    var actionBtn = h.type === "yesno"
      ? '<button class="btn sm soft" data-toggle="' + h.id + '">' + (done ? "取消" : "完成") + "</button>"
      : '<button class="btn sm soft" data-toggle="' + h.id + '">記錄</button>';
    return '<div class="habit-item' + (done ? " done" : "") + '" data-habit="' + h.id + '">' +
      '<button type="button" class="check' + (done ? " on" : "") + '" style="--hcolor:' + h.color + '" data-toggle="' + h.id + '" aria-label="打卡">' +
      (done ? "✓" : "") + "</button>" +
      '<div class="habit-meta"><strong><span class="dot" style="--hcolor:' + h.color + '"></span>' + esc(h.name) +
      "</strong><span>" + esc(h.group || "") + " · " + detail + " · 連擊 " + streakFor(h) + "</span></div>" +
      '<div class="row-actions" style="flex-direction:column;gap:6px">' + actionBtn +
      '<button class="btn sm ghost" data-edit-habit="' + h.id + '">編輯</button></div></div>';
  }

  function renderHabits() {
    var active = state.habits.filter(function (h) { return !h.archived; });
    var html = '<div class="panel"><div class="section-head"><h2>我的習慣</h2>' +
      '<button class="btn sm" data-action="add-habit">+ 新增習慣</button></div>';
    if (!active.length) {
      html += '<div class="empty">未有習慣。建立一個，開始累積日照。</div>';
    } else {
      html += '<div class="habit-list">' + active.map(function (h) {
        var rate = monthRate(h);
        return '<div class="habit-item" data-habit="' + h.id + '">' +
          '<div class="check on" style="--hcolor:' + h.color + ';width:38px;height:38px">' + typeIcon(h.type) + '</div>' +
          '<div class="habit-meta"><strong>' + esc(h.name) + '</strong><span>' +
          esc(h.group || "未分組") + " · 本月 " + rate + "% · 連擊 " + streakFor(h) + " · 累計 " +
          fmtMin(totalMinutes(h)) + "</span></div>" +
          '<button class="btn sm ghost" data-edit-habit="' + h.id + '">編輯</button></div>';
      }).join("") + "</div>";
    }
    html += "</div>";

    html += '<div class="panel"><div class="section-head"><h2>本月時數</h2></div><div class="grid-2">';
    html += '<div class="stat"><div class="label">本月投入</div><div class="value">' + fmtMin(monthTotalMinutes()) + '</div></div>';
    html += '<div class="stat"><div class="label">最佳連擊</div><div class="value">' + bestStreak() + ' 日</div></div>';
    html += "</div></div>";

    document.getElementById("view-habits").innerHTML = html;
  }

  function typeIcon(t) {
    if (t === "count") return "#";
    if (t === "duration") return "⏱";
    return "✓";
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

  function openHabitEditor(habit) {
    var h = habit || {
      id: "", name: "", color: colors()[0], type: "yesno",
      frequency: [0, 1, 2, 3, 4, 5, 6], group: "朝早", target: 1, timeOfDay: ""
    };
    var freq = h.frequency || [];
    var palette = colors();
    openModal(
      "<h3>" + (h.id ? "編輯習慣" : "新增習慣") + "</h3>" +
      '<div class="field"><label>名稱</label><input id="hName" value="' + escAttr(h.name) + '" placeholder="例如：晨跑" /></div>' +
      '<div class="field"><label>類型</label><select id="hType">' +
      opt("yesno", "是 / 否", h.type) + opt("count", "數量", h.type) + opt("duration", "計時（分鐘）", h.type) +
      "</select></div>" +
      '<div class="field"><label>目標（數量或分鐘）</label><input id="hTarget" type="number" min="1" value="' + (h.target || 1) + '" /></div>' +
      '<div class="field"><label>分組</label><select id="hGroup">' +
      GROUPS.map(function (g) { return opt(g, g, h.group); }).join("") + "</select></div>" +
      '<div class="field"><label>建議時段（可選）</label><input id="hTime" type="time" value="' + escAttr(h.timeOfDay || "") + '" /></div>' +
      '<div class="field"><label>顏色</label><div class="swatches" id="hColors">' +
      palette.map(function (c) {
        return '<button type="button" class="swatch' + (c === h.color ? " active" : "") +
          '" data-color="' + c + '" style="background:' + c + '"></button>';
      }).join("") + '</div><input type="hidden" id="hColor" value="' + escAttr(h.color) + '" /></div>' +
      '<div class="field"><label>重複星期</label><div class="week-picks" id="hFreq">' +
      DOW.map(function (label, i) {
        return '<button type="button" data-dow="' + i + '" class="' + (freq.indexOf(i) >= 0 ? "on" : "") + '">' + label + "</button>";
      }).join("") + "</div></div>" +
      '<div class="row-actions">' +
      '<button class="btn" id="hSave">儲存</button>' +
      (h.id ? '<button class="btn ghost" id="hArchive">封存</button>' : "") +
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
    document.getElementById("hCancel").onclick = closeModal;
    document.getElementById("hSave").onclick = function () {
      var name = document.getElementById("hName").value.trim();
      if (!name) return toast("請輸入名稱");
      var frequency = [];
      Array.prototype.forEach.call(document.querySelectorAll("#hFreq button.on"), function (b) {
        frequency.push(Number(b.getAttribute("data-dow")));
      });
      if (!frequency.length) return toast("至少選一日");
      var payload = {
        name: name,
        type: document.getElementById("hType").value,
        target: Number(document.getElementById("hTarget").value) || 1,
        group: document.getElementById("hGroup").value,
        timeOfDay: document.getElementById("hTime").value,
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
    }
  }

  function openHabitLogModal(habit) {
    var key = todayKey();
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
      if (!c) {
        c = touch({
          id: uid(), habitId: habit.id, date: key, value: val,
          minutes: habit.type === "duration" ? val : 0, note: note
        });
        state.checkins.push(c);
      } else {
        c.value = val;
        c.minutes = habit.type === "duration" ? val : (c.minutes || 0);
        c.note = note;
        touch(c);
      }
      saveState();
      closeModal();
      toast("已記錄");
      render();
    };
  }

  function renderCalendar() {
    var month = ui.calMonth;
    var selected = ui.calSelected;
    var y = month.getFullYear();
    var m = month.getMonth();
    var firstDow = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var html = '<div class="panel"><div class="cal-head">' +
      '<button class="btn sm ghost" data-cal="prev">‹</button>' +
      '<h2 style="margin:0;font-family:var(--display)">' + y + " 年 " + (m + 1) + " 月</h2>" +
      '<button class="btn sm ghost" data-cal="next">›</button></div>';
    html += '<div class="cal-grid">';
    DOW.forEach(function (d) { html += '<div class="cal-dow">' + d + "</div>"; });
    for (var i = 0; i < firstDow; i++) html += '<div></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var key = dateKey(new Date(y, m, day));
      var mins = minutesOnDate(key);
      var rate = completionRate(key);
      var cls = "cal-day";
      if (key === todayKey()) cls += " today";
      if (key === selected) cls += " selected";
      html += '<button type="button" class="' + cls + '" data-day="' + key + '">' + day +
        (rate > 0 || mins > 0 ? '<span class="heat" style="opacity:' + Math.max(0.25, rate / 100) + '"></span>' : "") +
        "</button>";
    }
    html += "</div>";
    html += '<div class="grid-2" style="margin-top:12px">' +
      '<div class="stat"><div class="label">當日達成</div><div class="value">' + completionRate(selected) + '%</div></div>' +
      '<div class="stat"><div class="label">當日時數</div><div class="value">' + fmtMin(minutesOnDate(selected)) + '</div></div>' +
      "</div></div>";

    html += '<div class="panel"><div class="section-head"><h2>當日時間流</h2>' +
      '<button class="btn sm soft" data-action="add-block">+ 時段</button></div><div class="timeline">';
    var dayBlocks = blocksForDate(selected);
    var dayHabits = state.habits.filter(function (h) {
      return !h.archived && habitDueOn(h, selected) && h.timeOfDay;
    }).map(function (h) {
      return {
        id: "habit-" + h.id,
        title: h.name,
        start: h.timeOfDay,
        end: "",
        color: h.color,
        kind: "habit",
        done: isHabitDone(h, selected)
      };
    });
    var flow = dayBlocks.map(function (b) {
      return { id: b.id, title: b.title, start: b.start, end: b.end, color: b.color, kind: "block" };
    }).concat(dayHabits).sort(function (a, b) {
      return String(a.start).localeCompare(String(b.start));
    });
    if (!flow.length) {
      html += '<div class="empty">呢日未有時間區塊。可以加一個，或者喺習慣設定建議時段。</div>';
    } else {
      flow.forEach(function (item) {
        html += '<div class="block-row"><div class="block-time">' + esc(item.start) +
          (item.end ? "<br>" + esc(item.end) : "") + '</div><div class="block-body" style="--bcolor:' +
          item.color + '"><strong>' + esc(item.title) + '</strong><div class="tiny">' +
          (item.kind === "habit" ? (item.done ? "習慣 · 已完成" : "習慣 · 未完成") : "時間區塊") +
          "</div></div></div>";
      });
    }
    html += "</div></div>";

    html += '<div class="panel"><div class="section-head"><h2>當日紀錄</h2></div><div class="list">';
    var logs = state.checkins.filter(function (c) { return c.date === selected; });
    if (!logs.length) html += '<div class="empty">未有打卡紀錄</div>';
    else {
      logs.forEach(function (c) {
        var h = state.habits.find(function (x) { return x.id === c.habitId; });
        html += '<div class="list-item"><div class="dot" style="--hcolor:' + (h && h.color || "#ccc") +
          ';width:12px;height:12px;margin:0"></div><div><strong>' + esc(h ? h.name : "已刪習慣") +
          '</strong><div class="muted">' + (h && h.type === "duration" ? fmtMin(c.minutes || c.value) :
          (h && h.type === "count" ? ("數量 " + c.value) : "完成")) +
          (c.note ? " · " + esc(c.note) : "") + "</div></div><span></span></div>";
      });
    }
    html += "</div></div>";

    document.getElementById("view-calendar").innerHTML = html;
  }

  function blocksForDate(key) {
    var dow = parseKey(key).getDay();
    return state.blocks.filter(function (b) {
      if (b.date) return b.date === key;
      return Number(b.dayOfWeek) === dow;
    }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
  }

  function openBlockEditor(block) {
    var b = block || {
      id: "", title: "", dayOfWeek: new Date().getDay(), date: "",
      start: "09:00", end: "10:00", color: colors()[1], habitId: ""
    };
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
        state.blocks = state.blocks.filter(function (x) { return x.id !== b.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderMore() {
    var tabs = [
      ["timetable", "時間表"],
      ["countdown", "倒數"],
      ["focus", "專注"],
      ["goals", "目標"],
      ["money", "記帳"],
      ["theme", "主題"],
      ["sync", "同步"]
    ];
    var html = '<div class="seg">';
    tabs.forEach(function (t) {
      html += '<button type="button" data-more="' + t[0] + '" class="' + (ui.moreTab === t[0] ? "on" : "") + '">' + t[1] + "</button>";
    });
    html += '</div><div id="moreBody"></div>';
    document.getElementById("view-more").innerHTML = html;
    renderMoreBody();
  }

  function renderMoreBody() {
    var el = document.getElementById("moreBody");
    if (!el) return;
    var map = {
      timetable: renderTimetablePanel,
      countdown: renderCountdownPanel,
      focus: renderFocusPanel,
      goals: renderGoalsPanel,
      money: renderMoneyPanel,
      theme: renderThemePanel,
      sync: renderSyncPanel
    };
    el.innerHTML = (map[ui.moreTab] || renderTimetablePanel)();
  }

  function renderTimetablePanel() {
    var html = '<div class="panel"><div class="section-head"><h2>每週時間表</h2>' +
      '<button class="btn sm" data-action="add-block">+ 時段</button></div><div class="list">';
    if (!state.blocks.length) html += '<div class="empty">未有時間區塊。用時段規劃一日節奏。</div>';
    else {
      state.blocks.slice().sort(function (a, b) {
        return (Number(a.dayOfWeek) || 0) - (Number(b.dayOfWeek) || 0) || String(a.start).localeCompare(String(b.start));
      }).forEach(function (b) {
        html += '<div class="list-item"><div class="dot" style="--hcolor:' + b.color +
          ';width:12px;height:12px;margin:0"></div><div><strong>' + esc(b.title) +
          '</strong><div class="muted">' + (b.date ? b.date : ("逢星期" + DOW[b.dayOfWeek])) +
          " · " + esc(b.start) + "–" + esc(b.end) + '</div></div>' +
          '<button class="btn sm ghost" data-edit-block="' + b.id + '">編輯</button></div>';
      });
    }
    html += "</div></div>";
    return html;
  }

  function countdownLabel(ts) {
    var diff = ts - Date.now();
    if (diff <= 0) return "已到達";
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return "仲有 " + days + " 日 " + hours + " 小時";
    var mins = Math.floor((diff % 3600000) / 60000);
    return "仲有 " + hours + " 小時 " + mins + " 分";
  }

  function renderCountdownPanel() {
    var html = '<div class="panel"><div class="section-head"><h2>倒數日子</h2>' +
      '<button class="btn sm" data-action="add-countdown">+ 新增</button></div><div class="list">';
    if (!state.countdowns.length) html += '<div class="empty">未有倒數。考試、旅行、deadline 都可以加。</div>';
    else {
      state.countdowns.slice().sort(function (a, b) { return a.targetAt - b.targetAt; }).forEach(function (c) {
        html += '<div class="list-item"><div style="font-size:1.4rem">' + (c.emoji || "⏳") +
          '</div><div><strong>' + esc(c.title) + '</strong><div class="muted">' +
          countdownLabel(c.targetAt) + " · " + new Date(c.targetAt).toLocaleString("zh-HK") +
          '</div></div><button class="btn sm ghost" data-edit-countdown="' + c.id + '">編輯</button></div>';
      });
    }
    html += "</div></div>";
    return html;
  }

  function openCountdownEditor(item) {
    var c = item || { id: "", title: "", targetAt: Date.now() + 86400000 * 7, emoji: "🎯", color: colors()[0] };
    var local = new Date(c.targetAt);
    var localVal = local.getFullYear() + "-" + pad(local.getMonth() + 1) + "-" + pad(local.getDate()) +
      "T" + pad(local.getHours()) + ":" + pad(local.getMinutes());
    openModal(
      "<h3>" + (c.id ? "編輯倒數" : "新增倒數") + "</h3>" +
      '<div class="field"><label>標題</label><input id="cTitle" value="' + escAttr(c.title) + '" /></div>' +
      '<div class="field"><label>目標時間</label><input id="cAt" type="datetime-local" value="' + localVal + '" /></div>' +
      '<div class="field"><label>Emoji</label><input id="cEmoji" value="' + escAttr(c.emoji || "🎯") + '" maxlength="4" /></div>' +
      '<div class="row-actions"><button class="btn" id="cSave">儲存</button>' +
      (c.id ? '<button class="btn warn" id="cDel">刪除</button>' : "") +
      '<button class="btn ghost" id="cCancel">取消</button></div>'
    );
    document.getElementById("cCancel").onclick = closeModal;
    document.getElementById("cSave").onclick = function () {
      var title = document.getElementById("cTitle").value.trim();
      var at = new Date(document.getElementById("cAt").value).getTime();
      if (!title || !at) return toast("請填齊資料");
      var payload = {
        title: title,
        targetAt: at,
        emoji: document.getElementById("cEmoji").value || "🎯",
        color: c.color || colors()[0]
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
        state.countdowns = state.countdowns.filter(function (x) { return x.id !== c.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderFocusPanel() {
    var p = 100 - Math.round((ui.focus.remainMs / Math.max(1, ui.focus.totalMs)) * 100);
    var mm = Math.floor(ui.focus.remainMs / 60000);
    var ss = Math.floor((ui.focus.remainMs % 60000) / 1000);
    var html = '<div class="panel"><div class="section-head"><h2>' +
      (ui.focus.mode === "focus" ? "專注番茄鐘" : "休息一下") + "</h2></div>";
    html += '<div class="focus-ring" style="--p:' + p + '%"><div style="text-align:center">' +
      '<div class="time">' + pad(mm) + ":" + pad(ss) + '</div>' +
      '<div class="tiny">' + (ui.focus.running ? "進行中" : "準備開始") + "</div></div></div>";
    html += '<div class="field"><label>綁定習慣（可選）</label><select id="focusHabit"><option value="">—</option>';
    state.habits.filter(function (h) { return !h.archived && h.type === "duration"; }).forEach(function (h) {
      html += '<option value="' + h.id + '"' + (ui.focus.habitId === h.id ? " selected" : "") + ">" + esc(h.name) + "</option>";
    });
    html += "</select></div>";
    html += '<div class="grid-2"><div class="field"><label>專注（分）</label><input id="focusMin" type="number" min="1" value="' +
      (state.settings.focusMin || 25) + '" /></div>' +
      '<div class="field"><label>休息（分）</label><input id="breakMin" type="number" min="1" value="' +
      (state.settings.breakMin || 5) + '" /></div></div>';
    html += '<div class="row-actions">' +
      '<button class="btn" data-focus="' + (ui.focus.running ? "pause" : "start") + '">' +
      (ui.focus.running ? "暫停" : "開始") + "</button>" +
      '<button class="btn ghost" data-focus="reset">重設</button>' +
      '<button class="btn soft" data-focus="switch">' +
      (ui.focus.mode === "focus" ? "切去休息" : "切去專注") + "</button></div>";

    var todayFocus = state.focusSessions.filter(function (s) { return dateKey(s.startedAt) === todayKey(); });
    var sum = todayFocus.reduce(function (a, s) { return a + Number(s.minutes || 0); }, 0);
    html += '<div class="muted" style="margin-top:12px">今日專注 ' + todayFocus.length + " 次 · " + fmtMin(sum) + "</div></div>";
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
                id: uid(), habitId: habit.id, date: key, value: mins, minutes: mins, note: "來自專注"
              }));
            } else {
              c.minutes = Number(c.minutes || 0) + mins;
              c.value = c.minutes;
              touch(c);
            }
          }
        }
        saveState();
        toast("專注完成！休息一下");
        ui.focus.mode = "break";
        ui.focus.totalMs = (state.settings.breakMin || 5) * 60000;
        ui.focus.remainMs = ui.focus.totalMs;
      } else {
        toast("休息完，繼續加油");
        ui.focus.mode = "focus";
        ui.focus.totalMs = (state.settings.focusMin || 25) * 60000;
        ui.focus.remainMs = ui.focus.totalMs;
      }
      if (ui.view === "more" && ui.moreTab === "focus") render();
      else renderTopChips();
      return;
    }
    if (ui.view === "more" && ui.moreTab === "focus") {
      var ring = document.querySelector(".focus-ring");
      var time = document.querySelector(".focus-ring .time");
      if (ring && time) {
        var prog = 100 - Math.round((ui.focus.remainMs / Math.max(1, ui.focus.totalMs)) * 100);
        ring.style.setProperty("--p", prog + "%");
        var mm = Math.floor(ui.focus.remainMs / 60000);
        var ss = Math.floor((ui.focus.remainMs % 60000) / 1000);
        time.textContent = pad(mm) + ":" + pad(ss);
      }
    }
  }

  function focusControl(cmd) {
    if (cmd === "start") {
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
    var html = '<div class="panel"><div class="section-head"><h2>短期目標</h2>' +
      '<button class="btn sm" data-action="add-goal-short">+ 新增</button></div><div class="list">';
    var shorts = state.goals.filter(function (g) { return g.kind === "short"; });
    if (!shorts.length) html += '<div class="empty">未有短期目標</div>';
    else shorts.forEach(function (g) { html += goalRow(g); });
    html += '</div></div><div class="panel"><div class="section-head"><h2>長期目標</h2>' +
      '<button class="btn sm" data-action="add-goal-long">+ 新增</button></div><div class="list">';
    var longs = state.goals.filter(function (g) { return g.kind === "long"; });
    if (!longs.length) html += '<div class="empty">未有長期目標</div>';
    else longs.forEach(function (g) { html += goalRow(g); });
    html += "</div></div>";
    return html;
  }

  function goalRow(g) {
    var pct = Math.min(100, Math.round((Number(g.current) / Math.max(1, Number(g.target))) * 100));
    return '<div class="list-item" style="grid-template-columns:1fr auto"><div><strong>' + esc(g.title) +
      '</strong><div class="muted">' + g.current + " / " + g.target + " " + esc(g.unit || "") +
      (g.dueAt ? " · 期限 " + dateKey(g.dueAt) : "") +
      '</div><div class="progress"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="row-actions" style="flex-direction:column">' +
      '<button class="btn sm soft" data-goal-plus="' + g.id + '">+1</button>' +
      '<button class="btn sm ghost" data-edit-goal="' + g.id + '">編輯</button></div></div>';
  }

  function openGoalEditor(kind, item) {
    var g = item || {
      id: "", title: "", kind: kind || "short", target: 10, current: 0, unit: "", dueAt: ""
    };
    var due = g.dueAt ? dateKey(g.dueAt) : "";
    openModal(
      "<h3>" + (g.id ? "編輯目標" : (g.kind === "long" ? "新增長期目標" : "新增短期目標")) + "</h3>" +
      '<div class="field"><label>標題</label><input id="gTitle" value="' + escAttr(g.title) + '" /></div>' +
      '<div class="grid-2"><div class="field"><label>目前</label><input id="gCur" type="number" value="' + g.current + '" /></div>' +
      '<div class="field"><label>目標</label><input id="gTarget" type="number" value="' + g.target + '" /></div></div>' +
      '<div class="field"><label>單位</label><input id="gUnit" value="' + escAttr(g.unit || "") + '" placeholder="頁 / km / 次" /></div>' +
      '<div class="field"><label>期限（可選）</label><input id="gDue" type="date" value="' + due + '" /></div>' +
      '<div class="row-actions"><button class="btn" id="gSave">儲存</button>' +
      (g.id ? '<button class="btn warn" id="gDel">刪除</button>' : "") +
      '<button class="btn ghost" id="gCancel">取消</button></div>'
    );
    document.getElementById("gCancel").onclick = closeModal;
    document.getElementById("gSave").onclick = function () {
      var title = document.getElementById("gTitle").value.trim();
      if (!title) return toast("請輸入標題");
      var dueVal = document.getElementById("gDue").value;
      var payload = {
        title: title,
        kind: g.kind,
        current: Number(document.getElementById("gCur").value) || 0,
        target: Number(document.getElementById("gTarget").value) || 1,
        unit: document.getElementById("gUnit").value.trim(),
        dueAt: dueVal ? parseKey(dueVal).getTime() : null
      };
      if (g.id) {
        Object.assign(g, payload);
        touch(g);
      } else {
        state.goals.push(touch(Object.assign({ id: uid() }, payload)));
      }
      saveState();
      closeModal();
      toast("目標已儲存");
      render();
    };
    if (g.id) {
      document.getElementById("gDel").onclick = function () {
        state.goals = state.goals.filter(function (x) { return x.id !== g.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderMoneyPanel() {
    var monthPrefix = todayKey().slice(0, 7);
    var rows = state.transactions.filter(function (t) { return String(t.date).slice(0, 7) === monthPrefix; });
    var income = 0, expense = 0;
    rows.forEach(function (t) {
      if (t.type === "in") income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    });
    var html = '<div class="panel"><div class="section-head"><h2>本月記帳</h2>' +
      '<button class="btn sm" data-action="add-money">+ 記一筆</button></div>' +
      '<div class="grid-2"><div class="stat"><div class="label">收入</div><div class="value money-pos">' +
      fmtMoney(income) + '</div></div><div class="stat"><div class="label">支出</div><div class="value money-neg">' +
      fmtMoney(expense) + '</div></div></div>' +
      '<div class="stat" style="margin-top:10px"><div class="label">結餘</div><div class="value">' +
      fmtMoney(income - expense) + "</div></div>";
    html += '<div class="list" style="margin-top:12px">';
    if (!rows.length) html += '<div class="empty">本月未有紀錄</div>';
    else {
      rows.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).forEach(function (t) {
        html += '<div class="list-item"><div></div><div><strong>' + esc(t.category) +
          (t.note ? " · " + esc(t.note) : "") + '</strong><div class="muted">' + t.date +
          '</div></div><div style="display:flex;align-items:center;gap:8px">' +
          '<span class="' + (t.type === "in" ? "money-pos" : "money-neg") + '">' +
          (t.type === "in" ? "+" : "-") + fmtMoney(t.amount) +
          '</span><button class="btn sm ghost" data-edit-money="' + t.id + '">編輯</button></div></div>';
      });
    }
    html += "</div></div>";
    return html;
  }

  function openMoneyEditor(item) {
    var t = item || { id: "", type: "out", amount: 0, category: MONEY_CATS[0], note: "", date: todayKey() };
    openModal(
      "<h3>" + (t.id ? "編輯紀錄" : "記一筆") + "</h3>" +
      '<div class="field"><label>類型</label><select id="mType">' +
      opt("out", "支出", t.type) + opt("in", "收入", t.type) + "</select></div>" +
      '<div class="field"><label>金額</label><input id="mAmount" type="number" min="0" step="0.01" value="' + (t.amount || 0) + '" /></div>' +
      '<div class="field"><label>分類</label><select id="mCat">' +
      MONEY_CATS.map(function (c) { return opt(c, c, t.category); }).join("") + "</select></div>" +
      '<div class="field"><label>日期</label><input id="mDate" type="date" value="' + escAttr(t.date) + '" /></div>' +
      '<div class="field"><label>備註</label><input id="mNote" value="' + escAttr(t.note || "") + '" /></div>' +
      '<div class="row-actions"><button class="btn" id="mSave">儲存</button>' +
      (t.id ? '<button class="btn warn" id="mDel">刪除</button>' : "") +
      '<button class="btn ghost" id="mCancel">取消</button></div>'
    );
    document.getElementById("mCancel").onclick = closeModal;
    document.getElementById("mSave").onclick = function () {
      var amount = Number(document.getElementById("mAmount").value) || 0;
      if (amount <= 0) return toast("請輸入金額");
      var payload = {
        type: document.getElementById("mType").value,
        amount: amount,
        category: document.getElementById("mCat").value,
        date: document.getElementById("mDate").value || todayKey(),
        note: document.getElementById("mNote").value.trim()
      };
      if (t.id) {
        Object.assign(t, payload);
        touch(t);
      } else {
        state.transactions.push(touch(Object.assign({ id: uid() }, payload)));
      }
      saveState();
      closeModal();
      toast("已儲存");
      render();
    };
    if (t.id) {
      document.getElementById("mDel").onclick = function () {
        state.transactions = state.transactions.filter(function (x) { return x.id !== t.id; });
        saveState();
        closeModal();
        toast("已刪除");
        render();
      };
    }
  }

  function renderThemePanel() {
    var cur = state.settings.theme || "sunshine";
    var themes = [
      { id: "sunshine", name: "Sunshine", grad: "linear-gradient(135deg,#FFE8C8,#F4A261,#2A9D8F)" },
      { id: "sea", name: "Blue Sea", grad: "linear-gradient(135deg,#B8E4E8,#1D8A99,#0E5F6B)" },
      { id: "fire", name: "Warm Fire", grad: "linear-gradient(135deg,#FFD2B8,#E76F51,#F4A261)" },
      { id: "photo", name: "自訂相片", grad: state.settings.photoDataUrl ? "url(" + state.settings.photoDataUrl + ") center/cover" : "linear-gradient(135deg,#ddd,#bbb)" }
    ];
    var html = '<div class="panel"><div class="section-head"><h2>主題</h2></div><div class="theme-grid">';
    themes.forEach(function (th) {
      html += '<button type="button" class="theme-card' + (cur === th.id ? " on" : "") + '" data-theme-pick="' + th.id + '">' +
        '<div class="preview" style="background:' + th.grad + '"></div><strong>' + esc(th.name) + '</strong></button>';
    });
    html += '</div>';
    html += '<div class="field" style="margin-top:14px"><label>上傳相片（自訂主題）</label>' +
      '<input type="file" id="photoUpload" accept="image/*" /></div>';
    if (state.settings.palette && state.settings.palette.length) {
      html += '<div class="field"><label>抽取色板（可用於習慣顏色）</label><div class="swatches">';
      state.settings.palette.forEach(function (c) {
        html += '<span class="swatch" style="background:' + c + '"></span>';
      });
      html += "</div></div>";
    }
    html += "</div>";
    return html;
  }

  function renderSyncPanel() {
    var html = '<div class="panel"><div class="section-head"><h2>備份與同步</h2></div>' +
      '<p class="muted">本機資料儲存於瀏覽器。可匯出 JSON 備份，或使用 Google Apps Script 雲端同步（Last-Write-Wins）。</p>' +
      '<div class="field"><label>Apps Script URL</label><input id="cloudUrl" value="' + escAttr(state.settings.cloudUrl || "") + '" placeholder="https://script.google.com/macros/s/..." /></div>' +
      '<div class="field"><label>Token</label><input id="cloudToken" type="password" value="' + escAttr(state.settings.cloudToken || "") + '" placeholder="SOLARA_TOKEN" /></div>' +
      '<div class="row-actions">' +
      '<button class="btn" data-sync="pull">從雲端拉取</button>' +
      '<button class="btn soft" data-sync="push">推送到雲端</button>' +
      '</div><div class="row-actions">' +
      '<button class="btn ghost" data-sync="export">匯出 JSON</button>' +
      '<button class="btn ghost" data-sync="import">匯入 JSON</button>' +
      '</div>';
    if (state.syncUpdatedAt) {
      html += '<p class="tiny">上次同步：' + new Date(state.syncUpdatedAt).toLocaleString("zh-HK") + "</p>";
    }
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
    ui.view = "more";
    ui.moreTab = tab;
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.getAttribute("data-view") === "more");
    });
    document.querySelectorAll("#nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === "more");
    });
    renderMore();
  }

  function setView(name) {
    ui.view = name;
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.getAttribute("data-view") === name);
    });
    document.querySelectorAll("#nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === name);
    });
    render();
  }

  function render() {
    applyTheme();
    renderTopChips();
    if (ui.view === "today") renderToday();
    else if (ui.view === "habits") renderHabits();
    else if (ui.view === "calendar") renderCalendar();
    else if (ui.view === "more") {
      renderMore();
    }
  }

  document.getElementById("nav").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-nav]");
    if (!btn) return;
    setView(btn.getAttribute("data-nav"));
  });

  document.getElementById("app").addEventListener("click", function (e) {
    var t = e.target;

    var navMore = t.closest("[data-more]");
    if (navMore) {
      ui.moreTab = navMore.getAttribute("data-more");
      renderMore();
      return;
    }

    var go = t.closest("[data-go]");
    if (go) {
      goMoreTab(go.getAttribute("data-go"));
      if (go.getAttribute("data-go") === "money") setTimeout(function () { openMoneyEditor(); }, 50);
      return;
    }

    var toggle = t.closest("[data-toggle]");
    if (toggle) {
      toggleHabit(toggle.getAttribute("data-toggle"));
      return;
    }

    var action = t.closest("[data-action]");
    if (action) {
      var act = action.getAttribute("data-action");
      if (act === "add-habit") openHabitEditor();
      else if (act === "add-block") openBlockEditor();
      else if (act === "add-countdown") openCountdownEditor();
      else if (act === "add-goal-short") openGoalEditor("short");
      else if (act === "add-goal-long") openGoalEditor("long");
      else if (act === "add-money") openMoneyEditor();
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
      if (goal) {
        goal.current = Number(goal.current) + 1;
        touch(goal);
        saveState();
        render();
      }
      return;
    }

    var editMoney = t.closest("[data-edit-money]");
    if (editMoney) {
      var tx = state.transactions.find(function (x) { return x.id === editMoney.getAttribute("data-edit-money"); });
      if (tx) openMoneyEditor(tx);
      return;
    }

    var dayBtn = t.closest("[data-day]");
    if (dayBtn) {
      ui.calSelected = dayBtn.getAttribute("data-day");
      renderCalendar();
      return;
    }

    var calNav = t.closest("[data-cal]");
    if (calNav) {
      ui.calMonth = addMonths(ui.calMonth, calNav.getAttribute("data-cal") === "prev" ? -1 : 1);
      renderCalendar();
      return;
    }

    var themePick = t.closest("[data-theme-pick]");
    if (themePick) {
      state.settings.theme = themePick.getAttribute("data-theme-pick");
      saveState();
      applyTheme();
      renderMore();
      toast("主題已切換");
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
      return;
    }
  });

  document.getElementById("app").addEventListener("change", function (e) {
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
          renderMore();
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

  applyTheme();
  render();
})();
