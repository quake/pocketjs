# Core Frame Optimization Candidates Design

## Goal

Continue the core-only optimization search under the existing benchmark
constraints until no reasonable low-risk candidate remains. Retain a
production candidate only when the matching PPSSPP workload improves
`avg_work_us` or `avg_render_us` by at least **3%**, preserves the drawlist
checksum, and does not materially regress arena usage or correctness.

## Existing Constraints

- Production changes are limited to `engine/core`.
- Do not modify `hosts/psp`, other host renderers, DrawList formats, public APIs,
  or device-specific behavior.
- Evaluate each candidate independently against the committed stats baseline.
- Use three benchmark samples with memory scan:
  `bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan`.
- Revert every candidate that misses the timing or guardrail thresholds and
  record its result in a canonical receipt.
- Do not claim a performance result for a workload that the benchmark registry
  cannot run. The `motions` workload remains unavailable.

## Candidate 1: Draw Text-Run Scratch

`draw.rs::emit_text` currently creates a new `String` for every painted text
node. Add a private scratch buffer to `Walker` and reuse it for collecting a
run within a draw walk. The implementation must keep the run valid until the
native or baked text path has consumed it. It must not return borrowed scratch
to code that stores it, cross recursive calls unsafely, or add a public API.

The candidate must preserve native and baked text output, provider-staleness
detection, clipping, glyph ordering, and drawlist checksums. A focused test
must compare text output and checksum across repeated draws before any
production implementation is retained.

## Candidate 2: 3D Collection Scratch Review

Inspect `collect_3d` and its `items`/`tex_cells` ownership for safe per-frame
capacity reuse. Only implement a candidate if the scratch can be owned by the
existing draw state without changing the DrawList format, ordering, or public
API. Because no active 3D benchmark workload exists, a 3D candidate may be
tested for correctness and allocation behavior but cannot be retained as a
qualified performance improvement without a reproducible workload. If the
ownership or measurement path is insufficient, record a rejection receipt.

## Candidate 3: Layout Rebuild Scratch Review

Inspect the remaining structure-dirty allocations, such as `surface_slots` and
recursive child collection. Consider reuse only when ownership remains explicit
through recursive `build` calls and Taffy contexts. Do not add unsafe aliasing,
global pools, or public APIs. Measure against the same stats baseline if a safe
candidate exists; otherwise record the rejection and leave production code
unchanged.

## Measurement and Decisions

For each candidate:

1. Add a focused failing equivalence test and observe the expected red result.
2. Implement the smallest safe change, then run focused and full core tests.
3. Run the exact three-sample stats benchmark with memory scan.
4. Compare average work/render time, maximum work, arena high-water, safe arena,
   checksums, and correctness against
   `docs/bench/core-layout-scratch-baseline-2026-09-06.json`.
5. Keep only a candidate meeting the 3% timing threshold and all guardrails.
   Revert otherwise.
6. Record every measured or rejected candidate in the canonical receipt schema,
   including provenance, per-sample data, memory-scan evidence, threshold math,
   candidate files, and the final decision. Add invariant tests in
   `tests/core-frame-receipts.test.ts`.

## Non-Goals

- No optimization retained solely because it reduces allocations while missing
  the 3% frame timing threshold.
- No substitute workload used for the unavailable 3D benchmark.
- No broad refactor or architecture change.
- No host renderer or DrawList protocol optimization.
