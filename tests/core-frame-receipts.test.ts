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
const baselineReceiptName = "docs/bench/core-layout-scratch-baseline-2026-09-06.json";
const coreFrameBaselineReceiptName = "docs/bench/core-frame-baseline-2026-09-06.json";

const assertBaselineComparison = (value: any, baseline: any) => {
  expect(value.baseline_receipt).toBe(baselineReceiptName);
  expect(value.baseline_git_revision).toBe(baseline.git_revision);
  expect(value.comparison.avg_work_us.baseline).toEqual(baseline.stats.metric_arrays.avg_work_us);
  expect(value.comparison.avg_render_us.baseline).toEqual(baseline.stats.metric_arrays.avg_render_us);
  expect(value.comparison.max_work_us.baseline).toEqual(baseline.stats.metric_arrays.max_work_us);
  expect(value.comparison.arena_bump_bytes.baseline).toEqual(baseline.stats.metric_arrays.arena_bump_bytes);
  expect(value.comparison.safe_arena_bytes.baseline).toBe(baseline.stats.safe_arena_bytes);
  expect(value.comparison.drawlist_checksum.baseline).toEqual(baseline.stats.checksum_samples);
};

const assertStatsEvidence = (stats: any, expected: any) => {
  expect(stats.command).toBe("bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan");
  expect(stats.active_path).toBe("text workload; apps/stats/app.tsx renders Text nodes");
  expect(stats.samples).toBe(3);
  expect(stats.workload).toEqual({
    app: "stats", psp_app: "stats-main", input_script: "0:0,84:0x20,88:0",
    cap_start: 28, cap_n: 100, framework: "solid",
  });
  expect(stats.sample_records).toEqual([
    { sample: 1, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: expected.avg_work_us[0], max_work_us: expected.max_work_us[0], avg_render_us: expected.avg_render_us[0], arena_bump_bytes: expected.arena_bump_bytes[0], drawlist_checksum: expected.checksum_samples[0] },
    { sample: 2, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: expected.avg_work_us[1], max_work_us: expected.max_work_us[1], avg_render_us: expected.avg_render_us[1], arena_bump_bytes: expected.arena_bump_bytes[1], drawlist_checksum: expected.checksum_samples[1] },
    { sample: 3, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: expected.avg_work_us[2], max_work_us: expected.max_work_us[2], avg_render_us: expected.avg_render_us[2], arena_bump_bytes: expected.arena_bump_bytes[2], drawlist_checksum: expected.checksum_samples[2] },
  ]);
  expect(stats.metric_arrays).toEqual({
    frames: [100, 100, 100], window_start: [28, 28, 28], window_n: [100, 100, 100],
    avg_work_us: expected.avg_work_us, max_work_us: expected.max_work_us,
    avg_render_us: expected.avg_render_us, arena_bump_bytes: expected.arena_bump_bytes,
    drawlist_checksum: expected.checksum_samples,
  });
  expect(stats.checksum).toBe(expected.checksum);
  expect(stats.checksum_samples).toEqual(expected.checksum_samples);
  expect(stats.safe_arena_bytes).toBe(expected.safe_arena_bytes);
  expect(stats.memory_scan).toEqual(expected.memory_scan);
  expect(stats.report_path).toBe(expected.report_path);
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
  const [value, baseline] = await Promise.all([
    receipt("core-frame-task2-text-scratch-discarded-2026-09-06.json"),
    receipt("core-frame-baseline-2026-09-06.json"),
  ]);

  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("DISCARDED");
  expect(value.plan).toBe(baseline.plan);
  expect(value.baseline_receipt).toBe(coreFrameBaselineReceiptName);
  expect(value.baseline_git_revision).toBe(baseline.git_revision);
  expect(value.ppsspp_revision).toBe(baseline.ppsspp_revision);
  expect(value.toolchain).toEqual(baseline.toolchain);
  assertNoRetainedProductionCandidate(value);
  expect(value.candidate_source).toBe("temporary uncommitted patch");
  expect(value.candidate_reproducibility).toBe("not independently reproducible");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.candidate_files).toEqual(["engine/core/src/draw.rs", "engine/core/src/tests.rs"]);
  expect(value.candidate_test_commands).toEqual(expect.any(Array));
  expect(value.command).toBe(baseline.stats.command);
  expect(value.workload).toEqual(expect.objectContaining({
    app: baseline.stats.workload.app,
    framework: baseline.stats.workload.framework,
    samples: baseline.stats.samples,
    frames: baseline.stats.sample_records[0].frames,
    window_start: baseline.stats.sample_records[0].window_start,
    window_n: baseline.stats.sample_records[0].window_n,
  }));
  expect(value.decision.threshold).toContain("3%");
  expect(value.decision.reason).toContain("without a committed diff");
  expect(value.candidate_report_path).toBeNull();
  expect(value.comparison.avg_work_us.baseline).toEqual(baseline.stats.metric_arrays.avg_work_us);
  expect(value.comparison.avg_render_us.baseline).toEqual(baseline.stats.metric_arrays.avg_render_us);
  expect(value.comparison.max_work_us.baseline).toEqual(baseline.stats.metric_arrays.max_work_us);
  expect(value.comparison.arena_bump_bytes.baseline).toEqual(baseline.stats.metric_arrays.arena_bump_bytes);
  expect(value.comparison.safe_arena_bytes.baseline).toBe(baseline.stats.safe_arena_bytes);
  expect(value.comparison.drawlist_checksum.baseline).toEqual(baseline.stats.checksum_samples);
  expect(value.comparison.avg_work_us.candidate).toEqual([4669, 4669, 4669]);
  expect(value.comparison.avg_render_us.candidate).toEqual([581, 581, 581]);
  expect(value.comparison.max_work_us.candidate).toEqual([62643, 62643, 62643]);
  expect(value.comparison.arena_bump_bytes.candidate).toEqual([2649936, 2649936, 2649936]);
  expect(value.comparison.safe_arena_bytes.candidate).toBe(3670016);
  expect(value.comparison.drawlist_checksum.candidate).toEqual(baseline.stats.checksum_samples);
  expect(value.memory_scan).toEqual({
    uncapped_arena_bump_bytes: 2649936,
    min_pass_arena_bytes: 2883584,
    safe_arena_bytes: 3670016,
    attempts: [
      { arena_bytes: 2883584, pass: true, avg_work_us: 4669, arena_bump_bytes: 2649936 },
      { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" },
      { arena_bytes: 3670016, pass: true, avg_work_us: 4669, arena_bump_bytes: 2649936 },
    ],
  });
  const checksumUnchanged = value.comparison.drawlist_checksum.candidate.every(
    (checksum: string, index: number) => checksum === value.comparison.drawlist_checksum.baseline[index],
  );
  expect(value.decision.checksum_unchanged).toBe(checksumUnchanged);
  expect(value.decision.arena_regression).toBe(false);
});

