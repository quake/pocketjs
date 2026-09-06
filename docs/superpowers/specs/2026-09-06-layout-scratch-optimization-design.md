# Layout Scratch Optimization Design

## Goal

Evaluate two small `engine/core` allocation reductions for layout-heavy frames:

- reuse the slot buffer used by layout readback;
- reuse the temporary text-run buffer used while building or restyling text
  measure leaves.

Retain a candidate only when the matching PSP workload improves
`avg_work_us` or `avg_render_us` by at least **3%**, with unchanged drawlist
checksum and no material arena or correctness regression.

## Scope

Production changes are limited to `engine/core`. No PSP renderer, other host,
DrawList format, public API, or benchmark host-specific behavior changes are
allowed. Each candidate is measured independently and reverted before the next
candidate.

## Candidate 1: Reuse Readback Slots

`layout::readback` currently allocates a fresh `Vec` for every relayout, fills it
with the subtree slots, then iterates it. Add a `readback_slots: Vec<u32>` field
to `LayoutEngine` and pass it into readback by ownership:

1. take the field and clear it;
2. collect the subtree slots into it;
3. read back layouts;
4. return the vector to `LayoutEngine` on every normal path.

The slot order and layout writes must remain identical. The scratch vector must
not be shared across primary and auxiliary layout engines or borrowed while a
nested relayout can occur.

## Candidate 2: Reuse Layout Text Runs

`layout::build` and style-only relayout each create a temporary `String` to
collect a text node's inline run before shaping. Evaluate a reusable layout
scratch only if its ownership can remain explicit across recursive `build`
calls and Taffy measure-context creation.

The candidate must preserve the owned text data required by any measure context;
the scratch cannot be returned while a context still borrows it. If this
requires copying strings into every context or complicates recursive ownership,
discard the candidate without implementing it.

## Measurement

Use the existing stats workload and the same three-sample PSP memory-scan
protocol. The current baseline is recorded in
`docs/bench/core-frame-baseline-2026-09-06.json`.

For each candidate:

1. Run the baseline command and verify stable checksum.
2. Apply only one candidate.
3. Run the same command and sample count.
4. Compare average work/render, maximum work, arena, safe arena, and checksum.
5. Keep only a candidate meeting the 3% timing threshold without a guardrail
   regression; otherwise record and revert it.

## Tests

- Add a layout readback test that compares layout output before and after reuse,
  including primary and auxiliary roots where existing fixtures allow it.
- Keep text measurement and drawlist golden tests unchanged.
- Run `cargo test --manifest-path engine/core/Cargo.toml` after each candidate.
- Run the relevant three-sample PSP benchmark after each candidate.
- Validate any receipts with deterministic JSON tests and run `git diff --check`.

## Non-Goals

- No layout algorithm or Taffy behavior changes.
- No style-dirty deduplication in this experiment.
- No host-specific renderer optimization.
- No candidate is retained for allocation-count reduction alone when frame work
  and render time improve by less than 3%.
