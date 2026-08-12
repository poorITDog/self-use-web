# Plan: Solara 待辦（Tasks）— v1

**Status:** planning only — no implementation until Features / Bug / UX / UI all score this plan **> 95** (strict, no allowance).

**Plan revision:** R1 — incorporated [UI plan](bc-dc2dd16f-ad75-50ea-a9a5-592908f2afc4) required edits (was 78).

## Problem

Solara has **habits** (recurring) and **goals** (progress). Users still need **one-off to-do tasks** that can be checked off without polluting habit streaks or goal targets.

## Non-goals (v1 — YAGNI)

- No projects / folders / tags / subtasks / priority ranks / recurring tasks
- No habit↔task auto-link, no calendar event auto-create from tasks
- No drag-reorder persistence beyond simple list order (optional `sort` later)
- No separate cloud API — must use existing Drive snapshot sync
- No stats strip / filters / priority UI on the first viewport

## Product rules

| Concept | Role |
|---------|------|
| 習慣 | Recurring schedule + streak |
| 目標 | Cumulative progress / achievements |
| **待辦** | One-off checklist items |

Copy must never call tasks「習慣」or「目標」.

## Data model

```js
task: {
  id, title,          // required title (trim, non-empty)
  done: boolean,      // default false
  due: "" | "YYYY-MM-DD",  // optional; calendar date only (local dateKey)
  note: "",           // optional; shown in editor, not on list row in v1
  createdAt, updatedAt,
  finishedAt: 0       // set when done becomes true; clear when undone
}
```

- State: `state.tasks = []`
- `normalizeState` fills `tasks: []`, clamps `done` boolean, trims title, validates `due` as `""` or `YYYY-MM-DD`
- `syncContentWeight` includes `tasks.length`
- `mergeSyncState`: `mergeEntityLists` by `id` + `applyTombstones`
- **Delete** → `markTombstone(id)` then remove (same lesson as check-in undo)
- **Toggle done** → keep the entity, bump `updatedAt` / `finishedAt` (LWW update, not delete)

## Information architecture

- New view: `#view-tasks` + bottom nav **待辦** inserted between 習慣 and 日曆
- **Exact 6-tab order & labels:** `習慣 | 待辦 | 日曆 | 倒數 | 專注 | 設定`
- Nav treatment: keep existing icon size (~22–24px); labels `font-size` ~10–11px, single line, `overflow: hidden; text-overflow: clip` — no wrap on 360px
- Do not remove existing tabs
- Quick-add sheet: add **待辦** entry (opens task editor)

### App bar (hard rule)

- Title「待辦」+ **one** soft `+` only (mirror countdown)
- No sync chip / ring / extra action cluster on this view
- When list empty: body empty CTA「+ 新增待辦」OK; when populated: **app-bar + only** (no competing FAB)

### FAB (hard rule)

- On `#view-tasks`, FAB is **`hidden`** (same CSS `[hidden]` fix as habits)
- Sole add CTAs: app-bar soft `+` (always on tasks view) + empty-state body button when `tasks.length === 0`
- Quick-add may still create 待辦 from other views; that does not unhide FAB on tasks

## UX (first viewport)

- One composition: **open (未完成) list only** as the hero stack — no stats, filters, or promos
- **已完成:** shown **muted below**, expanded by default but visually demoted (opacity / strikethrough); not a second competing module
- Row: checkbox + title + optional due **meta text** (not a chip/pill/badge)
- Tap checkbox **or** row body toggles done; long-press not required
- Tap a small edit affordance OR open editor via title long-press — **v1: row tap = toggle; app-bar / empty `+` / quick-add opens editor; edit existing via a quiet「編輯」in a confirm…**  
  **Lock for v1:** checkbox toggles; tapping **title** opens editor modal (so due/note/delete reachable without cluttering the row)
- Empty:「還沒有待辦」+ supporting「一次性任務，唔影響習慣連續」+ CTA「+ 新增待辦」
- Due today / overdue: quiet Figtree meta, terracotta tint only when overdue or due today — **ban chips/pills/badges**
- Editor modal: title (required), due (optional date), note (optional), delete (tombstone + confirm)

### Motion (2–3, quiet)

1. Checkbox settle (scale/opacity ~150ms)
2. Done row fades/moves into 已完成 section
3. 已完成 section no accordion animation required in v1 (always visible muted)

## Visual / Organic (row contract)

Reuse **habit-checkin** tokens explicitly:

| Token | Value |
|-------|--------|
| Surface | sand / `--color-neutral-100` |
| Radius | 20px |
| Check | terracotta accent filled when on |
| Padding / min-height | match `.habit-checkin-row` |
| Done row | muted + light strikethrough on title |
| Chrome | **no** card wrapper shadow pile, **no** glow, **no** purple |

### Typography (locked)

| Role | Font |
|------|------|
| App-bar「待辦」, section「未完成／已完成」 | Caprasimo |
| Row title, due meta, empty body, modal fields | Figtree (+ Noto Sans TC as existing CJK fallback) |
| No new font families | — |

## Sync & multi-device

- Toggle done stays via LWW `updatedAt` (no tombstone)
- Delete uses tombstone (must not resurrect)
- After remote merge, if open-task signature changes, toast「已從另一部裝置更新待辦」(mirror check-in toast)

## Tests (required)

1. `normalizeState` fills `tasks` + clamps fields
2. merge union keeps tasks from both devices
3. delete tombstone blocks resurrect
4. toggle done LWW: newer `updatedAt` wins
5. e2e: nav 待辦 → add → appears → toggle done → in 已完成 → edit due → delete gone; FAB hidden on tasks; no `.habits-seg` regression

## Acceptance (definition of done)

1. User can add / toggle / edit due / delete tasks on ~390px viewport
2. Tasks sync via existing Drive path without empty overwrite
3. Undone/deleted tasks do not resurrect after sync
4. Nav + quick-add discoverable; habits/goals unchanged
5. FAB hidden on tasks; single add CTA policy held
6. All four post-implementation reviews **> 95**

## Implementation order

1. Data + merge + tombstone in `solara-core.mjs` / `solara.js`
2. `#view-tasks` + nav + `renderTasks` + modal
3. CSS Organic rows + typography + FAB hide
4. Quick-add + tests + README one-liner

## Risks

| Risk | Mitigation |
|------|------------|
| Nav crowding (6 items) | Fixed label set + compact single-line nav CSS |
| Dual add CTAs | FAB hard-hidden on tasks |
| Chip/badge drift | Due = meta text only |
| Confusion with goals | Empty supporting sentence |
| Sync resurrect on delete | Tombstone from day one |
| Scope creep | Non-goals list binding for v1 |