test("3D receipt records the inactive motions workload blocker", async () => {
  const [value, baseline] = await Promise.all([
    receipt("core-frame-task3-3d-unmeasured-2026-09-06.json"),
    receipt("core-frame-baseline-2026-09-06.json"),
  ]);

  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("UNMEASURED");
  expect(value.plan).toBe(baseline.plan);
  expect(value.baseline_receipt).toBe(coreFrameBaselineReceiptName);
  expect(value.baseline_git_revision).toBe(baseline.git_revision);
  expect(value.ppsspp_revision).toBe(baseline.ppsspp_revision);
  expect(value.toolchain.bun).toBe(baseline.toolchain.bun);
  expect(value.reproducibility.benchmark_git_revision).toBe(value.git_revision);
  expect(value.candidate).toBe("owner-local paint_3d items and tex_cells capacity reuse");
  assertNoRetainedProductionCandidate(value);
  expect(value.candidate_source).toContain("ownership inspection only");
  expect(value.candidate_reproducibility).toContain("rejected before implementation");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.ownership_review).toEqual(expect.objectContaining({
    unsafe: false,
    decision: expect.stringContaining("REJECTED WITHOUT PRODUCTION CODE"),
  }));
  expect(value.tdd).toEqual({
    status: "NOT APPLICABLE",
    reason: "No concrete production candidate was implemented, so no focused perspective ordering/checksum regression test was needed.",
    red: null,
    green: null,
  });
  expect(value.candidate_test_commands).toContain("bun tools/bench-ppsspp.ts --apps=motions --samples=3 --memory-scan");
  expect(value.workload).toEqual({ app: "motions", framework: "solid", samples: 3, perspective_active: false });
  expect(value.decision).toEqual({
    status: "REJECTED",
    reason: "Ownership is safe for local use, but Walker is recreated per build_root and the required motions workload is unavailable. No 3D timing, memory, or checksum claim can be made, so no production code is retained.",
    timing_claim: null,
    memory_claim: null,
    checksum_claim: null,
  });
  expect(value.blocker.substitute_workload_used).toBe(false);
  expect(value.error).toBe("unknown app motions");
  expect(value.reason).toContain("No active perspective workload");
});

