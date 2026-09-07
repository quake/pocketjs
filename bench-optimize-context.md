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
- Lesson: micro-deallocation of tiny temporaries is invisible against the
  taffy rebuild itself; candidates must attack the rebuild's actual work
  (tree clear + full node/style re-creation + re-measure), not the wrappers.

## Ideas Backlog

1. **Incremental taffy sync for structure-dirty relayouts** — reuse the live
   taffy tree: map surviving slots to existing NodeIds, attach/detach only
   changed subtrees instead of `clear()` + full rebuild. Largest expected win
   (churn rounds rebuild ~100 nodes for 4-node changes); highest complexity
   (ownership, `text_native` record, excluded empty runs, primary/aux roots).
2. **TaffyTree capacity reuse / node pool** — check whether `taffy.clear()`
   releases node storage; if so, replace with capacity-preserving reset or
   `TaffyTree::with_capacity` reuse. Moderate win, low risk.
3. **Cache `to_taffy` conversions** — rebuild re-resolves and re-maps styles
   for every node; cache per-slot taffy::Style keyed by resolved-style
   revision. Moderate.
4. **Avoid re-shaping unchanged text on rebuild** — `MeasureCtx::shaped`
   re-shapes every text leaf each rebuild even when run text/font unchanged;
   reuse the previous measured size keyed by (run, slot, tracking,
   line_height, native). Text shaping was flagged as the expensive half of
   layout on PSP.
5. **Pre-size `kids`/collection vectors** — likely noise (see What Doesn't
   Work); only as byproduct of other changes.

## Approach Categories Tried

| Category | Attempts | Kept | Last Tried |
|----------|----------|------|------------|
| scratch-reuse (small Vecs/Strings) | 4 | 0 | 2026-09-06 |
| 3D/unmeasurable | 1 | 0 | 2026-09-06 |
| profiling instrumentation | 2 | kept (diagnostic) | 2026-09-07 |
