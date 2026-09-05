import { Sprite, Text, View } from "@pocketjs/framework/components";

const mode = import.meta.env.POCKETJS_BENCH_WORKLOAD === "fallback" ? "fallback" : "tileset";
const TILE_COUNT = 24;
const TILE_ASSET = "spinner-atlas.svg";
const FALLBACK_TEXT = [
  "FALLBACK GLYPH PATH",
  "TOFU SCAN RECEIPT",
  "PACKED TEXT SET",
  "RENDER CHECK 0001",
  "RENDER CHECK 0002",
  "RENDER CHECK 0003",
];

function TilesetWorkload() {
  return (
    <View class="flex-col w-full h-full p-3 gap-2 bg-slate-950">
      <Text class="text-xs text-slate-300">TILESET WORKLOAD</Text>
      <View class="flex-row flex-wrap gap-2">
        {Array.from({ length: TILE_COUNT }, (_, index) => (
          <View class="w-[56] h-[56] items-center justify-center bg-slate-800 border-slate-700">
            <Sprite sprite={TILE_ASSET} class="w-[48] h-[48]" />
            <Text class="text-xs text-slate-400">{String(index).padStart(2, "0")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FallbackWorkload() {
  return (
    <View class="flex-col w-full h-full p-4 gap-3 bg-slate-950">
      <Text class="text-xs text-slate-300">FALLBACK GLYPH WORKLOAD</Text>
      {FALLBACK_TEXT.map((line) => <Text class="text-xl text-white">{line}</Text>)}
    </View>
  );
}

export default function BenchWorkload() {
  return mode === "fallback" ? <FallbackWorkload /> : <TilesetWorkload />;
}