test("layout scratch baseline records canonical provenance and measurements", async () => {
  const value = await receipt("core-layout-scratch-baseline-2026-09-06.json");

  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("BASELINE");
  expect(value.plan).toBe("docs/superpowers/plans/2026-09-06-layout-scratch-optimizations.md");
  expect(value.git_revision).toBe("a03eda0f22a73e2b09491e9e3efb64b6009aa251");
  expect(value.ppsspp_revision).toBe("f929a74780b34bf8c1dfa9cf549bd9eb811e41aa");
  expect(value.toolchain.bun).toBe("1.3.13");
  expect(value.reproducibility).toEqual({
    benchmark_git_revision: value.git_revision,
    ppsspp: {
      revision: value.ppsspp_revision,
      headless_path: "/Users/quake/ppsspp-src/build/PPSSPPHeadless",
      build_identifier: "f929a74",
    },
    rust: {
      core_toolchain: "rustc 1.97.1 (8bab26f4f 2026-07-14)",
      core_rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
      cargo: "cargo 1.97.1 (c980f4866 2026-06-30)",
      psp_toolchain: "nightly-2026-05-28",
    },
    psp_sdk: {
      PSP_SDK: null, identifier: null,
      note: "PSP_SDK and PSP_TOOLCHAIN were unset; no PSP SDK executable identifier was available.",
    },
    benchmark_flags: {
      frameworks: ["solid"], samples: 3, memory_scan: true, timeout_seconds: 60,
      bootstrap_iterations: 0, frame_budget_us: 16667, memory_step_bytes: 262144,
      memory_safety_floor_bytes: 524288, memory_safety_percent: 20, memory_max_bytes: 33554432,
    },
  });
  assertStatsEvidence(value.stats, {
    avg_work_us: [4682, 4682, 4682], max_work_us: [62672, 62672, 62672], avg_render_us: [581, 581, 581],
    arena_bump_bytes: [2649904, 2649904, 2649904], checksum: "c88e7bcedc5d42a5",
    checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"], safe_arena_bytes: 3670016,
    memory_scan: value.stats.memory_scan, report_path: "dist/bench/ppsspp-bench-2026-09-06T02-59-52-912Z.json",
  });
  expect(value.stats.memory_scan).toEqual({
    uncapped_arena_bump_bytes: 2649904, min_pass_arena_bytes: 2883584, safety_margin_bytes: 576717,
    safe_arena_bytes: 3670016, attempt_count: 3,
    attempts: [
      { arena_bytes: 2883584, pass: true, avg_work_us: 4682, arena_bump_bytes: 2649904 },
      { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" },
      { arena_bytes: 3670016, pass: true, avg_work_us: 4682, arena_bump_bytes: 2649904 },
    ],
  });
});

const assertCanonicalDiscardedReceipt = async (name: string, candidate: any) => {
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
  expect(value.reproducibility).toEqual(candidate.reproducibility);
  expect(value.baseline_git_revision).toBe(baseline.git_revision);
  expect(value.candidate).toBe(candidate.name);
  expect(value.candidate_source).toBe("temporary uncommitted patch");
  expect(value.candidate_reproducibility).toBe("not independently reproducible");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.candidate_provenance_reason).toBe(candidate.provenance_reason);
  expect(value.candidate_files).toEqual(["engine/core/src/layout.rs", "engine/core/src/tests.rs"]);
  expect(value.code_retained).toBe(false);
  expect(value.candidate_git_revision).toBeNull();
  expect(value.workload).toEqual(candidate.workload);
  expect(value.tdd).toEqual(candidate.tdd);
  expect(value.ownership_review).toEqual(candidate.ownership_review);
  expect(value.candidate_test_commands).toEqual(candidate.test_commands);
  assertStatsEvidence(value.stats, candidate.stats);
  assertNoRetainedProductionCandidate(value);
  assertBaselineComparison(value, baseline);
  expect(value.comparison.avg_work_us.candidate).toEqual(candidate.avg_work_us);
  expect(value.comparison.avg_render_us.candidate).toEqual(candidate.avg_render_us);
  expect(value.comparison.max_work_us.candidate).toEqual(candidate.max_work_us);
  expect(value.comparison.arena_bump_bytes.candidate).toEqual(candidate.arena_bump_bytes);
  expect(value.comparison.safe_arena_bytes.candidate).toBe(candidate.safe_arena_bytes);
  expect(value.comparison.drawlist_checksum.candidate).toEqual(candidate.checksum_samples);
  const checksumUnchanged = value.comparison.drawlist_checksum.candidate.every(
    (checksum: string, index: number) => checksum === value.comparison.drawlist_checksum.baseline[index],
  );
  expect(value.decision.checksum_unchanged).toBe(checksumUnchanged);
  expect(value.decision.arena_regression).toBe(
    mean(value.comparison.arena_bump_bytes.candidate) > mean(value.comparison.arena_bump_bytes.baseline),
  );
  assertDiscardDecision(value);
  expect(value.candidate_report_path).toBeNull();
  expect(value.candidate_report_status).toBe(candidate.report_status);
  expect(value.decision.reason).toBe(candidate.reason);
  expect(value.decision.threshold).toBe("at least 3% improvement in avg_work_us or avg_render_us");
  expect(value.decision.safe_arena_regression).toBe(
    value.comparison.safe_arena_bytes.candidate > value.comparison.safe_arena_bytes.baseline,
  );
  expect(value.decision.max_work_regression).toBe(
    mean(value.comparison.max_work_us.candidate) > mean(value.comparison.max_work_us.baseline),
  );
};

