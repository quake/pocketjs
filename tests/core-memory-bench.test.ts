import { $ } from "bun";
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMAND = [
  "cargo",
  "run",
  "--manifest-path",
  "engine/core/Cargo.toml",
  "--example",
  "membench",
  "--quiet",
];

const REQUIRED_FIELDS = [
  "peak_requested_bytes",
  "final_requested_bytes",
  "allocation_count",
  "total_allocated_bytes",
  "avg_layout_us",
  "max_layout_us",
  "nodes",
  "structural_relayouts",
  "text_mode",
  "texture_mode",
  "drawlist_checksum",
  "stage_tick_us",
  "stage_draw_us",
  "stage_layout_us",
  "stage_animation_us",
  "stage_allocation_count",
  "stage_total_allocated_bytes",
] as const;

const TIMING_FIELDS = new Set([
  "avg_layout_us",
  "max_layout_us",
  "stage_tick_us",
  "stage_draw_us",
  "stage_layout_us",
  "stage_animation_us",
]);
const LEGACY_CANONICAL_FIELDS = [
  "peak_requested_bytes",
  "final_requested_bytes",
  "allocation_count",
  "total_allocated_bytes",
  "nodes",
  "structural_relayouts",
  "text_mode",
  "texture_mode",
  "drawlist_checksum",
] as const;
const STAGE_FIELDS = [
  "stage_tick_us",
  "stage_draw_us",
  "stage_layout_us",
  "stage_animation_us",
  "stage_allocation_count",
  "stage_total_allocated_bytes",
] as const;
// Allocation counts are deterministic; timing fields are wall-clock measurements and are excluded.
const DETERMINISTIC_STAGE_FIELDS = [
  "stage_allocation_count",
  "stage_total_allocated_bytes",
] as const;
type Receipt = Record<(typeof REQUIRED_FIELDS)[number], string>;

function parseReceipt(output: string): Receipt {
  const lines = output.endsWith("\n")
    ? output.slice(0, -1).split("\n")
    : output.split("\n");
  expect(lines).toHaveLength(REQUIRED_FIELDS.length);

  const seen = new Set<string>();
  const entries = lines.map((line) => {
    const separator = line.indexOf("=");
    expect(separator).toBeGreaterThan(0);
    expect(line.indexOf("=", separator + 1)).toBe(-1);

    const field = line.slice(0, separator);
    const value = line.slice(separator + 1);
    expect((REQUIRED_FIELDS as readonly string[]).includes(field)).toBe(true);
    expect(seen.has(field)).toBe(false);
    expect(value).not.toBe("");
    seen.add(field);
    return [field, value];
  });

  expect(seen.size).toBe(REQUIRED_FIELDS.length);
  const receipt = Object.fromEntries(entries) as Partial<Receipt>;

  for (const field of REQUIRED_FIELDS) {
    expect(receipt[field]).toBeDefined();
    expect(receipt[field]).not.toBe("");
  }

  for (const field of REQUIRED_FIELDS) {
    if (TIMING_FIELDS.has(field)) continue;
    if (field === "text_mode" || field === "texture_mode") {
      expect(receipt[field]).toBe("atlas");
    } else if (field === "drawlist_checksum") {
      expect(receipt[field]).toMatch(/^[0-9a-f]{16}$/);
    } else {
      expect(receipt[field]).toMatch(/^\d+$/);
      const value = Number(receipt[field]);
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }

  for (const field of TIMING_FIELDS) {
    expect(receipt[field]).toMatch(/^\d+$/);
    const value = Number(receipt[field]);
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }

  return receipt as Receipt;
}

// Keep this fixture independent from REQUIRED_FIELDS so contract changes cannot update both together.
const VALID_RECEIPT = [
  "peak_requested_bytes=0",
  "final_requested_bytes=0",
  "allocation_count=0",
  "total_allocated_bytes=0",
  "avg_layout_us=0",
  "max_layout_us=0",
  "nodes=0",
  "structural_relayouts=0",
  "text_mode=atlas",
  "texture_mode=atlas",
  "drawlist_checksum=0000000000000000",
  "stage_tick_us=0",
  "stage_draw_us=0",
  "stage_layout_us=0",
  "stage_animation_us=0",
  "stage_allocation_count=0",
  "stage_total_allocated_bytes=0",
].join("\n");

test("receipt parser rejects unknown and duplicate fields", () => {
  expect(() => parseReceipt(`${VALID_RECEIPT}\nunknown=0`)).toThrow();
  expect(() => parseReceipt(`${VALID_RECEIPT}\npeak_requested_bytes=0`)).toThrow();
});

test("receipt parser rejects empty and negative numeric values", () => {
  expect(() => parseReceipt(VALID_RECEIPT.replace("nodes=0", "nodes="))).toThrow();
  expect(() => parseReceipt(VALID_RECEIPT.replace("nodes=0", "nodes=-1"))).toThrow();
});

test("receipt parser rejects non-finite and non-integer numbers", () => {
  expect(() =>
    parseReceipt(
      VALID_RECEIPT.replace(
        "peak_requested_bytes=0",
        `peak_requested_bytes=${"9".repeat(400)}`,
      ),
    ),
  ).toThrow();
  expect(() =>
    parseReceipt(VALID_RECEIPT.replace("peak_requested_bytes=0", "peak_requested_bytes=1.5")),
  ).toThrow();
});

test("receipt fixture explicitly covers every stage field", () => {
  expect(() => parseReceipt(VALID_RECEIPT)).not.toThrow();
  const requiredFields = new Set(REQUIRED_FIELDS);
  const fixtureFields = new Set(
    VALID_RECEIPT.split("\n").map((line) => line.slice(0, line.indexOf("="))),
  );
  for (const field of STAGE_FIELDS) {
    expect(requiredFields.has(field)).toBe(true);
    expect(fixtureFields.has(field)).toBe(true);
  }
});

function legacyCanonicalReceipt(receipt: Receipt): Record<string, string> {
  return Object.fromEntries(
    LEGACY_CANONICAL_FIELDS.map((field) => [
      field,
      receipt[field],
    ]),
  );
}

function deterministicStageReceipt(receipt: Receipt): Record<string, string> {
  return Object.fromEntries(DETERMINISTIC_STAGE_FIELDS.map((field) => [field, receipt[field]]));
}

test(
  "core memory receipt is complete, stable, and matches its baseline",
  { timeout: 30_000 },
  async () => {
    const run = () =>
      $`${COMMAND[0]} ${COMMAND.slice(1)}`.cwd(ROOT).quiet().text();
    const first = parseReceipt(await run());
    const second = parseReceipt(await run());

    expect(legacyCanonicalReceipt(first)).toEqual(legacyCanonicalReceipt(second));
    expect(deterministicStageReceipt(first)).toEqual(deterministicStageReceipt(second));

    const baseline = (await Bun.file(
      new URL("../docs/bench/core-memory-2026-09-05.json", import.meta.url),
    ).json()) as { receipt: Pick<Receipt, (typeof LEGACY_CANONICAL_FIELDS)[number]> };
    expect(legacyCanonicalReceipt(first)).toEqual(baseline.receipt);
  },
);
