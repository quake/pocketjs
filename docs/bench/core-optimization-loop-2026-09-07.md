# Core Optimization Loop Record — 2026-09-07

Branch `bench-optimize/sep07` (fork-planned view of the `bench/taffy-candidates`
profiling work). This file is the human-readable index of every optimization
attempt made during the bench-optimize loop; raw experiment log lives in
(untracked) `results.tsv`, full knowledge base in `bench-optimize-context.md`,
formal receipts under `docs/bench/`, and the profiling method specs/plans under
`docs/superpowers/`.

## Acceptance rules (user-pinned)

- Metric: PSP stats workload `avg_work_us` or `avg_render_us` improved by
  **at least 3%** (`bun tools/bench-ppsspp.ts --apps=stats --samples=3
  --memory-scan`), vs baseline `avg_work_us=4682` / `avg_render_us=581`.
- DrawList checksum must stay bit-exact (`c88e7bcedc5d42a5`); no arena/safe
  arena regression; production scope `engine/core` only; minimal architectural
  change per user policy.

## Loop outcome

**No timing candidate was kept.** One codegen-neutral simplification was kept
(full PSP A/B/A identity, no performance claim). Nine experiments, all
checksum-exact and verified on PPSSPP headless.

| # | Candidate | Desktop screen | PSP verdict | Result |
|---|-----------|----------------|-------------|--------|
| 1 | Layout readback slot scratch | — | +0.064% work | discarded (era 1 receipt) |
| 2 | Layout text-run scratch | — | +0%, +32B arena | discarded |
| 3 | Draw text-run scratch | — | +0.256% | discarded |
| 4 | Structure-dirty `surface_slots` + text scratch | — | +0.021%, +32B arena | discarded |
| 5 | 3D collection scratch | — | unmeasurable (`motions` app absent) | rejected without code |
| 6 | Incremental taffy sync (`7cece37`) | structural 160→17µs/tick (−89%) | +2.48% (below 3%), max_work −18.6%, checksum-exact | discarded: below gate + user rejected complexity |
| 7 | Text glyph placement cache (`b30ea9e`) | mixed-variant draw −35-38% | avg_draw unchanged (2810→2811), avg_tick +173µs | discarded: PSP regression |
| 8 | Const-block `Resolved::default` | Δ≈0 | 4682→5378 (+14.9%), draw +670, tick +135 | discarded: MIPS codegen regression, sd=0 |
| 9 | `resolve_z` parse-time z precompute | — | 4682→4674 (+0.17%) | discarded: below gate + added complexity |
| 10 | Paint-order fast-path iteration rewrite | — | 4682/4682/4682 identical | **kept as simplification only** (`1e4614c`) |
| 11 | Translation-only fast path in per-glyph emission | — | 4684/4682/4684 (0%) | discarded |

## Key measured facts

- PSP stats per-frame work structure: draw walk 61.5% (2810µs), tick 8.4%
  (385µs), guest JS 17.2% — layout is a small share, so every layout-side
  candidate has a ≈8% ceiling on this workload.
- Desktop (x86) screens are structurally blind to MIPS codegen effects; both
  the const-default regression (-15%) and the placement-cache failure were
  invisible or inverted on desktop. Only the PSP run adjudicates.
- Every rejected experiment is documented with a canonical receipt and
  `tests/core-frame-receipts.test.ts` coverage; instrumentation (stage +
  differential profiling matrix) is retained in `membench` with its parser
  tests.

## Profiling evidence (why candidates were chosen)

`membench` differential matrix (5 controlled variants, release mode):
structural taffy rebuild ~160-228µs/tick vs text updates ~570-670 vs
style-only ~1µs; draw construction ~290-385µs/draw desktop. PSP side: tick 385
/ draw 2810 split from the raw reports drove the paint-walk experiments
(#7-#10).

## Post-archive continuation (2026-09-07)

Two further emission-tier codegen rounds on PSP (A/B/A, sd=0 each):
- translation-only fast path in per-glyph affine: 4684/4682/4684 — zero.
- glyph-pair `extend_from_slice`: 4771/4682/4771 — +1.9% regression (two inlined
  pushes beat the extend call).
The constrained candidate space is now exhausted twice over; every mechanism-
motivated micro inside engine/core-only + minimal-architecture is measured
negative, neutral, or below the 3% gate (~12 PSP-verified experiments total).
