# Core Frame Optimization Design

## Goal

Evaluate two small `engine/core` changes that can reduce per-frame work for all
hosts without changing PSP or other host renderer code:

- reuse the text-run `String` scratch buffer;
- stop cloning the child-id vector in 3D paint collection.

Only a candidate that improves average `avg_work_us` or `avg_render_us` by at
least **3%** is retained. Stable drawlist checksums and memory guardrails are
required for every retained change.

## Scope

Production changes are limited to `engine/core`. Benchmark changes may add or
extend host-independent workloads and receipts, but no host renderer or core
API changes are allowed. Candidate experiments are independent; a failed
candidate is reverted before the next candidate starts.

## Candidate 1: Reuse Text Scratch

`Ui::emit_text` currently creates a new `String` for each text node during each
draw. Add a reusable `text_run_scratch: String` field to the core draw state.
Take the buffer at the start of text emission, clear it, collect the text run,
and return it to the core after both baked-glyph and native-text paths,
including early-return paths.

The implementation must preserve:

- concatenation of the node's text descendants;
- native text measurement and `TEXT_RUN` bytes;
- baked glyph layout and `GLYPH_RUN` words;
- recursive draw behavior and deterministic drawlist output.

The scratch buffer must not be borrowed across another mutable draw operation.
Use ownership transfer or a small helper guard rather than unsafe aliasing.

## Candidate 2: Avoid 3D Child Clone

`Ui::paint_3d` currently clones `root.children` before traversing it. The
collection callback only needs an immutable child-id iteration, so traverse the
existing child slice directly while borrowing the root. Do not change child
ordering, node resolution, painter sorting, clipping, or emitted drawlist
format.

This candidate is evaluated with a perspective workload because ordinary 2D
screens may never enter `paint_3d`.

## Measurement

For each candidate:

1. Run the matching baseline workload with at least three samples.
2. Confirm a stable drawlist checksum.
3. Apply only that candidate.
4. Run the same command and sample count.
5. Retain only a result with at least 3% improvement in average work or render
   time, unchanged checksum, no correctness failure, and no material memory
   regression.

Use the existing stats workload for the text candidate and a deterministic
perspective workload for the 3D candidate. If stats does not contain enough
text or the 3D path is not activated, add a small benchmark-only core workload
rather than drawing conclusions from an inactive path.

Host-specific timings are evidence only; the production changes must remain in
`engine/core` and must not depend on a host backend.

## Testing

- Add unit coverage for scratch reuse and exact drawlist equivalence where the
  relevant helpers are accessible.
- Keep existing core tests and canonical drawlist checksums unchanged.
- Run `cargo test --manifest-path engine/core/Cargo.toml` after every candidate.
- Run the matching three-sample benchmark before deciding to keep or discard a
  candidate.
- Run `git diff --check` and the relevant Bun benchmark parser tests before
  completion.

## Non-Goals

- No PSP GE state caching or renderer-specific optimization.
- No change to the DrawList wire format or public `Ui` API.
- No threshold below 3% is sufficient for retention.
- No optimization is retained solely because it reduces allocation count if
  frame work/render time does not meet the threshold.
