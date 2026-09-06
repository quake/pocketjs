# Core Frame Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test two concise `engine/core` changes against PSP frame workloads and retain only changes that improve average work or render time by at least 3% without output or memory regressions.

**Architecture:** Candidate 1 reuses a draw-owned text buffer while preserving native and baked text output. Candidate 2 removes one per-frame child-vector clone from 3D paint traversal. Each candidate is measured independently, then kept or reverted based on the fixed 3% gate.

**Tech Stack:** Rust `pocketjs_core`, PSP PPSSPP headless benchmark, existing `stats` and `motions` apps, Cargo tests, Bun benchmark runner.

---

## File Map

- Modify `engine/core/src/draw.rs`: add the reusable text-run scratch buffer and adjust text emission ownership.
- Modify `engine/core/src/lib.rs` only if `Ui` initialization requires a field assignment outside `draw.rs`.
- Modify `engine/core/src/tests.rs` only for focused drawlist equivalence coverage if existing golden tests do not cover both text paths.
- Modify `docs/bench/` only for independent candidate receipts when a candidate is retained or an auditable discarded result is needed.
- Do not modify PSP renderer files, DrawList format, or public host APIs.

## Task 1: Establish Workload Baselines

**Files:**
- Read: `docs/bench/ppsspp-fallback-glyph-2026-09-05.json`, existing stats receipts
- Create: candidate-specific receipts under `docs/bench/` only after measurements

- [ ] **Step 1: Verify the text workload is active.**

Run the existing stats workload with three samples and record the stable checksum:

```bash
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Expected: three samples, stable `drawlist_checksum`, and no build/runtime error.

- [ ] **Step 2: Verify the perspective workload is active.**

Run the existing motions workload:

```bash
bun tools/bench-ppsspp.ts --apps=motions --samples=3 --memory-scan
```

Use the generated drawlist/checksum and metrics only if the app exercises
perspective content. If it does not, stop the 3D candidate rather than adding a
new benchmark app or host-specific instrumentation.

- [ ] **Step 3: Save baseline measurements without overwriting canonical receipts.**

Record the exact git revision, PPSSPP revision, command, sample values, mean,
checksum, safe arena, and memory-scan attempts in candidate baseline receipts.
Do not modify `stats` canonical receipts.

- [ ] **Step 4: Run the existing core tests before candidate code.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
git diff --check
```

Expected: all current core tests pass before either candidate is applied.

- [ ] **Step 5: Commit baseline receipts if new receipts were needed.**

```bash
git add docs/bench
git commit -m "bench(core): record frame optimization baselines"
```

## Task 2: Evaluate Text Scratch Reuse

**Files:**
- Modify: `engine/core/src/draw.rs:2470-2610`
- Modify: `engine/core/src/lib.rs` if required by `Ui` construction
- Test: existing core draw/text tests and any focused test added in `engine/core/src/tests.rs`

- [ ] **Step 1: Add a failing drawlist-equivalence test.**

Use the existing deterministic text/glyph draw test setup and assert that the
same UI drawn twice produces identical drawlist words and checksum. The test
must exercise both a baked `GLYPH_RUN` and the native `TEXT_RUN` path when the
existing test fixtures support both.

Run:

```bash
cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture
```

Expected before the implementation: the new scratch-specific test should fail
because the reusable field/helper does not exist.

- [ ] **Step 2: Add the reusable field with the minimal initialization.**

Add one `String` field initialized with `String::new()` in the existing `Ui`
constructor. Do not change public constructors or serialized state.

- [ ] **Step 3: Return the buffer on every text-emission path.**

Implement the ownership pattern below in `emit_text`:

```rust
let mut run = core::mem::take(&mut self.text_run_scratch);
run.clear();
collect_run_of(self.tree, node, &mut run);
if run.is_empty() {
    self.text_run_scratch = run;
    return;
}
```

Make `emit_text_native` return the owned `String` after measurement/output,
including all early returns. The baked path also returns `run` after it patches
the drawlist. Never leave the field empty after a completed emission.

