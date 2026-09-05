import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BENCH_WORKLOAD_SPECS,
  activationRequirement,
  activationSummary,
  matchesWorkload,
  validateActivation,
} from "../tools/bench-ppsspp-specs.ts";

test("registers deterministic workload specs with path activation requirements", () => {
  expect(BENCH_WORKLOAD_SPECS).toEqual([
    expect.objectContaining({ app: "tileset", workload: "tileset", pspApp: "bench-workloads" }),
    expect.objectContaining({ app: "fallback-glyph", workload: "fallback", pspApp: "bench-workloads" }),
  ]);
  expect(activationRequirement(BENCH_WORKLOAD_SPECS[0])).toEqual(["tileset_uploads"]);
  expect(activationRequirement(BENCH_WORKLOAD_SPECS[1])).toEqual(["fallback_glyph_runs"]);
});

test("does not merge samples that share a PSP app id", () => {
  expect(matchesWorkload("tileset", "fallback")).toBe(false);
  expect(matchesWorkload("fallback", "fallback")).toBe(true);
  expect(matchesWorkload(undefined, undefined)).toBe(true);
});

test("rejects raw replay rows without positive workload activation", () => {
  const spec = BENCH_WORKLOAD_SPECS[0];
  expect(() => validateActivation({}, spec, 2)).toThrow("tileset sample 2: missing required tileset_uploads");
  expect(() => validateActivation({ tileset_uploads: 0 }, spec, 2)).toThrow(
    "tileset sample 2: required tileset_uploads must be positive",
  );
});

test("fromRaw rejects a workload row before report generation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pocketjs-psp-workload-replay-"));
  const rawPath = join(dir, "input.jsonl");
  try {
    await writeFile(
      rawPath,
      `${JSON.stringify({ kind: "sample", app: "bench-workloads-main", workload: "tileset", framework: "solid", sample: 2 })}\n`,
    );
    const result = await $`bun tools/bench-ppsspp.ts --apps=tileset --from-raw=${rawPath}`.nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("tileset sample 2: missing required tileset_uploads");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summarizes activation counters for every workload sample", () => {
  const spec = BENCH_WORKLOAD_SPECS[1];
  expect(activationSummary([{ fallback_glyph_runs: 2 }, { fallback_glyph_runs: 5 }], spec)).toEqual({
    field: "fallback_glyph_runs",
    samples: [2, 5],
    min: 2,
    max: 5,
    positive: true,
  });
});

const NUMERIC_FIELDS = [
  "eval_us",
  "boot_to_frame0_us",
  "avg_frame_interval_us",
  "max_frame_interval_us",
  "avg_js_us",
  "avg_jobs_us",
  "avg_tick_us",
  "avg_draw_us",
  "avg_render_us",
  "avg_work_us",
  "max_work_us",
  "stack_free_bytes",
  "bundle_bytes",
  "pak_bytes",
  "arena_capacity_bytes",
  "arena_bump_bytes",
  "arena_tail_free_bytes",
  "arena_init_free_bytes",
  "arena_configured_bytes",
] as const;

test("PPSSPP bench report preserves drawlist checksums", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pocketjs-psp-bench-"));
  const rawPath = join(dir, "input.jsonl");
  const outDir = join(dir, "out");
  const row: Record<string, number | string> = {
    kind: "sample",
    app: "stats",
    framework: "solid",
    sample: 1,
    sim_hz: 60,
    frames: 100,
    window_start: 28,
    window_n: 100,
    drawlist_checksum: "0123456789abcdef",
    host_wall_ms: 1,
    arena_limit_bytes: 0,
  };
  for (const field of NUMERIC_FIELDS) row[field] = 1;

  try {
    await writeFile(rawPath, `${JSON.stringify(row)}\n`);
    await $`bun tools/bench-ppsspp.ts --apps=stats --from-raw=${rawPath} --out-dir=${outDir}`.quiet();
    const reportPath = (await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: outDir })))[0];
    const report = JSON.parse(await readFile(join(outDir, reportPath), "utf8"));
    expect(report.drawlist_checksums.stats.solid).toEqual(["0123456789abcdef"]);

    const markdownPath = reportPath.replace(/\.json$/, ".md");
    expect(await readFile(join(outDir, markdownPath), "utf8")).toContain(
      "Drawlist checksums: 0123456789abcdef",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PPSSPP workload reports include auditable activation samples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pocketjs-psp-workload-report-"));
  const rawPath = join(dir, "input.jsonl");
  const outDir = join(dir, "out");
  const row: Record<string, number | string> = {
    kind: "sample",
    app: "bench-workloads-main",
    workload: "tileset",
    framework: "solid",
    sample: 1,
    sim_hz: 60,
    frames: 100,
    window_start: 0,
    window_n: 100,
    drawlist_checksum: "0123456789abcdef",
    host_wall_ms: 1,
    arena_limit_bytes: 0,
    tileset_uploads: 3,
  };
  for (const field of NUMERIC_FIELDS) row[field] = 1;

  try {
    await writeFile(rawPath, `${JSON.stringify(row)}\n`);
    await $`bun tools/bench-ppsspp.ts --apps=tileset --from-raw=${rawPath} --out-dir=${outDir}`.quiet();
    const reportPath = (await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: outDir })))[0];
    const report = JSON.parse(await readFile(join(outDir, reportPath), "utf8"));
    expect(report.apps.tileset.solid.activation).toEqual({
      field: "tileset_uploads",
      samples: [3],
      min: 3,
      max: 3,
      positive: true,
    });
    expect(await readFile(join(outDir, reportPath.replace(/\.json$/, ".md")), "utf8")).toContain(
      "Activation tileset_uploads: samples=3; min=3; max=3; positive=true",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
