# Benchmark Optimization Context

## Project Understanding

PocketJS is a no-GC embedded UI runtime. The optimization target is the
PSP (`engine/core` frame work time) measured by the PPSSPP headless
benchmark; the iteration benchmark is the desktop `membench` example in
release mode. Profiling (2026-09-06/07) identified the **structural
taffy-tree rebuild path** as the dominant per-event cost:

- `structure_no_text` variant: ~228us/tick release (~2700us debug), 8 churn
  ticks, ~242KB allocated per tick.
- Text updates second (~660us/tick debug), style-only ~free, draw ~290-385us/draw.

## Architecture Notes

- `engine/core/src/layout.rs`: `LayoutEngine` owns one `TaffyTree<MeasureCtx>`.
  STRUCTURE dirt **rebuilds the taffy tree from scratch** every relayout
  (documented v1 strategy, `relayout_root`), even though relayouts are
  triggered by insert/destroy churn. STYLE dirt restyles incrementally.
- `build()` recursion: per node it resolves style (`style::resolve`), maps to
  `taffy::Style` via `to_taffy()`, allocates a `kids: Vec<NodeId>` per
  container, and per text leaf collects a run `String` + shapes via
  `MeasureCtx::shaped`.
- `relayout_root` rebuild path: `taffy.clear()` + collect `surface_slots`
  Vec + recursive `build()` + `compute()` + `readback()` (collect_subtree Vec).
- PSP acceptance benchmark: `bun tools/bench-ppsspp.ts --apps=stats
  --samples=3 --memory-scan`; baseline `avg_work_us=4682`, `avg_render_us=581`,
  checksum `c88e7bcedc5d42a5`. Keep requires >=3% work or render improvement,
  unchanged checksum, no arena/safe-arena regression, receipt + integrity tests.

## Scope and Constraints

- Production changes are limited to `engine/core`.
- PSP 3% gate (avg_work_us or avg_render_us, checksum-exact, no arena
  regression) is the final acceptance for any retained candidate.
- **User policy (2026-09-07): candidates must minimize architectural change.**
  Single-function/single-file, low-blast-radius changes only. The incremental
  taffy sync (89% membench win, checksum-exact, PSP 2.48%) was discarded
  because it rewired the relayout lifecycle plus five call sites — too complex
  despite passing every automatic gate.

## What Works

- Stage/matrix profiling in `membench` (5 variants, release mode ~2s/run,
  deterministic allocation/checksum fields) reliably ranks workload paths.
- Style-dirty incremental restyle path is already cheap (~1us/tick).

## What Doesn't Work (all PSP-verified, all reverted with receipts)

- Scratch reuse of small per-frame Vecs: layout readback slots (+0.064%),
  layout text-run String (+0%, +32B arena), draw text-run scratch (+0.256%),
  structure-dirty `surface_slots` + text scratch (+0.021%, +32B arena).
  Allocation-count reduction alone never moved PSP work time.
- 3D collection scratch: unmeasurable (`motions` workload absent from runner
  registry), rejected without production code.
- Incremental taffy sync (commit 7cece37, reverted 2026-09-07): technically
  successful — checksum-exact, membench structural 160→17us/tick (median-of-3),
  PSP avg_work 4682→4566 (2.48%), max_work −18.6%, arena +5.5KB. Discarded:
  PSP below the 3% gate AND user rejected the blast radius (relayout lifecycle
  rewrite + lib.rs hooks in destroy/insert/remove/set_text + asset hooks).
  Lesson: the mechanism is proven but any retry is banned by the
  minimal-architecture policy; do not re-propose it in this form.
- Lesson: micro-deallocation of tiny temporaries is invisible against the
  taffy rebuild itself; candidates must attack the rebuild's actual work
  (tree clear + full node/style re-creation + re-measure), not the wrappers.

## Ideas Backlog (small-blast-radius only, per user policy)

1. **Skip duplicate text shaping** — measure_ctx/restyle re-shapes a text run
   even when (run bytes, font slot, tracking, line_height, native) are
   unchanged; memoize the last shaped input inside the text leaf's layout
   state. Touches `layout.rs` (MeasureCtx) only. Text shaping is flagged as
   the expensive half of layout on the PSP.
2. **Fast-path unchanged style resolution** — style::resolve runs per node per
   relayout AND per node per draw walk; check whether the draw walk (not
   layout) dominates PSP work before building any cache. Investigate first
   with a differential: if draw-period cost dominates stats' avg_work_us,
   resolve caching pays; else drop.
3. **Taffy capacity reuse** — verify whether taffy 0.11 `clear()` retains
   storage capacity (slotmap clear likely does); if yes this is a no-op — skip.
4. Pre-sized scratch vectors — proven noise; only as byproducts.

## Approach Categories Tried

| Category | Attempts | Kept | Last Tried |
|----------|----------|------|------------|
| scratch-reuse (small Vecs/Strings) | 4 | 0 | 2026-09-06 |
| 3D/unmeasurable | 1 | 0 | 2026-09-06 |
| profiling instrumentation | 2 | kept (diagnostic) | 2026-09-07 |