test("layout readback scratch discarded receipt uses the committed baseline", async () => {
  await assertCanonicalDiscardedReceipt(
    "core-layout-scratch-discarded-2026-09-06.json",
    {
      name: "Task 2 reusable layout readback slot scratch",
      provenance_reason: "The candidate was reverted because neither timing metric met the 3% gate; its uncommitted production patch has no independently reproducible revision or artifact.",
      avg_work_us: [4679, 4679, 4679], avg_render_us: [581, 581, 581],
      max_work_us: [62640, 62640, 62640],
      arena_bump_bytes: [2649904, 2649904, 2649904], safe_arena_bytes: 3670016,
      checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"],
      metric_arrays: { avg_work_us: [4679, 4679, 4679], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649904, 2649904, 2649904] },
      checksum: "c88e7bcedc5d42a5",
      workload: { app: "stats", psp_app: "stats-main", framework: "solid", input_script: "0:0,84:0x20,88:0", samples: 3, frames: 100, window_start: 28, window_n: 100 },
      reproducibility: {
        benchmark_git_revision: "a03eda0f22a73e2b09491e9e3efb64b6009aa251",
        ppsspp: { revision: "f929a74780b34bf8c1dfa9cf549bd9eb811e41aa", headless_path: null, build_identifier: null },
        rust: { core_toolchain: null, core_rustc_commit: null, cargo: null, psp_toolchain: null },
        psp_sdk: { PSP_SDK: null, identifier: null, note: null },
        benchmark_flags: { frameworks: ["solid"], samples: 3, memory_scan: true, timeout_seconds: null, bootstrap_iterations: null, frame_budget_us: null, memory_step_bytes: null, memory_safety_floor_bytes: null, memory_safety_percent: null, memory_max_bytes: null },
      },
      tdd: { focused_command: "cargo test --manifest-path engine/core/Cargo.toml readback_scratch_preserves_primary_and_auxiliary_rounded_layouts", red: { result: "FAIL", reason: "missing readback scratch field/helper" }, green: { result: "PASS", tests: 1, before_benchmark_discard: true } },
      ownership_review: undefined,
      test_commands: ["cargo test --manifest-path engine/core/Cargo.toml readback_scratch_preserves_primary_and_auxiliary_rounded_layouts", "cargo test --manifest-path engine/core/Cargo.toml", "bun test tests/core-frame-receipts.test.ts", "bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan", "git diff --check"],
      stats: { avg_work_us: [4679, 4679, 4679], max_work_us: [62640, 62640, 62640], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649904, 2649904, 2649904], checksum: "c88e7bcedc5d42a5", checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"], safe_arena_bytes: 3670016, memory_scan: { uncapped_arena_bump_bytes: 2649904, min_pass_arena_bytes: 2883584, safety_margin_bytes: 576717, safe_arena_bytes: 3670016, attempt_count: 3, attempts: [{ arena_bytes: 2883584, pass: true, avg_work_us: 4679, arena_bump_bytes: 2649904 }, { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" }, { arena_bytes: 3670016, pass: true, avg_work_us: 4679, arena_bump_bytes: 2649904 }] }, report_path: "dist/bench/ppsspp-bench-2026-09-06T03-15-39-526Z.json" },
      report_status: "not retained; metrics preserved in this receipt",
      reason: "Neither timing metric met the 3% improvement gate; the temporary candidate patch was reverted without a committed diff.",
    },
  );
});

