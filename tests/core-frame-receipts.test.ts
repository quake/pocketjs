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
