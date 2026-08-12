# Plan: Solara 待辦（Tasks）— v1

**Status:** planning only — no implementation until Features / Bug / UX / UI all score this plan **> 95** (strict, no allowance).

**Plan revision:** R2.3 — Bug blockers (drop empty id, dual-path tests / shared core, exact toast predicate, openTasksSig test) + R2.2 UX.

## Problem

Solara has **habits** (recurring) and **goals** (progress). Users still need **one-off to-do tasks** that can be checked off without polluting habit streaks or goal targets.

## Non-goals (v1 — YAGNI)

- No projects / folders / tags / subtasks / priority ranks / recurring tasks
- No habit↔task auto-link, no calendar event auto-create from tasks
- No drag-reorder UI / persisted manual `sort` (order is deterministic — see below)
- No separate cloud API — existing Drive snapshot only
- No stats / filters / priority UI on the first viewport
- **Habits today / board / goals UI unchanged** — zero task rows, counts, or CTAs on 習慣

## Product rules

| Concept | Role |
|---------|------|
| 習慣 | Recurring schedule + streak |
| 目標 | Cumulative progress / achievements |
| **待辦** | One-off checklist items |

Copy must never call tasks「習慣」or「目標」.

**Invariant (binding):** Task add / edit / toggle / delete **must not** write `habits`, `goals`, `checkins`, or streak fields. Enforced in acceptance + tests.

## Data model

```js
task: {
  id, title,              // trim; blank title rejected on save; sync drops empty title
  done: boolean,          // !!done
  due: "" | "YYYY-MM-DD", // else coerced to ""
  note: "",               // optional; editor only in v1 list
  createdAt, updatedAt,   // numbers; every mutate bumps updatedAt via touch()
  finishedAt: null | number  // null when !done; set Date.now() on done→true
}
```

### `normalizeTask` (binding)

1. `id = String(id || "").trim()`; if `!id` → **drop** row (same as empty title)
2. `title = trim(title)`; if empty after trim → drop
3. `done = !!done`
4. `due` only `""` or `/^\d{4}-\d{2}-\d{2}$/`, else `""`
5. `note = String(note || "")`
6. `createdAt = Number(createdAt) || Number(updatedAt) || 0`
7. `updatedAt = Number(updatedAt) || createdAt`
8. `finishedAt`: prefer `null` (align goals). If `done && !finishedAt` → `finishedAt = updatedAt || createdAt || Date.now()`. If `!done` → `finishedAt = null`

### State / sync wire-up (both `solara.js` + `solara-core.mjs`)

- `defaultState().tasks = []`
- `normalizeState`: `out.tasks = (data.tasks||[]).map(normalizeTask).filter(t => t.title)`
- `syncContentWeight`: `+= tasks.length`
- Snapshot save/load already whole-state JSON — `tasks` rides `solara-v1` / Drive payload with no special channel
- `mergeSyncState`:
  ```js
  merged.tasks = applyTombstones(
    mergeEntityLists(local.tasks, remote.tasks, (x) => x.id),
    merged.tombstones
  );
  ```
- Same merge in **both** implementations

### Conflict matrix (binding)

| Action | Behavior |
|--------|----------|
| **Toggle / edit** | Keep same `id`; always `touch()` (`updatedAt`). Done→true: `finishedAt = Date.now()`. Undo: `done=false`, `finishedAt=null`. **Never** tombstone on toggle/edit |
| **Delete** | `markTombstone(id)` then remove from `tasks` |
| **Resurrect rule** | Same as check-ins: entity returns only if `updatedAt > tombstoneAt` (`applyTombstones`). Acceptance wording: deleted ids stay absent after merge when remote copy is **older than** tombstone — not “absolute never-return if user recreates” |

Whole-entity LWW: concurrent title edit + toggle → newer `updatedAt` wins **entire** row (document in sync README one-liner).

### Empty-overwrite / weight (binding + tests)

- Tasks-only local (`tasks.length > 0`, other weights 0) → still `syncContentWeight > 0` → push when remote empty
- Empty local + remote tasks → fast-forward
- Never push empty over non-empty remote without tombs
- Delete-last-task: weight 0 + tombstone → `shouldPushAfterMerge` still true (existing helper)

### Due / timezone

- Overdue / today = **string compare** `due` vs `todayKey()` (local calendar)
- Never `toISOString().slice(0,10)` for due comparisons

## Information architecture

### Nav @390 (binding)

- Order: `習慣 · 待辦 · 日曆 · 倒數 · 專注 · 設定`
- `#nav`: `grid-template-columns: repeat(6, 1fr)`
- Labels stay short (待辦 = 2 chars); icon ~20–22px; label ≤9.5–11px; single line; min tap ≥44×44; no horizontal scroll-nav
- New `#view-tasks`

### Add path (ONE primary on tasks view)

- App-bar: title「待辦」+ **one** soft `+` only
- FAB **`hidden`** on `#view-tasks` (and stays hidden on habits)
- Empty body CTA「+ 新增待辦」only when zero tasks
- Quick-add sheet: **待辦** with small「一次性清單」; creates title-focused editor (same modal)

### App bar

- Title「待辦」+ **one** soft `+` only
- Soft `+` control lock (mirror countdown app-bar): ghost ink / terracotta icon button — **no** pill fill, **no** glow, **no** badge count
- No sync chip / ring on tasks view
- Populated list → app-bar `+` only; empty → body CTA + app-bar `+` OK (same `openTaskEditor` action)

### Row interaction (binding — no alternate bullets)

- **Checkbox** hit target ≥44×44 (plus left hit pad) → toggle done **only**
- **Title + due meta** → open editor modal (due / note / rename / delete)
- **No** whole-row toggle; no long-press; no inline「編輯」confirm affordance