test("layout text scratch discarded receipt uses the committed baseline", async () => {
  await assertCanonicalDiscardedReceipt(
    "core-layout-scratch-task3-discarded-2026-09-06.json",
    {
      name: "Task 3 reusable layout text-run scratch",
      provenance_reason: "The candidate was safe by ownership inspection but was discarded because neither timing metric met the 3% gate and the reusable String increased arena high-water by 32 bytes. The uncommitted production patch and test were reverted, so no independently reproducible candidate revision or patch artifact exists.",
      avg_work_us: [4682, 4682, 4682], avg_render_us: [581, 581, 581],
      max_work_us: [62655, 62655, 62655],
      arena_bump_bytes: [2649936, 2649936, 2649936], safe_arena_bytes: 3670016,
      checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"],
      metric_arrays: { avg_work_us: [4682, 4682, 4682], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649936, 2649936, 2649936] },
      checksum: "c88e7bcedc5d42a5",
      workload: { app: "stats", psp_app: "stats-main", framework: "solid", input_script: "0:0,84:0x20,88:0", samples: 3, frames: 100, window_start: 28, window_n: 100 },
      reproducibility: {
        benchmark_git_revision: "810a9b1e202e606e0a4ef0fc0189dcb1046b4ccb",
        ppsspp: { revision: "f929a74780b34bf8c1dfa9cf549bd9eb811e41aa", headless_path: "/Users/quake/ppsspp-src/build/PPSSPPHeadless", build_identifier: "f929a74" },
        rust: { core_toolchain: "rustc 1.97.1 (8bab26f4f 2026-07-14)", core_rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452", cargo: "cargo 1.97.1 (c980f4866 2026-06-30)", psp_toolchain: "nightly-2026-05-28" },
        psp_sdk: { PSP_SDK: null, identifier: null, note: "PSP_SDK and PSP_TOOLCHAIN were unset; no PSP SDK executable identifier was available." },
        benchmark_flags: { frameworks: ["solid"], samples: 3, memory_scan: true, timeout_seconds: 60, bootstrap_iterations: 0, frame_budget_us: 16667, memory_step_bytes: 262144, memory_safety_floor_bytes: 524288, memory_safety_percent: 20, memory_max_bytes: 33554432 },
      },
      tdd: { focused_command: "cargo test --manifest-path engine/core/Cargo.toml repeated_text_relayouts_preserve_measurement_provider_and_drawlist", red: { result: "FAIL", reason: "missing LayoutEngine::run_scratch field" }, green: { result: "PASS", tests: 1, before_benchmark_discard: true }, test_behavior: ["measured layout width and height remained (30.0, 12.0)", "text_native remained true", "DrawList checksum remained identical across three repeated relayouts"] },
      ownership_review: { measure_ctx_owns_measurement_data: true, taffy_context_borrows_scratch: false, rejected_constraints: [], decision: "SAFE" },
      test_commands: ["cargo test --manifest-path engine/core/Cargo.toml repeated_text_relayouts_preserve_measurement_provider_and_drawlist", "cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture", "cargo test --manifest-path engine/core/Cargo.toml", "bun test tests/core-frame-receipts.test.ts", "bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan", "git diff --check"],
      stats: { avg_work_us: [4682, 4682, 4682], max_work_us: [62655, 62655, 62655], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649936, 2649936, 2649936], checksum: "c88e7bcedc5d42a5", checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"], safe_arena_bytes: 3670016, memory_scan: { uncapped_arena_bump_bytes: 2649936, min_pass_arena_bytes: 2883584, safety_margin_bytes: 576717, safe_arena_bytes: 3670016, attempt_count: 3, attempts: [{ arena_bytes: 2883584, pass: true, avg_work_us: 4682, arena_bump_bytes: 2649936 }, { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" }, { arena_bytes: 3670016, pass: true, avg_work_us: 4682, arena_bump_bytes: 2649936 }] }, report_path: "dist/bench/ppsspp-bench-2026-09-06T03-31-57-880Z.json" },
      report_status: "unavailable; measured values are preserved in this receipt",
      reason: "Neither timing metric met the 3% improvement gate; the drawlist checksum and safe arena were unchanged, but arena high-water increased from 2649904 to 2649936 bytes. The temporary candidate patch was reverted without a committed diff.",
    },
  );
});

