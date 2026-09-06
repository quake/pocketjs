import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const receipt = async (name: string) =>
  JSON.parse(await readFile(new URL(`../docs/bench/${name}`, import.meta.url), "utf8"));

const assertNoRetainedProductionCandidate = (value: Record<string, unknown>) => {
  expect(value.code_retained).toBe(false);
  expect(value.candidate_git_revision).toBeNull();
  expect(value.candidate_files).toEqual(
    expect.arrayContaining([expect.stringMatching(/^engine\/core\//)]),
  );
};

test("text discard receipt records uncommitted, unreproducible provenance", async () => {
  const value = await receipt("core-frame-task2-text-scratch-discarded-2026-09-06.json");

  expect(value.status).toBe("DISCARDED");
  assertNoRetainedProductionCandidate(value);
  expect(value.candidate_source).toBe("temporary uncommitted patch");
  expect(value.candidate_reproducibility).toBe("not independently reproducible");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.candidate_files).toEqual([
    "engine/core/src/draw.rs",
    "engine/core/src/tests.rs",
  ]);
  expect(value.candidate_test_commands).toEqual(expect.any(Array));
  expect(value.decision.threshold).toContain("3%");
  expect(value.decision.checksum_unchanged).toBe(true);
  expect(value.decision.arena_regression).toBe(false);
  expect(value.decision.reason).toContain("without a committed diff");
  expect(value.candidate_report_path).toBeNull();
  expect(value.comparison.avg_work_us.candidate).toEqual([4669, 4669, 4669]);
  expect(value.comparison.avg_render_us.candidate).toEqual([581, 581, 581]);
  expect(value.comparison.drawlist_checksum.candidate).toEqual([
    "c88e7bcedc5d42a5",
    "c88e7bcedc5d42a5",
    "c88e7bcedc5d42a5",
  ]);
});

test("3D receipt records the inactive motions workload blocker", async () => {
  const value = await receipt("core-frame-task3-3d-unmeasured-2026-09-06.json");

  expect(value.status).toBe("UNMEASURED");
  assertNoRetainedProductionCandidate(value);
  expect(value.error).toBe("unknown app motions");
  expect(value.reason).toContain("No active perspective workload");
  expect(value.reason).toContain("not retained");
});

test("layout scratch baseline records canonical provenance and measurements", async () => {
  const value = await receipt("core-layout-scratch-baseline-2026-09-06.json");

  expect(value.status).toBe("BASELINE");
  expect(value.plan).toBe("docs/superpowers/plans/2026-09-06-layout-scratch-optimizations.md");
  expect(value.git_revision).toMatch(/^[0-9a-f]{40}$/);
  expect(value.ppsspp_revision).toMatch(/^[0-9a-f]{40}$/);
  expect(value.toolchain.bun).toBe("1.3.13");
  expect(value.reproducibility.rust).toEqual({
    core_toolchain: "rustc 1.97.1 (8bab26f4f 2026-07-14)",
    core_rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
    cargo: "cargo 1.97.1 (c980f4866 2026-06-30)",
    psp_toolchain: "nightly-2026-05-28",
  });
  expect(value.reproducibility.psp_sdk).toEqual({
    PSP_SDK: null,
    identifier: null,
    note: "PSP_SDK and PSP_TOOLCHAIN were unset; no PSP SDK executable identifier was available.",
  });
  expect(value.stats.command).toBe("bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan");
  expect(value.stats.samples).toBe(3);
  expect(value.stats.metric_arrays.avg_work_us).toEqual([4682, 4682, 4682]);
  expect(value.stats.metric_arrays.max_work_us).toEqual([62672, 62672, 62672]);
  expect(value.stats.metric_arrays.avg_render_us).toEqual([581, 581, 581]);
  expect(value.stats.metric_arrays.arena_bump_bytes).toEqual([2649904, 2649904, 2649904]);
  expect(value.stats.sample_records).toEqual([
    expect.objectContaining({ sample: 1, frames: 100, window_start: 28, window_n: 100 }),
    expect.objectContaining({ sample: 2, frames: 100, window_start: 28, window_n: 100 }),
    expect.objectContaining({ sample: 3, frames: 100, window_start: 28, window_n: 100 }),
  ]);
  expect(value.stats.checksum).toBe("c88e7bcedc5d42a5");
  expect(value.stats.checksum_samples).toEqual([
    "c88e7bcedc5d42a5",
    "c88e7bcedc5d42a5",
    "c88e7bcedc5d42a5",
  ]);
  expect(value.stats.memory_scan.attempt_count).toBe(3);
  expect(value.stats.memory_scan.attempts).toHaveLength(3);
  expect(value.stats.report_path).toMatch(/^dist\/bench\/ppsspp-bench-.*\.json$/);
});