## UX (first viewport) — locked

- Composition: app-bar「待辦」+ list only — **no** stats, goals strip, week strip, badges, cards
- **Section chrome (binding):** **never** render on-screen「未完成」heading in v1 — open list is unlabeled under the app-bar. Only completed chrome is「已完成 (N)」when `N > 0` (collapsed by default, `aria-expanded`).「未完成」may exist as an internal sort bucket name only — **not** visible copy
- **已完成 control:** if `completedCount === 0`, render **no** 已完成 chrome. If `completedCount > 0`, collapsed by default; label always「已完成 (N)」; expands muted strikethrough list in place
- Row: checkbox + title + optional due **meta text** only — **no** streak / time-group / goal badge / chips / pills
- Interaction: see **Row interaction** above
- Distinction empty line:「一次性事項，打勾即完成——不計連續、不佔目標。」

### Empty matrix

| State | UI |
|-------|-----|
| No tasks |「還沒有待辦」+ distinction line +「+ 新增待辦」；no 已完成 chrome |
| All done |「未完成都清空了」+ collapsed「已完成 (N)」(`N > 0`) |
| Mixed | open list (no dead 已完成 (0)) + collapsed「已完成 (N)」 |
| Open only | open list only；**no**「已完成 (0)」 |

Organic compact empty — no illustration stack.

### Motion (exactly 3)

1. View-in on open tasks
2. `checkPulse` on toggle
3. Completed row fade into collapsed 已完成 count

### Copy deck (zh-HK)

- 待辦 / 新增待辦 / 還沒有待辦 / 已完成 (N) / 標題 / 到期日 / 備註 / 刪除待辦 / 確定刪除此待辦？ / 今天 / 已過期 / 一次性清單 / 一次性事項，打勾即完成——不計連續、不佔目標。 / 未完成都清空了 / 已從另一部裝置更新待辦
- **Visible deck excludes**「未完成」and「顯示已完成」— open bucket is unlabeled; completed control is「已完成 (N)」only
- aria:「新增待辦」「標記完成」「標記未完成」「編輯待辦」「已完成，已收合／已展開」

### List order (deterministic)

- **未完成:** `due` ascending (`""` last), then `createdAt` ascending
- **已完成:** `finishedAt` descending (missing → `updatedAt`)

## Visual / Organic (row contract)

| Token | Value |
|-------|--------|
| Surface | sand / `--color-neutral-100` |
| Radius | 20px |
| Check | terracotta when on |
| Padding / min-height | match `.habit-checkin-row` |
| Done | muted + light strikethrough |
| Ban | card shadow piles, glow, purple, due chips |

### Typography

| Role | Font |
|------|------|
| App-bar「待辦」, section heads | Caprasimo |
| Row title, due meta, empty, modal | Figtree (+ existing Noto Sans TC) |

## Sync toast

- `openTasksSig(s)` = sorted ids of `!done` tasks joined by `|`
- Exact mirror of check-in toast predicate:
  ```js
  if (fromEmpty && (result.winner === "remote" || result.winner === "merged")) {
    toast("已從雲端還原資料");
  } else if (result.action === "merge" && openTasksSig(prev) !== openTasksSig(state)) {
    toast("已從另一部裝置更新待辦");
  }
  ```
- Keep fromEmpty「雲端還原」separate; do not fire both for the same restore

## Tests (required)

1. `normalizeTask` / `normalizeState`: missing/`""` id dropped; empty title dropped; bad due → `""`; done↔finishedAt; createdAt/updatedAt fallbacks
2. Merge union / tombstone / empty-overwrite / `syncContentWeight` including tasks — must pass against **both** `solara-core.mjs` and the `solara.js` merge path (or mandate one shared export used by both — prefer shared `solara-core.mjs` helpers called from `solara.js` for tasks merge/normalize to prevent drift)
3. Delete tombstone blocks **older** remote; newer post-tombstone recreate wins if `updatedAt > tomb`
4. Toggle done LWW + uncomplete LWW + rename + clear due
5. Tasks-only local pushes to empty remote; delete-last + tomb pushes; never empty-clobber
6. Task CRUD does **not** mutate habits/goals/checkins
7. `openTasksSig`: remote add/complete/delete of open tasks changes sig; rename-only does **not**
8. e2e @390: nav 待辦 → add → rename → set/clear due → toggle done → uncomplete → delete; FAB hidden; habits today has no task UI

## Acceptance (definition of done)

1. CRUD: **add / rename title / set·clear due / edit note / complete / uncomplete / delete**; empty title rejected
2. Sync: tasks in snapshot; merge+tombstones wired both files; empty-overwrite guards hold
3. Deleted older remote copies do not resurrect (`updatedAt ≤ tombstoneAt`)
4. Toggle/edit never tombstones; uncomplete is LWW field update
5. Nav + single add path + quick-add; habits/goals UI unchanged; invariant held
6. Visual @390×844: 6 labels readable, no dual FAB, overdue = quiet terracotta text
7. All four **post-implementation** reviews **> 95**

## Implementation order

1. `normalizeTask` + merge/weight/tombstone in core + solara.js
2. `#view-tasks` + nav CSS + `renderTasks` + modal + copy
3. Organic CSS + FAB hide + 3 motions
4. Quick-add + tests + README one-liner

## Risks

| Risk | Mitigation |
|------|------------|
| Nav crowding | 6-col grid + short labels + tap targets |
| Dual CTA | FAB hard-hidden on tasks |
| Tombstone-on-undo mistake | Conflict matrix + tests |
| Goals confusion | Distinction copy + habits lean clause |
| Scope creep | Non-goals binding |