test("Draw text scratch receipt links every gate to the committed baseline", async () => {
  const [value, baseline] = await Promise.all([
    receipt("core-layout-scratch-task2-text-discarded-2026-09-06.json"),
    receipt("core-layout-scratch-baseline-2026-09-06.json"),
  ]);
  expect(value.schema_version).toBe(1);
  expect(value.status).toBe("DISCARDED");
  expect(value.plan).toBe("docs/superpowers/plans/2026-09-06-core-frame-optimization-candidates.md");
  expect(value.git_revision).toBeNull();
  expect(value.baseline_receipt).toBe(baselineReceiptName);
  expect(value.baseline_git_revision).toBe(baseline.git_revision);
  expect(value.ppsspp_revision).toBe("f929a74780b34bf8c1dfa9cf549bd9eb811e41aa");
  expect(value.toolchain).toEqual({ bun: "1.3.13" });
  expect(value.reproducibility).toEqual({
    benchmark_git_revision: "c834ccb7a7433242fc43a76298ad62b397cb7f1e",
    ppsspp: {
      revision: "f929a74780b34bf8c1dfa9cf549bd9eb811e41aa",
      headless_path: "/Users/quake/ppsspp-src/build/PPSSPPHeadless",
      build_identifier: "f929a74",
    },
    rust: {
      core_toolchain: "rustc 1.97.1 (8bab26f4f 2026-07-14)",
      core_rustc_commit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
      cargo: "cargo 1.97.1 (c980f4866 2026-06-30)",
      psp_toolchain: "nightly-2026-05-28",
    },
    psp_sdk: {
      PSP_SDK: null,
      identifier: null,
      note: "PSP_SDK and PSP_TOOLCHAIN were unset; no PSP SDK executable identifier was available.",
    },
    benchmark_flags: {
      frameworks: ["solid"], samples: 3, memory_scan: true, timeout_seconds: 60,
      bootstrap_iterations: 0, frame_budget_us: 16667, memory_step_bytes: 262144,
      memory_safety_floor_bytes: 524288, memory_safety_percent: 20, memory_max_bytes: 33554432,
    },
  });
  expect(value.candidate).toBe("Task 2 private Draw walker text-run scratch");
  expect(value.candidate_git_revision).toBeNull();
  expect(value.code_retained).toBe(false);
  expect(value.candidate_files).toEqual(["engine/core/src/draw.rs", "engine/core/src/tests.rs"]);
  expect(value.candidate_source).toBe("temporary uncommitted patch");
  expect(value.candidate_reproducibility).toBe("not independently reproducible");
  expect(value.candidate_patch_artifact).toBeNull();
  expect(value.candidate_provenance_reason).toBe("The candidate was reverted because neither timing metric met the 3% gate. Its uncommitted production patch has no independently reproducible revision or artifact.");
  expect(value.candidate_report_path).toBeNull();
  expect(value.candidate_report_status).toBe("not retained; measured values are preserved in this receipt");
  expect(value.candidate_test_commands).toEqual([
    "cargo test --manifest-path engine/core/Cargo.toml reused_text_run_scratch_preserves_output_and_checksum",
    "cargo test --manifest-path engine/core/Cargo.toml text -- --nocapture",
    "cargo test --manifest-path engine/core/Cargo.toml",
    "bun test tests/core-frame-receipts.test.ts",
    "bun tools/bench-ppsspp.ts --apps=stats --samples=3 --memory-scan",
    "git diff --check",
  ]);
  expect(value.tdd).toEqual({
    focused_command: "cargo test --manifest-path engine/core/Cargo.toml reused_text_run_scratch_preserves_output_and_checksum",
    red: { result: "FAIL", reason: "missing Walker::run_scratch field; after correcting fixture casts, no unrelated errors remained" },
    green: { result: "PASS", tests: 1, before_benchmark_discard: true },
    test_behavior: ["native TEXT_RUN output was non-empty", "repeated output words were byte-identical", "repeated output checksums were identical", "scratch capacity was reused"],
  });
  expect(value.ownership_review).toEqual({
    native_run_borrowed: true, baked_run_borrowed: true, long_lived_borrow: false,
    unsafe: false, decision: "SAFE; rejected by benchmark gate",
  });
  assertBaselineComparison(value, baseline);
  expect(value.workload).toEqual({ app: "stats", psp_app: "stats-main", framework: "solid", input_script: "0:0,84:0x20,88:0", samples: 3, frames: 100, window_start: 28, window_n: 100 });
  expect(value.stats.workload).toEqual({ app: "stats", psp_app: "stats-main", input_script: "0:0,84:0x20,88:0", cap_start: 28, cap_n: 100, framework: "solid" });
  assertStatsEvidence(value.stats, {
    avg_work_us: [4670, 4670, 4670], max_work_us: [62661, 62661, 62661], avg_render_us: [581, 581, 581],
    arena_bump_bytes: [2649904, 2649904, 2649904], checksum: "c88e7bcedc5d42a5",
    checksum_samples: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"], safe_arena_bytes: 3670016,
    memory_scan: { uncapped_arena_bump_bytes: 2649904, min_pass_arena_bytes: 2883584, safety_margin_bytes: 576717, safe_arena_bytes: 3670016, attempt_count: 3, attempts: [
      { arena_bytes: 2883584, pass: true, avg_work_us: 4670, arena_bump_bytes: 2649904 },
      { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" },
      { arena_bytes: 3670016, pass: true, avg_work_us: 4670, arena_bump_bytes: 2649904 },
    ] }, report_path: "dist/bench/ppsspp-bench-2026-09-06T04-25-58-293Z.json",
  });
  expect(value.stats.sample_records).toEqual([
    { sample: 1, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: 4670, max_work_us: 62661, avg_render_us: 581, arena_bump_bytes: 2649904, drawlist_checksum: "c88e7bcedc5d42a5" },
    { sample: 2, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: 4670, max_work_us: 62661, avg_render_us: 581, arena_bump_bytes: 2649904, drawlist_checksum: "c88e7bcedc5d42a5" },
    { sample: 3, sim_hz: 60, frames: 100, window_start: 28, window_n: 100, avg_work_us: 4670, max_work_us: 62661, avg_render_us: 581, arena_bump_bytes: 2649904, drawlist_checksum: "c88e7bcedc5d42a5" },
  ]);
  expect(value.stats.metric_arrays).toEqual({ frames: [100, 100, 100], window_start: [28, 28, 28], window_n: [100, 100, 100], avg_work_us: [4670, 4670, 4670], max_work_us: [62661, 62661, 62661], avg_render_us: [581, 581, 581], arena_bump_bytes: [2649904, 2649904, 2649904], drawlist_checksum: ["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"] });
  expect(value.stats.checksum).toBe("c88e7bcedc5d42a5");
  expect(value.stats.checksum_samples).toEqual(["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"]);
  expect(value.stats.safe_arena_bytes).toBe(3670016);
  expect(value.stats.memory_scan).toEqual({ uncapped_arena_bump_bytes: 2649904, min_pass_arena_bytes: 2883584, safety_margin_bytes: 576717, safe_arena_bytes: 3670016, attempt_count: 3, attempts: [
    { arena_bytes: 2883584, pass: true, avg_work_us: 4670, arena_bump_bytes: 2649904 },
    { arena_bytes: 2621440, pass: false, error: "below uncapped high-water 2.53 MiB" },
    { arena_bytes: 3670016, pass: true, avg_work_us: 4670, arena_bump_bytes: 2649904 },
  ] });
  expect(value.comparison.avg_work_us.candidate).toEqual([4670, 4670, 4670]);
  expect(value.comparison.avg_render_us.candidate).toEqual([581, 581, 581]);
  expect(value.comparison.max_work_us.candidate).toEqual([62661, 62661, 62661]);
  expect(value.comparison.arena_bump_bytes.candidate).toEqual([2649904, 2649904, 2649904]);
  expect(value.comparison.safe_arena_bytes.candidate).toBe(3670016);
  expect(value.comparison.drawlist_checksum.candidate).toEqual(["c88e7bcedc5d42a5", "c88e7bcedc5d42a5", "c88e7bcedc5d42a5"]);
  const checksumUnchanged = value.comparison.drawlist_checksum.candidate.every(
    (checksum: string, index: number) => checksum === value.comparison.drawlist_checksum.baseline[index],
  );
  const arenaRegression = mean(value.comparison.arena_bump_bytes.candidate) > mean(value.comparison.arena_bump_bytes.baseline);
  const safeArenaRegression = value.comparison.safe_arena_bytes.candidate > value.comparison.safe_arena_bytes.baseline;
  const maxWorkRegression = mean(value.comparison.max_work_us.candidate) > mean(value.comparison.max_work_us.baseline);
  expect(value.decision.checksum_unchanged).toBe(checksumUnchanged);
  expect(value.decision.arena_regression).toBe(arenaRegression);
  expect(value.decision.safe_arena_regression).toBe(safeArenaRegression);
  expect(value.decision.max_work_regression).toBe(maxWorkRegression);
  expect(value.decision.threshold_math.required_improvement_percent).toBe(3);
  expect(value.decision.avg_work_improvement_percent).toBeCloseTo(
    ((mean(baseline.stats.metric_arrays.avg_work_us) - mean(value.stats.metric_arrays.avg_work_us)) /
      mean(baseline.stats.metric_arrays.avg_work_us)) * 100,
    10,
  );
  expect(value.decision.avg_render_improvement_percent).toBe(0);
  expect(value.decision.threshold).toBe("at least 3% improvement in avg_work_us or avg_render_us");
  expect(value.decision.threshold_math).toEqual({ avg_work_baseline_mean_us: 4682, avg_work_candidate_mean_us: 4670, avg_work_improvement_percent: 0.2563007261853908, avg_render_baseline_mean_us: 581, avg_render_candidate_mean_us: 581, avg_render_improvement_percent: 0, required_improvement_percent: 3 });
  expect(value.decision.reason).toBe("Discarded: neither avg_work_us nor avg_render_us improved by at least 3%; checksum, arena bump, safe arena, and correctness gates did not regress.");
});
