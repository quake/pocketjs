# Dedicated Memory Workload Design

## Purpose

The standard `stats` workload does not exercise three candidate paths:

- `Ui::load_assets` staging of large asset groups;
- tileset upload and rendering;
- PSP fallback glyph rendering when a cached font texture cannot be built.

Add isolated workloads for these paths before evaluating further optimizations.
The existing `stats` workload and its canonical receipts remain unchanged.

## Scope

This change adds benchmark inputs, workload execution, receipts, and tests. It
does not change production allocation or rendering behavior before a workload
proves that a candidate is relevant.

## Workloads

### Host asset workload

Extend the host memory benchmark with a named asset-heavy scenario. It will
construct deterministic styles, font, image, and sprite blobs, then call
`Ui::load_assets` with one complete asset group while allocation measurement is
enabled.

The workload will report the same allocator fields as the existing benchmark:

- peak requested bytes;
- final requested bytes;
- allocation count;
- total allocated bytes;
- deterministic resource/checksum validation where available.

The asset workload receipt is separate from
`docs/bench/core-memory-2026-09-05.json`. Its inputs must be fixed-size and
generated in the benchmark so the result does not depend on repository image
files or host filesystem state.

### PSP tileset workload

Add a PSP benchmark app/spec that uploads and renders a deterministic set of
tile textures through the normal app asset path. The scenario must perform the
upload during boot and draw enough tile content during steady frames to ensure
the tileset upload path is not dead code.

The runner will use the existing JSONL protocol and report:

- arena bump and safe arena;
- average and maximum work;
- average render time;
- deterministic drawlist checksum;
- bundle and package sizes when applicable.

The workload will have its own receipt and will not change the existing
`stats/solid` baseline.

### PSP fallback glyph workload

Add a PSP benchmark scenario that deterministically reaches the fallback glyph
path in `hosts/psp/src/ge.rs`. The scenario must first be verified by an
explicit runtime counter or equivalent benchmark-only marker; a changed timing
number alone is not evidence that fallback rendering ran.

Once the path is confirmed, remove or disable the marker for the measured
receipt if it changes timing. The receipt records the same PSP metrics as the
tileset workload plus a path-activation check captured separately from the
canonical drawlist checksum.

## Measurement Protocol

For each workload:

1. Run the unmodified baseline with at least three samples.
2. Confirm the intended path is exercised and the checksum is stable.
3. Apply one candidate change only.
4. Run the same command and sample count.
5. Keep a candidate only when it improves the target metric without a material
   regression in work, render time, arena, checksum, or correctness.

Host allocation count and total allocated bytes are secondary indicators; peak
requested bytes is the primary host memory metric. PSP safe arena and average
work are the primary device metrics, with average render time as a guardrail.

## Candidate Evaluation

Evaluate candidates independently:

- asset staging: reduce host peak during `load_assets` without breaking atomic
  installation or error rollback;
- tileset upload: reduce temporary upload allocation or PSP arena usage;
- fallback glyph scan: reduce duplicate coverage scanning without changing
  glyph output or checksum.

Discard a candidate when the intended path is not activated, when the result is
within measurement noise without a memory benefit, or when any correctness or
rendering guardrail regresses.

## Tests and Artifacts

- Existing core tests and benchmark tests must continue to pass.
- Add deterministic unit coverage for any new workload blob builders or path
  activation markers.
- Store new receipts under `docs/bench/` with names identifying the workload;
  do not overwrite the standard `stats` or core baseline receipts.
- Run `git diff --check` and the relevant host/PSP benchmark commands before
  considering the workload implementation complete.

## Non-Goals

- No production optimization is included in this design change.
- No change to the standard `stats` workload.
- No attempt to infer fallback activation from timing alone.
- No use of device-specific button concepts in app input scripts.
