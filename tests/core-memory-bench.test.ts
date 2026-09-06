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

const VARIANTS = [
  "full",
  "style_only",
  "structure_no_text",
  "text_updates",
  "no_draw_control",
] as const;
type Variant = (typeof VARIANTS)[number];
const VARIANT_FIELDS = [
  "variant",
  "nodes",
  "measured_ticks",
  "structural_relayouts",
  "avg_tick_us",
  "max_tick_us",
  "draw_us",
  "allocation_count",
  "total_allocated_bytes",
  "drawlist_checksum",
] as const;
type VariantRecord = Record<(typeof VARIANT_FIELDS)[number], string>;
const NUMERIC_VARIANT_FIELDS = new Set(
  VARIANT_FIELDS.filter(
    (field) => field !== "variant" && field !== "drawlist_checksum",
  ),
);

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

function parseVariantRecord(output: string): VariantRecord {
  const lines = output.split("\n");
  expect(lines).toHaveLength(VARIANT_FIELDS.length);

  const seen = new Set<string>();
  const entries = lines.map((line) => {
    const separator = line.indexOf("=");
    expect(separator).toBeGreaterThan(0);
    expect(line.indexOf("=", separator + 1)).toBe(-1);

    const field = line.slice(0, separator);
    const value = line.slice(separator + 1);
    expect((VARIANT_FIELDS as readonly string[]).includes(field)).toBe(true);
    expect(seen.has(field)).toBe(false);
    expect(value).not.toBe("");
    seen.add(field);
    return [field, value];
  });

  expect(seen.size).toBe(VARIANT_FIELDS.length);
  const record = Object.fromEntries(entries) as Partial<VariantRecord>;
  for (const field of VARIANT_FIELDS) {
    expect(record[field]).toBeDefined();
  }

  expect((VARIANTS as readonly string[]).includes(record.variant!)).toBe(true);
  for (const field of NUMERIC_VARIANT_FIELDS) {
    expect(record[field]).toMatch(/^\d+$/);
    const value = Number(record[field]);
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isInteger(value)).toBe(true);
    if (field === "measured_ticks") {
      expect(value).toBeGreaterThan(0);
    } else {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }

  if (record.variant === "no_draw_control") {
    expect(record.drawlist_checksum).toBe("control");
  } else {
    expect(record.drawlist_checksum).toMatch(/^[0-9a-f]{16}$/);
  }

  return record as VariantRecord;
}

function parseVariantMatrix(output: string): Map<Variant, VariantRecord> {
  const normalized = output.endsWith("\n")
    ? output.slice(0, -1)
    : output;
  const records = normalized.split("\n\n").map(parseVariantRecord);
  const parsed = new Map<Variant, VariantRecord>();
  for (const record of records) {
    expect(parsed.has(record.variant as Variant)).toBe(false);
    parsed.set(record.variant as Variant, record);
  }
  expect(parsed.size).toBe(VARIANTS.length);
  for (const variant of VARIANTS) {
    expect(parsed.has(variant)).toBe(true);
  }
  return parsed;
}

// Keep this fixture independent from VARIANT_FIELDS so the contract cannot update both together.
const VALID_VARIANT_RECORDS = [
  [
    "variant=full",
    "nodes=120",
    "measured_ticks=100",
    "structural_relayouts=20",
    "avg_tick_us=42",
    "max_tick_us=60",
    "draw_us=8",
    "allocation_count=30",
    "total_allocated_bytes=4096",
    "drawlist_checksum=0123456789abcdef",
  ].join("\n"),
  [
    "variant=style_only",
    "nodes=120",
    "measured_ticks=100",
    "structural_relayouts=0",
    "avg_tick_us=20",
    "max_tick_us=30",
    "draw_us=8",
    "allocation_count=0",
    "total_allocated_bytes=0",
    "drawlist_checksum=0123456789abcdef",
  ].join("\n"),
  [
    "variant=structure_no_text",
    "nodes=120",
    "measured_ticks=100",
    "structural_relayouts=20",
    "avg_tick_us=32",
    "max_tick_us=45",
    "draw_us=8",
    "allocation_count=20",
    "total_allocated_bytes=2048",
    "drawlist_checksum=0123456789abcdef",
  ].join("\n"),
  [
    "variant=text_updates",
    "nodes=120",
    "measured_ticks=100",
    "structural_relayouts=0",
    "avg_tick_us=28",
    "max_tick_us=40",
    "draw_us=8",
    "allocation_count=10",
    "total_allocated_bytes=1024",
    "drawlist_checksum=0123456789abcdef",
  ].join("\n"),
  [
    "variant=no_draw_control",
    "nodes=120",
    "measured_ticks=100",
    "structural_relayouts=20",
    "avg_tick_us=34",
    "max_tick_us=48",
    "draw_us=0",
    "allocation_count=30",
    "total_allocated_bytes=4096",
    "drawlist_checksum=control",
  ].join("\n"),
] as const;

