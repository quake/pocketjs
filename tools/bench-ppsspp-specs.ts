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
