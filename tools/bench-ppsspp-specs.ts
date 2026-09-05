import type { BenchActivationField } from "./bench-ppsspp-parser.ts";

export interface BenchSpec {
  app: string;
  pspApp?: string;
  workload?: "tileset" | "fallback";
  inputScript: string;
  capStart: number;
  capN: number;
}

export const BENCH_WORKLOAD_SPECS: BenchSpec[] = [
  { app: "tileset", pspApp: "bench-workloads", workload: "tileset", inputScript: "0:0", capStart: 0, capN: 100 },
  {
    app: "fallback-glyph",
    pspApp: "bench-workloads",
    workload: "fallback",
    inputScript: "0:0",
    capStart: 0,
    capN: 100,
  },
];

export function activationRequirement(spec: BenchSpec): BenchActivationField[] {
  if (spec.workload === "tileset") return ["tileset_uploads"];
  if (spec.workload === "fallback") return ["fallback_glyph_runs"];
  return [];
}

export function matchesWorkload(actual: BenchSpec["workload"], requested: BenchSpec["workload"]): boolean {
  return actual === requested;
}

export function validateActivation(row: Record<string, unknown>, spec: BenchSpec, sample: number): void {
  for (const field of activationRequirement(spec)) {
    const value = row[field];
    if (value === undefined) {
      throw new Error(`${spec.app} sample ${sample}: missing required ${field}`);
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(`${spec.app} sample ${sample}: invalid ${field}`);
    }
    if (value <= 0) {
      throw new Error(`${spec.app} sample ${sample}: required ${field} must be positive`);
    }
  }
}

export function activationSummary(
  rows: Array<Record<string, unknown>>,
  spec: BenchSpec,
): { field: BenchActivationField; samples: number[]; min: number; max: number; positive: boolean } | undefined {
  const field = activationRequirement(spec)[0];
  if (!field) return undefined;
  const samples = rows.map((row) => row[field] as number);
  return { field, samples, min: Math.min(...samples), max: Math.max(...samples), positive: samples.every((n) => n > 0) };
}
