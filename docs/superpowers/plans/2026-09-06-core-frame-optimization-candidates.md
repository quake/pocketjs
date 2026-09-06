# Core Frame Optimization Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate remaining low-risk core frame allocation candidates and retain only a candidate that passes the existing 3% PSP timing and correctness gates.

**Architecture:** Start with a private Draw walker text-run scratch candidate because the active stats workload paints text. Then inspect 3D collection and layout rebuild scratch ownership independently; implement and measure only safe candidates. Every candidate is isolated, benchmarked against the committed baseline, and reverted with a canonical receipt when it does not qualify.

**Tech Stack:** Rust `pocketjs_core`, Bun receipt tests, PPSSPP headless stats benchmark, existing DrawList golden tests.

---

## File Map

- Modify `engine/core/src/draw.rs` only for a retained or measured Draw scratch candidate.
- Modify `engine/core/src/layout.rs` only for a retained or measured layout rebuild candidate.
- Modify `engine/core/src/tests.rs` only for focused output-equivalence tests.
- Add candidate receipts under `docs/bench/` using the canonical schema already used by the layout scratch receipts.
- Extend `tests/core-frame-receipts.test.ts` for every new receipt, including baseline-linked gate checks.
- Do not modify `hosts/psp`, other host renderers, DrawList formats, public APIs, or benchmark workloads.

## Task 1: Capture Candidate Baseline Context

**Files:**
- Read: `docs/bench/core-layout-scratch-baseline-2026-09-06.json`
- Read: `docs/superpowers/specs/2026-09-06-core-frame-optimization-candidates-design.md`

- [ ] **Step 1: Verify the committed baseline and clean scope.**

Run:

```bash
git status --short --branch
git diff --name-only 5d3dae7..HEAD -- hosts/psp engine/core
bun test tests/core-frame-receipts.test.ts
```

Expected: clean worktree, no production files in the prior optimization range,
and all receipt tests passing. Use the committed baseline receipt as the
comparison source; do not overwrite it.

- [ ] **Step 2: Commit no code for this task.**

The existing baseline is sufficient. Record the baseline path and exact command
in each candidate receipt rather than creating duplicate baseline data.

## Task 2: Evaluate Draw Text-Run Scratch

**Files:**
- Modify: `engine/core/src/draw.rs:847-875, 2470-2610`
- Test: `engine/core/src/tests.rs` or an existing draw/text test module
- Add: one canonical receipt under `docs/bench/` if the candidate is rejected or retained
- Modify: `tests/core-frame-receipts.test.ts` for that receipt

- [ ] **Step 1: Add the failing text output equivalence test.**

Exercise the existing text fixture through repeated draws and assert that the
drawlist words/checksum and text output remain identical. The test must target
real `Ui`/draw behavior, not a mock. Run the focused test before adding the
scratch field and observe a failure caused by the missing candidate-specific
setup or helper.

```bash
cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture
```

- [ ] **Step 2: Implement the smallest private scratch ownership change.**

Add a private `run_scratch: String` field to `Walker`, initialize it in
`build_root`, and collect each run into that buffer. The buffer may be reused
only after the current text path has consumed it. Preserve the existing native
path's owned data requirement by changing the helper to consume an owned copy
only when required, or reject the candidate if avoiding that copy is not safe.
Do not use `unsafe`, a global pool, a public API, or a borrow that survives the
current `emit_text` call. The intended shape is:

```rust
struct Walker<'a> {
    // existing fields...
    run_scratch: String,
}

// In emit_text, collect into the walker-owned buffer, consume it synchronously,
// then leave the capacity available for the next text node.
self.run_scratch.clear();
collect_run_of(self.tree, node, &mut self.run_scratch);
```

If native emission requires ownership that would force a full copy on every
run, restore the pre-candidate implementation and record the candidate as
rejected rather than retaining a more complex design.

- [ ] **Step 3: Run focused and full correctness tests.**

```bash
cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture
cargo test --manifest-path engine/core/Cargo.toml
```

Expected: all text output, provider selection, clipping, and DrawList golden
tests pass with unchanged checksums.

- [ ] **Step 4: Run the exact benchmark comparison.**

