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

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const assertBaselineComparison = (value: any, baseline: any) => {
  expect(value.baseline_receipt).toBe("docs/bench/core-layout-scratch-baseline-2026-09-06.json");
  expect(value.comparison.avg_work_us.baseline).toEqual(baseline.stats.metric_arrays.avg_work_us);
  expect(value.comparison.avg_render_us.baseline).toEqual(baseline.stats.metric_arrays.avg_render_us);
  expect(value.comparison.max_work_us.baseline).toEqual(baseline.stats.metric_arrays.max_work_us);
  expect(value.comparison.arena_bump_bytes.baseline).toEqual(baseline.stats.metric_arrays.arena_bump_bytes);
  expect(value.comparison.safe_arena_bytes.baseline).toBe(baseline.stats.safe_arena_bytes);
  expect(value.comparison.drawlist_checksum.baseline).toEqual(baseline.stats.checksum_samples);
};

const assertDiscardDecision = (value: any) => {
  const workImprovement =
    ((mean(value.comparison.avg_work_us.baseline) - mean(value.comparison.avg_work_us.candidate)) /
      mean(value.comparison.avg_work_us.baseline)) *
    100;
  const renderImprovement =
    ((mean(value.comparison.avg_render_us.baseline) - mean(value.comparison.avg_render_us.candidate)) /
      mean(value.comparison.avg_render_us.baseline)) *
    100;
  expect(workImprovement).toBeLessThan(3);
  expect(renderImprovement).toBeLessThan(3);
  expect(value.decision.avg_work_improvement_percent).toBeCloseTo(workImprovement, 4);
  expect(value.decision.avg_render_improvement_percent).toBeCloseTo(renderImprovement, 4);
  expect(value.decision.threshold_math.avg_work_baseline_mean_us).toBe(mean(value.comparison.avg_work_us.baseline));
  expect(value.decision.threshold_math.avg_work_candidate_mean_us).toBe(mean(value.comparison.avg_work_us.candidate));
  expect(value.decision.threshold_math.avg_work_improvement_percent).toBeCloseTo(workImprovement, 4);
  expect(value.decision.threshold_math.avg_render_baseline_mean_us).toBe(mean(value.comparison.avg_render_us.baseline));
  expect(value.decision.threshold_math.avg_render_candidate_mean_us).toBe(mean(value.comparison.avg_render_us.candidate));
  expect(value.decision.threshold_math.avg_render_improvement_percent).toBeCloseTo(renderImprovement, 4);
  expect(value.decision.threshold_math.required_improvement_percent).toBe(3);
};

test("text discard receipt records uncommitted, unreproducible provenance", async () => {
  const value = await receipt("core-frame-task2-text-scratch-discarded-2026-09-06.json");

  expect(value.status).toBe("DISCARDED");
  assertNoRetainedProductionCandidate(value);
  expect(value.candidate_source).toBe("temporary uncommitted patch");
  expect(value.candidate_reproducibility).toBe("not independently reproducible");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.candidate_files).toEqual(["engine/core/src/draw.rs", "engine/core/src/tests.rs"]);
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

  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("BASELINE");
  expect(value.plan).toBe("docs/superpowers/plans/2026-09-06-layout-scratch-optimizations.md");
  expect(value.git_revision).toBe("a03eda0f22a73e2b09491e9e3efb64b6009aa251");
  expect(value.ppsspp_revision).toBe("f929a74780b34bf8c1dfa9cf549bd9eb811e41aa");
  expect(value.toolchain.bun).toBe("1.3.13");
  expect(value.stats.workload).toEqual({
    app: "stats", psp_app: "stats-main", input_script: "0:0,84:0x20,88:0",
    cap_start: 28, cap_n: 100, framework: "solid",
  });
  expect(value.stats.metric_arrays.avg_work_us).toEqual([4682, 4682, 4682]);
  expect(value.stats.metric_arrays.avg_render_us).toEqual([581, 581, 581]);
  expect(value.stats.checksum).toBe("c88e7bcedc5d42a5");
  expect(value.stats.safe_arena_bytes).toBe(3670016);
  expect(value.stats.memory_scan.safe_arena_bytes).toBe(value.stats.safe_arena_bytes);
});

const assertCanonicalDiscardedReceipt = async (name: string, candidate: any, arenaRegression: boolean) => {
  const [value, baseline] = await Promise.all([
    receipt(name),
    receipt("core-layout-scratch-baseline-2026-09-06.json"),
  ]);
  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("DISCARDED");
  expect(value.plan).toBe(baseline.plan);
  expect(value.git_revision).toBeNull();
  expect(value.ppsspp_revision).toBe(baseline.ppsspp_revision);
  expect(value.toolchain).toEqual(baseline.toolchain);
  expect(value.stats).toEqual(expect.objectContaining({
    workload: baseline.stats.workload,
    samples: 3,
    metric_arrays: expect.objectContaining(candidate.metric_arrays),
    checksum: baseline.stats.checksum,
    checksum_samples: candidate.checksum_samples,
    safe_arena_bytes: candidate.safe_arena_bytes,
  }));
  assertNoRetainedProductionCandidate(value);
  assertBaselineComparison(value, baseline);
  expect(value.comparison.avg_work_us.candidate).toEqual(candidate.avg_work_us);
  expect(value.comparison.avg_render_us.candidate).toEqual(candidate.avg_render_us);
  expect(value.comparison.max_work_us.candidate).toEqual(candidate.max_work_us);
  expect(value.comparison.arena_bump_bytes.candidate).toEqual(candidate.arena_bump_bytes);
  expect(value.comparison.safe_arena_bytes.candidate).toBe(candidate.safe_arena_bytes);
  expect(value.comparison.drawlist_checksum.candidate).toEqual(candidate.checksum_samples);
  expect(value.decision.checksum_unchanged).toBe(true);
  expect(value.decision.arena_regression).toBe(arenaRegression);
  assertDiscardDecision(value);
  expect(value.candidate_report_path).toBeNull();
};

test("layout readback scratch discarded receipt uses the committed baseline", async () => {
  await assertCanonicalDiscardedReceipt(
    "core-layout-scratch-discarded-2026-09-06.json",
    {
      avg_work_us: [4679, 4679, 4679], avg_render_us: [581, 581, 581],
      max_work_us: [62640, 62640, 62640],
      arena_bump_bytes: [2649904, 2649904, 2649904], safe_arena_bytes: 3670016,
      checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"],
      metric_arrays: { avg_work_us: [4679, 4679, 4679], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649904, 2649904, 2649904] },
    },
    false,
  );
});

test("layout text scratch discarded receipt uses the committed baseline", async () => {
  await assertCanonicalDiscardedReceipt(
    "core-layout-scratch-task3-discarded-2026-09-06.json",
    {
      avg_work_us: [4682, 4682, 4682], avg_render_us: [581, 581, 581],
      max_work_us: [62655, 62655, 62655],
      arena_bump_bytes: [2649936, 2649936, 2649936], safe_arena_bytes: 3670016,
      checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"],
      metric_arrays: { avg_work_us: [4682, 4682, 4682], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649936, 2649936, 2649936] },
    },
    true,
  );
});