- [ ] **Step 4: Run focused and full core tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture
cargo test --manifest-path engine/core/Cargo.toml
```

Expected: all tests pass and deterministic drawlist checksums remain unchanged.

- [ ] **Step 5: Run the unchanged three-sample stats benchmark.**

Run the exact baseline command from Task 1. Compare mean `avg_work_us`,
`avg_render_us`, safe arena, and checksum. Retain the candidate only if either
timing metric improves by at least 3%, checksum is unchanged, and arena does
not materially increase. Otherwise revert the candidate code and keep only an
auditable discarded result.

- [ ] **Step 6: Commit only a qualifying candidate.**

```bash
git add engine/core/src/draw.rs engine/core/src/lib.rs engine/core/src/tests.rs docs/bench
git commit -m "perf(core): reuse text draw scratch"
```

## Task 3: Evaluate 3D Child Traversal

**Files:**
- Modify: `engine/core/src/draw.rs:1260-1273`
- Test: existing perspective/3D core tests
- Create: candidate receipt only if the benchmark is active and measured

- [ ] **Step 1: Add a failing source-level behavior test if needed.**

Use the existing perspective drawlist test to assert stable child order and
checksum. The test must verify the emitted order, not the implementation's
allocation strategy.

Run:

```bash
cargo test --manifest-path engine/core/Cargo.toml perspective -- --nocapture
```

Expected: the test is green for current behavior; if no focused test exists,
add one that fails only when child order changes before changing traversal.

- [ ] **Step 2: Replace the clone with direct immutable iteration.**

Replace the per-frame copy:

```rust
let children: Vec<i32> = root.children.clone();
for cid in children {
    if let Some(cs) = self.tree.resolve(cid) {
        self.collect_3d(cs, &Mat34::IDENTITY, opacity, root_world, distance, cx, cy, &mut items, &mut tex_cells);
    }
}
```

with direct iteration over the existing child ids:

```rust
for &cid in &root.children {
    if let Some(cs) = self.tree.resolve(cid) {
        self.collect_3d(cs, &Mat34::IDENTITY, opacity, root_world, distance, cx, cy, &mut items, &mut tex_cells);
    }
}
```

If Rust borrow checking requires a narrower root borrow, retain an immutable
slice reference only; do not reintroduce a clone or change tree ownership.

- [ ] **Step 3: Run perspective and full core tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml perspective -- --nocapture
cargo test --manifest-path engine/core/Cargo.toml
```

Expected: all tests pass and perspective drawlist checksum/order remains stable.

- [ ] **Step 4: Run the unchanged three-sample motions benchmark.**

Compare average work/render, max work, arena, safe arena, and checksum against
Task 1. Keep the candidate only at the 3% timing threshold with no guardrail
regression. If the workload does not activate perspective, discard the code and
record the candidate as unmeasured rather than claiming a benefit.

- [ ] **Step 5: Commit only a qualifying candidate.**

```bash
git add engine/core/src/draw.rs engine/core/src/tests.rs docs/bench
git commit -m "perf(core): avoid 3d child clone"
```

## Task 4: Final Verification and Decision

**Files:**
- Modify: only retained candidate files and their receipts

- [ ] **Step 1: Run all core tests and relevant benchmark tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
```

- [ ] **Step 2: Verify production scope.**

```bash
git diff --name-only cbdbdc1..HEAD -- engine/core hosts/psp
```

Expected: retained production changes, if any, appear only under `engine/core`;
no PSP renderer or host files are changed by these candidates.

- [ ] **Step 3: Commit the final decision receipt.**

For each candidate, record retained/discarded status, baseline/candidate
revisions, per-sample metrics, checksum, memory guardrails, and the exact reason
for the decision. Use a Conventional Commit such as:

```bash
git add docs/bench
git commit -m "bench(core): record frame optimization decisions"
```

## Self-Review

- Text scratch requirements map to Task 2, including native/baked early returns.
- 3D clone requirements map to Task 3, including direct child-order testing.
- The 3% threshold and guardrails are applied in both candidate tasks.
- No PSP/core API/DrawList format changes are planned.
- Inactive workloads produce a discarded/unmeasured result rather than a false
  performance claim.
