# Dedicated Memory Workloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic host asset, PSP tileset, and PSP fallback-glyph workloads so the remaining memory candidates can be measured instead of inferred.

**Architecture:** Keep the existing `membench` and PPSSPP runner protocols. Add a named host scenario and two named PSP app specs, each with independent receipts and path-activation checks. Do not alter the existing `stats/solid` canonical workload or production optimization code until a new workload produces a stable baseline.

**Tech Stack:** Rust `pocketjs_core` benchmark example, TypeScript Bun benchmark runner, Solid JSX PSP apps, PSP Rust renderer, PPSSPP headless, Bun tests, Cargo tests.

---

## File Map

- Modify `engine/core/examples/membench.rs`: add deterministic asset-heavy input builders and a separately printed asset workload receipt.
- Modify `tools/bench-ppsspp.ts`: register named tile and fallback app specs and pass workload-specific environment flags.
- Modify `tools/bench-ppsspp-parser.ts`: parse any explicit path-activation fields added to the PSP bench JSON line.
- Modify `hosts/psp/src/main.rs`: emit benchmark-only path counters in the existing JSONL record.
- Modify `hosts/psp/src/ge.rs`: increment the fallback-glyph counter at the exact fallback branch; do not optimize the branch yet.
- Modify `apps/gallery/app.tsx` only if its existing tile flow needs a deterministic benchmark mode; keep normal gallery behavior unchanged.
- Create `apps/bench-workloads/main.tsx`: benchmark entry point selecting tile or fallback scenario from a compile-time environment value.
- Create `apps/bench-workloads/app.tsx`: deterministic tile grid and fallback-glyph text screen using PocketJS framework imports.
- Create `apps/bench-workloads/pocket.json`: Solid benchmark app manifest.
- Create `docs/bench/core-memory-assets-2026-09-05.json`: host asset baseline receipt.
- Create `docs/bench/ppsspp-tileset-2026-09-05.json`: PSP tileset baseline receipt.
- Create `docs/bench/ppsspp-fallback-glyph-2026-09-05.json`: PSP fallback baseline receipt.
- Modify `tests/psp-bench-parser.test.ts`: test parsing and rejecting missing path-activation fields.
- Modify or extend Rust unit tests near `hosts/psp/src/ge.rs`: test counter reset and fallback counter recording under the `bench` feature.

### Task 1: Add Host Asset Workload Builders

**Files:**
- Modify: `engine/core/examples/membench.rs:236-562`
- Test: `engine/core/examples/membench.rs` benchmark assertions

- [ ] **Step 1: Add deterministic asset blob builders before the workload runner.**

Add fixed-size builders for one styles blob, two font atlas blobs, eight image
entries, and four sprite entries. Each builder must use existing `spec` values
and a fixed byte pattern; do not read files. The resulting call shape is:

```rust
let inputs = asset_inputs();
let mut handles = vec![-1; inputs.len()];
ui.load_assets(&inputs, &mut handles).unwrap();
assert!(handles.iter().any(|handle| *handle >= 0));
```

- [ ] **Step 2: Add a failing assertion for the asset scenario receipt shape.**

Run the example with the existing command and assert that the output contains a
separate `asset-workload` record with `peak_requested_bytes`,
`allocation_count`, `total_allocated_bytes`, and a stable resource checksum.

Run:

```bash
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
```

Expected before implementation: the asset-workload record is absent.

- [ ] **Step 3: Measure only the asset installation operation.**

Use the existing `begin_measurement`/`end_measurement` boundary around
`load_assets`, reset the `Ui` before each repetition, and emit the named record
without changing the existing canonical record.

- [ ] **Step 4: Verify host asset workload determinism.**

Run the example twice and compare the asset record's checksum and structural
fields. Run the core suite:

```bash
cargo test --manifest-path engine/core/Cargo.toml
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
```

Expected: core tests pass and both asset records have identical checksum and
input shape.

- [ ] **Step 5: Commit the host workload.**

```bash
git commit -m "bench(core): add asset-heavy memory workload"
```

### Task 2: Add PSP Benchmark Path Counters

**Files:**
- Modify: `hosts/psp/src/main.rs:287-408`
- Modify: `hosts/psp/src/ge.rs:260-284, 612-664`
- Modify: `tools/bench-ppsspp-parser.ts`
- Test: `tests/psp-bench-parser.test.ts`

- [ ] **Step 1: Add parser tests for explicit activation fields.**

Extend the parsed sample type with optional benchmark-only fields:

```ts
fallback_glyph_runs: number;
tileset_uploads: number;
```

Add tests that accept non-negative integer values and reject a record missing
the fields when a workload requests activation validation. Keep existing
`stats` fixture parsing unchanged by treating the fields as absent outside the
new workload mode.

- [ ] **Step 2: Add benchmark-only counters with reset semantics.**

In `hosts/psp/src/main.rs`, add counters to the existing benchmark state and
reset them in `bench_start_guest`. Include both values in the JSONL record
written by `bench_maybe_flush`.

In `hosts/psp/src/ge.rs`, increment `fallback_glyph_runs` immediately before
the fallback coverage scan, and increment `tileset_uploads` at the actual
tileset upload boundary used by the benchmark app. Counters must be compiled
only for the existing `bench` feature or routed through no-op functions so
release app behavior is unchanged.

- [ ] **Step 3: Run parser and PSP unit tests.**

```bash
bun test tests/psp-bench-parser.test.ts
cargo test --manifest-path hosts/psp/Cargo.toml --features bench
```

Expected: all existing parser tests pass, new activation tests pass, and the
PSP crate compiles with the benchmark feature.

- [ ] **Step 4: Commit the activation protocol.**

