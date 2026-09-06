# Core Differential Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a controlled `membench` workload matrix that identifies the dominant layout-related path before another optimization is attempted.

**Architecture:** Refactor the existing deterministic memory benchmark into a local variant runner that shares fixture setup and receipt accounting while toggling one workload dimension at a time. The matrix remains entirely in the example and its Bun parser test; no core production code, PSP host, DrawList format, or public API changes are allowed.

**Tech Stack:** Rust `pocketjs_core` example, counting allocator, `std::time::Instant`, Bun tests.

---

## File Map

- Modify `engine/core/examples/membench.rs`: add variant selection, controlled workload execution, and one record per variant.
- Modify `tests/core-memory-bench.test.ts`: parse variant records and validate stable fields, required variants, and checksum/control semantics.
- Modify `docs/superpowers/specs/2026-09-06-core-differential-profiling-design.md` only if measurement terminology needs clarification; do not add production code.
- Do not modify `engine/core/src`, PSP hosts, DrawList formats, public APIs, or `tools/bench-ppsspp.ts`.

## Task 1: Define Variant Receipt Contract

**Files:**
- Modify: `tests/core-memory-bench.test.ts`
- Read: `engine/core/examples/membench.rs`

- [ ] **Step 1: Add an explicit variant fixture and parser test.**

Add a parser for one line-oriented variant record with these exact fields:

```text
variant=<full|style_only|structure_no_text|text_updates|no_draw_control>
nodes=<non-negative integer>
measured_ticks=<positive integer>
structural_relayouts=<non-negative integer>
avg_tick_us=<non-negative integer>
max_tick_us=<non-negative integer>
draw_us=<non-negative integer>
allocation_count=<non-negative integer>
total_allocated_bytes=<non-negative integer>
drawlist_checksum=<16 lowercase hex digits|control>
```

Test unknown variants, missing fields, duplicate fields, malformed integers,
invalid checksums, duplicate variant records, and missing required variants.
Use an explicit fixture string independent of the parser's required-field list.

- [ ] **Step 2: Run the new parser test and observe the red result.**

```bash
bun test tests/core-memory-bench.test.ts
```

Expected: the existing single-record `membench` output fails the matrix
contract because it has no `variant=` records.

## Task 2: Extract a Variant Runner Without Behavior Changes

**Files:**
- Modify: `engine/core/examples/membench.rs:538-780`

- [ ] **Step 1: Define benchmark-local variant types.**

Use a private enum and result type in the example:

```rust
#[derive(Clone, Copy)]
enum Variant {
    Full,
    StyleOnly,
    StructureNoText,
    TextUpdates,
    NoDrawControl,
}

struct VariantReceipt {
    variant: &'static str,
    nodes: usize,
    measured_ticks: usize,
    structural_relayouts: usize,
    avg_tick_us: u128,
    max_tick_us: u128,
    draw_us: u128,
    allocation_count: usize,
    total_allocated_bytes: usize,
    checksum: Option<u64>,
}
```

Keep all types private to the example. The existing `StageProfile` remains the
source for timing and allocation fields.

- [ ] **Step 2: Preserve the existing full workload as the control.**

Extract the current setup and phase loops into a function returning
`VariantReceipt`. The `Full` path must preserve the current node count,
structural relayout count, allocation totals, and checksum
`cc6a0b00efdba151`. Run the existing membench test before adding other variants
and confirm the control record matches those stable values.

- [ ] **Step 3: Add a draw toggle at the benchmark boundary.**

Change only the example's local `tick_and_measure` path to accept `draw_enabled`:

```rust
fn tick_and_measure(
    ui: &mut Ui,
    checksum: &mut u64,
    profile: &mut StageProfile,
    draw_enabled: bool,
) {
    // Existing ui.tick timing remains unchanged.
    // Call ui.draw/hash only when draw_enabled; otherwise record no draw time.
}
```

For `NoDrawControl`, emit `drawlist_checksum=control` and do not compare that
control checksum with drawing variants. Setup must still create the same tree
and validate that the drawn `Full` variant produces the pinned checksum.

## Task 3: Implement Controlled Workload Variants

**Files:**
- Modify: `engine/core/examples/membench.rs`

- [ ] **Step 1: Implement `style_only`.**

Run the same setup and 24 steady opacity updates as the current Phase 2. Skip
subtree churn, text changes, and burst updates. Report the exact resulting node
count and `structural_relayouts=1` for the initial build.

- [ ] **Step 2: Implement `structure_no_text`.**

Build the same number of rows and images but use view nodes instead of text
nodes for the text positions. Run the existing fixed-size subtree churn loop
and no text updates. Preserve a separate checksum expected for this fixture;
do not reuse the full checksum constant.

- [ ] **Step 3: Implement `text_updates`.**

Keep the full text tree and text IDs. Run the text-update loop without
`structural_probe` calls or burst gap changes. The node count must match full;
record its actual structural relayout count and checksum.

- [ ] **Step 4: Implement `no_draw_control`.**

Run the full tick workload with `draw_enabled=false`. Keep tick, layout, and
allocation measurements. Emit `draw_us=0` and `drawlist_checksum=control`.

- [ ] **Step 5: Print one complete record per variant.**

Print records in this order:

```text
variant=full
...
variant=style_only
...
variant=structure_no_text
...
variant=text_updates
...
variant=no_draw_control
...
```

Do not print legacy single-record fields in matrix mode. Keep the checksum
assertion for `full` and assert that all non-control variants produce non-control
checksums.

## Task 4: Validate Matrix Invariants

**Files:**
- Modify: `tests/core-memory-bench.test.ts`

- [ ] **Step 1: Run the focused matrix test.**

```bash
bun test tests/core-memory-bench.test.ts
```

Expected: all five variants parse, stable integer fields are valid, `full` has
the pinned existing checksum, `no_draw_control` has `control`, and no variant
is duplicated or missing.

- [ ] **Step 2: Run the example and inspect raw records.**

```bash
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
```

Confirm the output contains exactly five records, deterministic node/tick/
relayout/allocation fields, and timing values in the expected non-negative
range. Save the raw values in the implementation plan's results section.

- [ ] **Step 3: Run core and related suites.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-frame-receipts.test.ts tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
```

Expected: 129 core tests and all Bun tests pass. No files under
`engine/core/src` or `hosts/psp` may change.

- [ ] **Step 4: Commit the profiling matrix.**

```bash
git add engine/core/examples/membench.rs tests/core-memory-bench.test.ts docs/superpowers/plans/2026-09-06-core-differential-profiling.md
git commit -m "test(core): add differential membench matrix"
```

## Task 5: Interpret and Select the Next Hotspot

**Files:**
- Modify: `docs/superpowers/plans/2026-09-06-core-differential-profiling.md`

- [ ] **Step 1: Normalize raw records.**

For every variant calculate:

```text
avg_tick_per_tick = avg_tick_us
alloc_bytes_per_tick = total_allocated_bytes / measured_ticks
```

Compare `full` against `style_only`, `structure_no_text`, `text_updates`, and
`no_draw_control` only when node/tick/relayout controls match or the difference
is explicitly documented.

- [ ] **Step 2: Record one hotspot conclusion.**

State whether the largest controlled differential is structure/layout, text
measurement, or draw construction. Do not call it an internal function hotspot
without direct instrumentation. Select exactly one path for the next design and
leave optimization code untouched.

- [ ] **Step 3: Final scope check.**

```bash
git diff --name-only a185ba9..HEAD
```

Expected: only profiling plan/spec/test/example files; no production core source
or host files.