const VALID_VARIANT_MATRIX = VALID_VARIANT_RECORDS.join("\n\n");
const ZERO_MEASURED_TICKS_RECORD = VALID_VARIANT_RECORDS[0]!.replace(
  "measured_ticks=100",
  "measured_ticks=0",
);

test("variant parser accepts the complete differential matrix", () => {
  expect(parseVariantMatrix(`${VALID_VARIANT_MATRIX}\n`).size).toBe(5);
});

test("variant parser rejects unknown variants and malformed records", () => {
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("variant=full", "variant=other"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("nodes=120", "unknown=120"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(VALID_VARIANT_RECORDS[0]!.replace("nodes=120\n", "")),
  ).toThrow();
  expect(() =>
    parseVariantRecord(`${VALID_VARIANT_RECORDS[0]}\nvariant=full`),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("nodes=120", "nodes=-1"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("nodes=120", "nodes=1.5"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("nodes=120", "nodes="),
    ),
  ).toThrow();
});

test("variant parser rejects zero measured ticks", () => {
  expect(() => parseVariantRecord(ZERO_MEASURED_TICKS_RECORD)).toThrow();
});

test("variant parser enforces drawing checksums and control checksum", () => {
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("0123456789abcdef", "0123456789ABCDEf"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[0]!.replace("0123456789abcdef", "1234"),
    ),
  ).toThrow();
  expect(() =>
    parseVariantRecord(
      VALID_VARIANT_RECORDS[4]!.replace(
        "drawlist_checksum=control",
        "drawlist_checksum=0123456789abcdef",
      ),
    ),
  ).toThrow();
});

test("variant parser rejects duplicate records and missing required variants", () => {
  expect(() =>
    parseVariantMatrix(
      `${VALID_VARIANT_MATRIX}\n\n${VALID_VARIANT_RECORDS[0]}`,
    ),
  ).toThrow();
  expect(() =>
    parseVariantMatrix(VALID_VARIANT_RECORDS.slice(0, 4).join("\n\n")),
  ).toThrow();
});

test(
  "core differential receipt emits every required variant",
  { timeout: 30_000 },
  async () => {
    const output = await $`${COMMAND[0]} ${COMMAND.slice(1)}`
      .cwd(ROOT)
      .quiet()
      .text();
    const records = parseVariantMatrix(output);
    const full = records.get("full");
    expect(full).toBeDefined();
    expect(full).toMatchObject({
      nodes: "99",
      measured_ticks: "60",
      structural_relayouts: "16",
      allocation_count: "9336",
      total_allocated_bytes: "6195449",
      drawlist_checksum: "cc6a0b00efdba151",
    });
  },
);

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

function legacyCanonicalReceipt(
  receipt: Pick<Receipt, (typeof LEGACY_CANONICAL_FIELDS)[number]>,
): Record<string, string> {
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

function expectStageMetrics(receipt: Receipt): void {
  const tick = Number(receipt.stage_tick_us);
  const phase = Number(receipt.stage_layout_us) + Number(receipt.stage_animation_us);
  expect(Number(receipt.stage_layout_us)).toBeLessThanOrEqual(tick);
  expect(Number(receipt.stage_animation_us)).toBeLessThanOrEqual(tick);
  expect(phase).toBeLessThanOrEqual(tick);
  expect(tick - phase).toBeLessThan(2);
  expect(receipt.stage_allocation_count).toBe(receipt.allocation_count);
  expect(receipt.stage_total_allocated_bytes).toBe(receipt.total_allocated_bytes);
}

test(
  "core memory receipt is complete, stable, and matches its baseline",
  { timeout: 30_000 },
  async () => {
    const run = () =>
      $`${COMMAND[0]} ${COMMAND.slice(1)}`.cwd(ROOT).quiet().text();
    const first = parseReceipt(await run());
    const second = parseReceipt(await run());

    expectStageMetrics(first);
    expectStageMetrics(second);
    expect(legacyCanonicalReceipt(first)).toEqual(legacyCanonicalReceipt(second));
    expect(deterministicStageReceipt(first)).toEqual(deterministicStageReceipt(second));

    const baseline = (await Bun.file(
      new URL("../docs/bench/core-memory-2026-09-05.json", import.meta.url),
    ).json()) as { receipt: Pick<Receipt, (typeof LEGACY_CANONICAL_FIELDS)[number]> };
    expect(legacyCanonicalReceipt(first)).toEqual(legacyCanonicalReceipt(baseline.receipt));
  },
);
