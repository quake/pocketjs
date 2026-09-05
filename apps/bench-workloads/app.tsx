import { DeepZoom, Text, View, type TileDoc } from "@pocketjs/framework/components";
import { PAGES, TILE } from "../zoomlab/tiles.ts";

const mode = import.meta.env.POCKETJS_BENCH_WORKLOAD === "fallback" ? "fallback" : "tileset";

const TILESET_DOC: TileDoc = {
  name: PAGES[0].name,
  w: PAGES[0].w,
  h: PAGES[0].h,
  bg: PAGES[0].bg,
  tile: TILE,
  levels: PAGES[0].levels,
};

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
    <View class="flex-col w-full h-full bg-slate-950">
      <DeepZoom doc={TILESET_DOC} bindInput={false} loadBudget={8} prefetch={1} />
      <Text class="absolute left-2 top-2 text-xs text-white">TILESET WORKLOAD</Text>
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
