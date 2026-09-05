import { expect, test } from "bun:test";
import { parseBenchOutput, type BenchActivationField } from "../tools/bench-ppsspp-parser.ts";

function row(
  app: string,
  checksum?: string,
  bundle = 10,
  pak = 20,
  counters?: Partial<Record<BenchActivationField, unknown>>,
): string {
  return JSON.stringify({
    app,
    frames: 80,
    window_n: 80,
    bundle_bytes: bundle,
    pak_bytes: pak,
    ...(checksum === undefined ? {} : { drawlist_checksum: checksum }),
    ...counters,
  });
}

test("selects the requested app from multi-app PSP output", () => {
  const parsed = parseBenchOutput(
    `${row("hero", "1111111111111111", 11, 22)}\n${row("cards", undefined, 33, 44)}`,
    "cards",
    1,
  );

  expect(parsed.app).toBe("cards");
  expect(parsed.bundle_bytes).toBe(33);
  expect(parsed.pak_bytes).toBe(44);
  expect(parsed.drawlist_checksum).toBeUndefined();
});

test("keeps one-line legacy PSP output compatible", () => {
  const parsed = parseBenchOutput(row("legacy-app"), "stats", 1);

  expect(parsed.app).toBe("legacy-app");
  expect(parsed.drawlist_checksum).toBeUndefined();
});

test("parses optional workload activation counters", () => {
  const parsed = parseBenchOutput(
    row("asset-heavy", undefined, 10, 20, { fallback_glyph_runs: 3, tileset_uploads: 4 }),
    "asset-heavy",
    1,
  );

  expect(parsed.fallback_glyph_runs).toBe(3);
  expect(parsed.tileset_uploads).toBe(4);
});

test("requires a tileset activation counter when requested", () => {
  expect(() => parseBenchOutput(row("asset-heavy"), "asset-heavy", 1, { require: ["tileset_uploads"] })).toThrow(
    "asset-heavy sample 1: missing required tileset_uploads",
  );
  expect(
    parseBenchOutput(row("asset-heavy", undefined, 10, 20, { tileset_uploads: 1 }), "asset-heavy", 1, {
      require: ["tileset_uploads"],
    }).tileset_uploads,
  ).toBe(1);
});

test("requires a fallback glyph activation counter when requested", () => {
  expect(() => parseBenchOutput(row("asset-heavy"), "asset-heavy", 1, { require: ["fallback_glyph_runs"] })).toThrow(
    "asset-heavy sample 1: missing required fallback_glyph_runs",
  );
  expect(
    parseBenchOutput(row("asset-heavy", undefined, 10, 20, { fallback_glyph_runs: 1 }), "asset-heavy", 1, {
      require: ["fallback_glyph_runs"],
    }).fallback_glyph_runs,
  ).toBe(1);
});

test.each([
  ["fallback_glyph_runs", -1],
  ["tileset_uploads", 1.5],
  ["fallback_glyph_runs", "2"],
])("rejects invalid %s counter", (field, value) => {
  const counters = { [field as BenchActivationField]: value };
  expect(() => parseBenchOutput(row("asset-heavy", undefined, 10, 20, counters), "asset-heavy", 1)).toThrow(
    `asset-heavy sample 1: invalid ${field}`,
  );
});

test.each(["fallback_glyph_runs", "tileset_uploads"] as const)("rejects zero %s when required", (field) => {
  expect(() =>
    parseBenchOutput(row("asset-heavy", undefined, 10, 20, { [field]: 0 }), "asset-heavy", 1, {
      require: [field],
    }),
  ).toThrow(`asset-heavy sample 1: required ${field} must be positive`);
});

test("reports a missing requested app in multi-app output", () => {
  expect(() => parseBenchOutput(`${row("hero")}\n${row("cards")}`, "stats", 1)).toThrow(
    "stats sample 1: requested app not found in PSP bench output (hero, cards)",
  );
});
