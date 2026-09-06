# Core Profiling Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing core memory benchmark with stage-level timing and allocation evidence so future optimizations target measured hotspots instead of guessed code paths.

**Architecture:** Keep all instrumentation in `engine/core/examples/membench.rs` and its receipt test. The benchmark will measure the existing workload phases without changing `pocketjs_core` production code, PSP hosts, DrawList formats, or public APIs. Stage totals will be emitted as deterministic key/value receipt fields and checked for conservation against the existing total tick timing and allocation counters.

**Tech Stack:** Rust `pocketjs_core` example, `std::time::Instant`, counting global allocator already used by `membench`, Bun tests.

---

## File Map

- Modify `engine/core/examples/membench.rs`: add stage timing/allocation accounting and receipt output.
- Modify `tests/core-memory-bench.test.ts`: parse and validate the new fields and invariants.
- Do not modify `engine/core/src`, PSP hosts, benchmark runner, or production APIs.

## Task 1: Define Profiling Receipt Contract

**Files:**
- Modify: `tests/core-memory-bench.test.ts`
- Test input: existing `engine/core/examples/membench.rs` output

- [ ] **Step 1: Add failing assertions for stage fields.**

Extend `REQUIRED_FIELDS` with these exact fields:

```text
stage_tick_us
stage_draw_us
stage_layout_us
stage_animation_us
stage_allocation_count
stage_total_allocated_bytes
```

The parser must continue rejecting unknown, duplicate, empty, non-integer, and
negative values. Add assertions that all stage values are non-negative integers
and that the stage timing fields are present in the parsed receipt.

- [ ] **Step 2: Run the receipt test and verify it fails.**

```bash
bun test tests/core-memory-bench.test.ts
```

Expected: failure because the current membench output does not yet contain the
new stage fields.

## Task 2: Add Stage Timing and Allocation Accounting

**Files:**
- Modify: `engine/core/examples/membench.rs:224-235, 505-536, 578-680`

- [ ] **Step 1: Add a stage accumulator with explicit invariants.**

Add a small benchmark-local structure:

```rust
#[derive(Default)]
struct StageProfile {
    tick_us: u128,
    draw_us: u128,
    layout_us: u128,
    animation_us: u128,
    allocation_count: usize,
    total_allocated_bytes: usize,
}
```

Keep it local to the example. Do not export it from the core library.

- [ ] **Step 2: Instrument the existing tick/draw boundary.**

Change `tick_and_measure` to accept `&mut StageProfile`. Measure the existing
`ui.tick()` duration as `tick_us`, measure `ui.draw()` separately as `draw_us`,
and preserve the current checksum and glyph assertions. Do not double-count the
existing `total_us`: it must remain the full tick timing used by the current
`avg_layout_us` receipt field.

Use the existing `Instant` timing style:

```rust
let started = Instant::now();
ui.tick();
profile.tick_us += started.elapsed().as_micros();
let started = Instant::now();
let words = &ui.draw().words;
profile.draw_us += started.elapsed().as_micros();
```

- [ ] **Step 3: Attribute layout and animation sub-stages without changing core behavior.**

Keep `ui.tick()` as the only production operation. Use the existing workload
phase boundaries to accumulate stage labels: structural/text/burst ticks are
`layout_us`, steady style-only ticks are `animation_us`. Document that these
are workload-phase proxies, not internal function timings. Use the measured
tick duration for each phase so:

```text
stage_layout_us + stage_animation_us == stage_tick_us
```

for the measured ticks, allowing only integer timing values already returned by
`Instant::as_micros()`.

- [ ] **Step 4: Snapshot allocation counters after the measured workload.**

After `end_measurement()`, copy `COUNT` and `TOTAL` into the profile output
fields. Keep existing `allocation_count` and `total_allocated_bytes` output
unchanged; the stage fields must equal those values because all measured
allocations belong to the profiled workload.

- [ ] **Step 5: Print the new receipt fields.**

Print these exact lines before the existing receipt fields:

```text
stage_tick_us=<integer>
stage_draw_us=<integer>
stage_layout_us=<integer>
stage_animation_us=<integer>
stage_allocation_count=<integer>
stage_total_allocated_bytes=<integer>
```

Assert the timing and allocation invariants inside the example before printing
the checksum. The existing checksum assertion remains unchanged.

## Task 3: Validate Profiling Output

**Files:**
- Modify: `tests/core-memory-bench.test.ts`

- [ ] **Step 1: Run the focused benchmark receipt test.**

```bash
bun test tests/core-memory-bench.test.ts
```

Expected: parser and receipt stability tests pass, including the existing
canonical baseline comparison. Record the new profiling values from the output.

- [ ] **Step 2: Run the core suite and receipt suite.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-frame-receipts.test.ts tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
```

Expected: 129 core tests and all Bun tests pass. The only Rust output allowed
is the existing `unused_mut` warning.

- [ ] **Step 3: Confirm production scope.**

```bash
git diff --name-only HEAD~1..HEAD -- engine/core/src hosts/psp
```

Expected: no files. Only the example and its test may change.

- [ ] **Step 4: Commit the profiling instrumentation.**

```bash
git add engine/core/examples/membench.rs tests/core-memory-bench.test.ts
git commit -m "test(core): add stage profiling to membench"
```

The commit must not include optimization code or a PSP benchmark receipt. The
stage output is diagnostic evidence for the next optimization design.

## Task 4: Final Review

- [ ] **Step 1: Review the profiling contract.**

Verify that stage fields are deterministic enough for comparison, timing totals
are not confused with PSP `avg_work_us`, allocation values conserve against the
existing receipt, and comments identify phase values as workload proxies.

- [ ] **Step 2: Run the final benchmark manually.**

```bash
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
```

Record the six stage fields and use them to rank the next optimization
candidates. Do not retain a code optimization in this task.
