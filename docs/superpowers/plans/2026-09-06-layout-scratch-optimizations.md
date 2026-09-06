# Layout Scratch Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure two small `engine/core` layout scratch reuse candidates and retain only a candidate that improves PSP frame work or render time by at least 3%.

**Architecture:** Add a reusable slot buffer to each `LayoutEngine` for readback, then independently evaluate a reusable text-run buffer for layout shaping. The layout algorithm, Taffy data, DrawList format, public APIs, and host renderers remain unchanged.

**Tech Stack:** Rust `pocketjs_core`, Taffy layout engine, PSP PPSSPP headless benchmark, Cargo tests, Bun receipt tests.

---

## File Map

- Modify `engine/core/src/layout.rs`: add readback scratch ownership and candidate text-run scratch logic.
- Modify `engine/core/src/lib.rs` only if `LayoutEngine` construction requires explicit initialization outside `layout.rs`.
- Modify `engine/core/src/tests.rs` only for readback/layout equivalence coverage.
- Add receipts under `docs/bench/` only for measured candidate decisions.
- Add receipt integrity assertions to `tests/core-frame-receipts.test.ts` only when new receipts are created.
- Do not modify `hosts/psp`, other host renderers, DrawList formats, or public APIs.

## Task 1: Capture Layout Baseline

**Files:**
- Read: `docs/bench/core-frame-baseline-2026-09-06.json`
- Create: `docs/bench/core-layout-scratch-baseline-2026-09-06.json`

- [x] **Step 1: Run the unchanged stats workload.**

```bash
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Record all three sample values for `avg_work_us`, `max_work_us`,
`avg_render_us`, `arena_bump_bytes`, safe arena, frame/window metadata, and
drawlist checksum. Confirm the checksum is identical across samples.

- [x] **Step 2: Run the core suite before changes.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
git diff --check
```

Expected: 129 core tests pass; the only allowed output is existing warnings.

- [x] **Step 3: Write and validate the independent baseline receipt.**

The receipt must include the exact command, git/PPSSPP/toolchain revisions,
sample arrays, checksum samples, memory-scan attempts, and `status: "BASELINE"`.
It must not overwrite `core-frame-baseline-2026-09-06.json`.

- [x] **Step 4: Commit the baseline receipt.**

```bash
git add docs/bench/core-layout-scratch-baseline-2026-09-06.json
git commit -m "bench(core): record layout scratch baseline"
```

## Task 2: Evaluate Readback Slot Scratch

**Files:**
- Modify: `engine/core/src/layout.rs:293-313, 52-71, 90-99`
- Test: `engine/core/src/tests.rs` or existing layout tests

- [x] **Step 1: Add a failing layout equivalence test.**

Build a UI with a primary and auxiliary root, force relayout, and assert that
rounded layout values are identical before and after the readback buffer is
reused. Run the focused layout tests before implementation and confirm the new
scratch-specific expectation fails because the field/helper is absent.

```bash
cargo test --manifest-path engine/core/Cargo.toml layout -- --nocapture
```

- [x] **Step 2: Add `readback_slots` to `LayoutEngine`.**

Initialize it beside `style_dirty`:

```rust
readback_slots: Vec::new(),
```

Change readback to accept the reusable vector, clear it, collect the subtree,
iterate the same slot order, and return the vector to the owning engine on all
normal paths. Keep primary and auxiliary `LayoutEngine` instances independent.

- [x] **Step 3: Run the focused and full core tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml layout -- --nocapture
cargo test --manifest-path engine/core/Cargo.toml
```

Expected: all layout outputs and checksums remain unchanged.

- [x] **Step 4: Run the exact three-sample PSP comparison.**

Compare the candidate against the Task 1 receipt:

```bash
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Retain only if `avg_work_us` or `avg_render_us` improves by at least 3%,
checksum is unchanged, and arena/safe arena do not materially regress. Otherwise
revert the production candidate and record a discarded receipt.

- [x] **Step 5: Commit only a qualifying candidate or its auditable result.**

```bash
git add engine/core/src/layout.rs engine/core/src/tests.rs docs/bench
git commit -m "perf(core): reuse layout readback slots"
```

The readback candidate failed the 3% timing gate and was reverted; only its discarded receipt was retained.

## Task 3: Evaluate Layout Text-Run Scratch

**Files:**
- Modify: `engine/core/src/layout.rs:245-290, 353-405`
- Test: existing text measurement and layout tests

- [x] **Step 1: Confirm ownership constraints before coding.**

Inspect `MeasureCtx::shaped` and Taffy context ownership. A reusable String is
allowed only if `MeasureCtx` stores owned measurement data and no Taffy context
borrows the scratch. If the implementation would require copying every run or
introduce recursive mutable borrowing, record the candidate as rejected without
production code.

- [x] **Step 2: Add a failing text measurement equivalence test.**

Use existing text fixtures to compare measured width/height, `text_native`, and
the resulting drawlist checksum across repeated relayouts:

```bash
cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture
```

- [x] **Step 3: Implement the smallest safe ownership change.**

Reuse a scratch only across non-recursive collection boundaries. If recursive
`build` needs nested buffers, use a local owned String and discard this
candidate; do not add a pool, unsafe aliasing, or a new public API.

- [x] **Step 4: Run tests and the three-sample PSP comparison.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Apply the same 3% timing, checksum, arena, and correctness gates. Revert code
when the candidate does not qualify and preserve only a truthful discarded
receipt.

- [x] **Step 5: Commit only a qualifying candidate or its auditable result.**

```bash
git add engine/core/src/layout.rs engine/core/src/tests.rs docs/bench
git commit -m "perf(core): reuse layout text scratch"
```

The ownership review was safe, but the candidate failed the 3% timing gate and increased arena high-water by 32 bytes. Production code was reverted; only its discarded receipt was retained.

## Task 4: Final Verification

**Files:**
- Modify: only retained candidate files and receipt/test files

- [x] **Step 1: Run final tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-frame-receipts.test.ts tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
```

- [x] **Step 2: Verify production scope.**

```bash
git diff --name-only 5d3dae7..HEAD -- hosts/psp engine/core
```

Expected: any retained production change is under `engine/core`; no host
renderer, DrawList format, or public API file is changed.

- [x] **Step 3: Validate every receipt decision.**

Each new receipt must state baseline/candidate provenance, per-sample metrics,
checksum samples, memory scan evidence, threshold calculation, and retained or
discarded status. Add its invariant checks to `tests/core-frame-receipts.test.ts`.

## Self-Review

- Readback scratch coverage maps to Task 2, including primary/auxiliary ownership.
- Text scratch ownership constraints map to Task 3 and allow rejection without
  unsafe or complex code.
- Every candidate uses the same 3% timing threshold and guardrails.
- Production scope excludes all host renderer changes.
- Inactive or non-reproducible candidates are explicitly recorded rather than
  treated as successful optimizations.