```bash
git commit -m "bench(psp): expose workload path activation counters"
```

### Task 3: Add Deterministic PSP Workload App

**Files:**
- Create: `apps/bench-workloads/main.tsx`
- Create: `apps/bench-workloads/app.tsx`
- Create: `apps/bench-workloads/pocket.json`
- Modify: `tools/bench-ppsspp.ts:54-73, 292-307`

- [ ] **Step 1: Create the benchmark app with explicit framework ownership.**

Import PocketJS components, lifecycle, input, and animation APIs from
`@pocketjs/framework/*`; import Solid primitives from `solid-js`. The app must
render a fixed tile grid and a fixed fallback-glyph text set based on an
environment-selected mode. It must not encode device SDK concepts or fake
crank/button input.

The app's mode selection must be deterministic:

```ts
const mode = import.meta.env.POCKETJS_BENCH_WORKLOAD === "fallback" ? "fallback" : "tileset";
```

- [ ] **Step 2: Add a manifest that can build under the existing PSP tool.**

Use a distinct app id and Solid framework entry. Reuse only existing repository
assets or deterministic inline data; do not add generated binary assets unless
the PSP packer requires them.

- [ ] **Step 3: Register two runner specs.**

Add `tileset` and `fallback-glyph` specs to `SPECS`, each with fixed capture
window values. Pass `POCKETJS_BENCH_WORKLOAD` from the spec to
metadata so receipts cannot be confused with `stats`.

- [ ] **Step 4: Build each app without running optimization candidates.**

```bash
bun tools/bench-ppsspp.ts --apps=tileset --samples=1
bun tools/bench-ppsspp.ts --apps=fallback-glyph --samples=1
```

Expected: both apps build, produce a JSONL record, and complete the configured
capture window. Do not accept a run until `tileset_uploads > 0` for tileset and
`fallback_glyph_runs > 0` for fallback-glyph.

- [ ] **Step 5: Commit the PSP workload app and runner registration.**

```bash
git commit -m "bench(psp): add tileset and fallback workloads"
```

### Task 4: Capture Independent Baselines

**Files:**
- Create: `docs/bench/core-memory-assets-2026-09-05.json`
- Create: `docs/bench/ppsspp-tileset-2026-09-05.json`
- Create: `docs/bench/ppsspp-fallback-glyph-2026-09-05.json`
- Modify: `tools/bench-ppsspp.ts` only if receipt metadata lacks workload name

- [ ] **Step 1: Capture the host asset baseline.**

Run the asset benchmark twice and save the stable receipt with the current git
revision, toolchain, input shape, and canonical asset checksum.

- [ ] **Step 2: Capture the PSP tileset baseline.**

```bash
bun tools/bench-ppsspp.ts --apps=tileset --samples=3 --memory-scan
```

Record arena bump, safe arena, average/max work, average render, bundle/package
size, checksum, and `tileset_uploads`. Verify the counter is positive in every
sample.

- [ ] **Step 3: Capture the PSP fallback baseline.**

```bash
bun tools/bench-ppsspp.ts --apps=fallback-glyph --samples=3 --memory-scan
```

Record the same PSP metrics plus `fallback_glyph_runs`. Verify the counter is
positive in every sample and the checksum is identical across samples.

- [ ] **Step 4: Run the complete benchmark test set.**

```bash
bun test tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
```

Expected: all tests pass and the existing canonical receipts remain unchanged.

- [ ] **Step 5: Commit the independent receipts.**

```bash
git commit -m "bench: record dedicated workload baselines"
```

### Task 5: Evaluate Candidates Independently

**Files:**
- Modify and then revert or keep one candidate at a time:
  - `engine/core/src/assets.rs`
  - `engine/core/src/lib.rs`
  - `hosts/psp/src/ge.rs`
- Modify: corresponding receipt markdown or JSON only for retained results

- [ ] **Step 1: Test asset staging against the host receipt.**

Apply only the asset staging candidate, run the host asset workload, compare
peak requested bytes first, then allocation count and total allocated bytes,
and run the core tests. Keep the code only if asset installation remains atomic
and peak improves without a meaningful correctness regression.

- [ ] **Step 2: Test tileset upload against the PSP receipt.**

Apply only the direct-upload candidate, run the tileset workload with three
samples and memory scan, and compare arena bump, safe arena, work, render, and
checksum. Revert it if `tileset_uploads` is not positive or any guardrail
regresses.

- [ ] **Step 3: Test fallback glyph scan against the PSP receipt.**

Apply only the duplicate-scan candidate, run the fallback workload with three
samples and memory scan, and compare average render/work and arena. Keep it
only if `fallback_glyph_runs` remains positive and the checksum is unchanged.

- [ ] **Step 4: Run final verification.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
git status --short --branch
```

- [ ] **Step 5: Commit only validated candidates.**

Use one Conventional Commit per retained optimization, for example:

```bash
git add engine/core/src/assets.rs docs/bench/core-memory-assets-2026-09-05.json
git commit -m "perf(core): reduce asset staging peak"
git add hosts/psp/src/ge.rs docs/bench/ppsspp-fallback-glyph-2026-09-05.json
git commit -m "perf(psp): reduce fallback glyph scan work"
```

Do not commit discarded candidate changes or overwrite the existing `stats`
baseline.

## Self-Review

- The design's three workload requirements map to Tasks 1, 3, and 4.
- Activation verification maps to Task 2 and the per-workload checks in Tasks 3
  and 4.
- Existing benchmark compatibility is covered by Task 4's test command.
- No placeholder paths or undefined receipt fields are used; the new fields are
  explicitly named `fallback_glyph_runs` and `tileset_uploads`.
- Candidate evaluation is isolated and reversible in Task 5.