```bash
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Compare all three candidate samples with
`docs/bench/core-layout-scratch-baseline-2026-09-06.json`. Retain code only if
`avg_work_us` or `avg_render_us` improves by at least 3%, checksums match, and
arena/safe-arena and correctness do not regress. Otherwise revert all
production changes.

- [ ] **Step 5: Record and validate the decision.**

The receipt must include full provenance, candidate files, test commands,
per-sample metrics, max work, workload metadata, checksum arrays, memory scan,
derived threshold math, arena guardrails, and final status. Load the committed
baseline receipt from the receipt test and derive all comparisons; do not copy
baseline constants into the test.

```bash
bun test tests/core-frame-receipts.test.ts
git diff --check
```

- [ ] **Step 6: Commit the isolated result.**

```bash
git add engine/core/src/draw.rs engine/core/src/tests.rs docs/bench tests/core-frame-receipts.test.ts
git commit -m "perf(core): evaluate draw text scratch"
```

If production code was reverted, commit only the receipt and its tests with a
`test(core): record discarded draw scratch` message instead.

## Task 3: Evaluate 3D Collection Scratch

**Files:**
- Read: `engine/core/src/draw.rs:1350-1510`
- Modify only if safe: `engine/core/src/draw.rs`
- Add: a rejection or candidate receipt under `docs/bench/`
- Modify: `tests/core-frame-receipts.test.ts` for the receipt

- [ ] **Step 1: Inspect ownership and benchmark availability.**

Confirm whether `collect_3d` receives `items` and `tex_cells` from an owning
draw state or allocates them per frame. Confirm the benchmark registry still
rejects `motions`:

```bash
bun tools/bench-ppsspp.ts --apps=motions --samples=3 --memory-scan
```

Expected: `unknown app motions`. Do not substitute another workload or claim a
3D performance result.

- [ ] **Step 2: Add a focused ordering/checksum regression test before code.**

Use an existing perspective fixture to compare DrawList words and texture-cell
ordering across repeated draws. Run the focused test red if it specifically
depends on the proposed scratch owner; otherwise record that no safe testable
candidate exists and skip production code.

- [ ] **Step 3: Implement only an owner-local capacity reuse if safe.**

Reuse existing vectors only when their lifetime is bounded by one draw and no
recursive call can invalidate a borrow. Preserve stable insertion order and
all texture batching. Reject the candidate instead of introducing a pool,
unsafe aliasing, DrawList changes, or a public field when ownership is unclear.

- [ ] **Step 4: Measure or record an explicit unmeasured rejection.**

If a reproducible active 3D workload is unavailable, record status
`UNMEASURED` or `DISCARDED` with the blocker and do not retain production code.
If a safe candidate is measured on the stats workload, label that limitation
explicitly and apply the same 3% gate without claiming 3D coverage.

- [ ] **Step 5: Validate and commit the auditable result.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-frame-receipts.test.ts
git diff --check
```

Commit only the receipt/test changes or a qualifying core candidate using a
Conventional Commit message.

## Task 4: Evaluate Layout Rebuild Scratch

**Files:**
- Read: `engine/core/src/layout.rs:245-432`
- Modify only if safe: `engine/core/src/layout.rs`
- Test: `engine/core/src/tests.rs`
- Add: a receipt under `docs/bench/` when measured or rejected
- Modify: `tests/core-frame-receipts.test.ts` for the receipt

- [ ] **Step 1: Identify remaining structure-dirty allocations.**

Trace `surface_slots`, recursive `kids`, and text-run collection through
`build`. Reject any design that would borrow a reusable vector across recursive
calls, move data needed by a Taffy `MeasureCtx`, or require unsafe/global
storage.

- [ ] **Step 2: Add a failing layout equivalence test for any safe candidate.**

Compare rounded layout output and text provider state before and after repeated
structure relayout. Run the focused layout tests and verify the candidate
behavior is not already covered by existing code.

```bash
cargo test --manifest-path engine/core/Cargo.toml layout -- --nocapture
```

- [ ] **Step 3: Implement, test, and benchmark only the minimal safe change.**

Keep recursive ownership explicit and preserve primary/auxiliary root
independence. Run:

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan
```

Apply the same 3% timing, checksum, arena, safe-arena, and correctness gates.
Revert a non-qualifying production candidate.

- [ ] **Step 4: Record receipt evidence and commit.**

Use the canonical schema, baseline-linked tests, full sample/memory evidence,
and a truthful retained/discarded/rejected status. Commit only the isolated
result.

## Task 5: Final Verification

**Files:**
- Modify: only retained candidate files and receipt/test files
- Read: all new receipts and the implementation plan

- [ ] **Step 1: Run final verification.**

```bash
cargo test --manifest-path engine/core/Cargo.toml
bun test tests/core-frame-receipts.test.ts tests/core-memory-bench.test.ts tests/psp-bench-parser.test.ts tests/psp-bench.test.ts
git diff --check
git status --short --branch
```

Expected: 129 core tests, all requested Bun tests, clean diff check, and no
uncommitted production changes.

- [ ] **Step 2: Verify production scope and decisions.**

```bash
git diff --name-only 47288db..HEAD -- hosts/psp engine/core
```

Confirm every receipt has a baseline-linked decision, derived timing/checksum
and arena gates, complete provenance, and no unsupported 3D performance claim.

- [ ] **Step 3: Request final review and publish when permitted.**

Request a final code review covering all candidate commits. Attempt to publish a
draft pull request as required by repository instructions; if GitHub denies
permission, report the exact blocker without claiming publication.
