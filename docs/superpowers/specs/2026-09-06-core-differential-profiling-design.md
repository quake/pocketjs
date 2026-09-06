# Core Differential Profiling Design

## Goal

Use controlled `membench` workload variants to identify which layout-related
path consumes the measured tick time and allocations before attempting another
core optimization.

## Scope and Constraints

- Changes are limited to `engine/core/examples/membench.rs` and its Bun test.
- Do not modify `engine/core/src`, PSP hosts, DrawList formats, public APIs, or
  benchmark runner behavior for this profiling pass.
- Every variant uses the same Rust process, fixture setup, measurement window,
  viewport, font atlas, and checksum validation.
- Profiling output is diagnostic. No production optimization is retained in
  this pass.
- The existing PSP three-sample benchmark and 3% gate remain the acceptance
  criteria for a later optimization, not for choosing a profiling variant.

## Workload Matrix

Run the same deterministic fixture through these variants:

1. `full`: current workload with steady style ticks, structural churn, text
   updates, and burst updates.
2. `style_only`: the same node tree with only steady style-property updates;
   no structure changes or text changes after setup.
3. `structure_no_text`: structural subtree creation/destruction with text nodes
   replaced by non-text views while preserving node count as closely as the
   fixture allows.
4. `text_updates`: text updates without structural probes or subtree churn.
5. `no_draw_control`: the full tick workload with draw/hash skipped after each
   tick, isolating tick/layout work from DrawList construction. The control is
   diagnostic only and must retain a separate checksum policy for setup output.

The matrix must report each variant's exact node count, measured tick count,
structural relayout count, average/max tick microseconds, stage draw time where
applicable, allocation count, allocated bytes, and checksum/control status.

## Measurement Contract

Each variant emits one line-oriented receipt record with these fields:

```text
variant=<name>
nodes=<integer>
measured_ticks=<integer>
structural_relayouts=<integer>
avg_tick_us=<integer>
max_tick_us=<integer>
draw_us=<integer>
allocation_count=<integer>
total_allocated_bytes=<integer>
drawlist_checksum=<16 lowercase hex digits or control marker>
```

`avg_tick_us` and `max_tick_us` remain complete `Ui::tick()` workload proxies.
`draw_us` measures only the draw/hash portion for variants that draw. Timing
values are not required to be identical across repeated runs; allocation
counts, byte totals, node counts, tick counts, relayout counts, and checksums
must be deterministic for a fixed variant.

## Interpretation Rules

- `full - style_only` estimates the combined structural/text workload cost.
- `structure_no_text - style_only` estimates structure/layout overhead without
  text shaping.
- `text_updates - style_only` estimates text update and text measurement cost
  without structural probes.
- `full - no_draw_control` estimates DrawList construction and hashing cost;
  this is a diagnostic differential, not a PSP render measurement.
- Do not attribute a difference to an internal function unless the matrix
  controls isolate that behavior. Report conclusions as workload-path evidence.

## Decision Rules

1. Run the matrix and verify all stable fields and checksums.
2. Rank paths by normalized average tick time and allocation bytes per measured
   tick, while preserving the exact raw records.
3. Choose one highest-cost path for a separate optimization design.
4. If a variant changes checksum, node count, or relayout count unexpectedly,
   reject that comparison and fix the fixture before interpreting timings.
5. Do not implement or retain an optimization until a hotspot is identified and
   a new design is approved.
