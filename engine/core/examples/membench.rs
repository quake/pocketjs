use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::UnsafeCell;
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

use pocketjs_core::assets::{AssetInput, AssetKind};
use pocketjs_core::{spec, Ui};

struct CountingAlloc;

static COUNTING: AtomicBool = AtomicBool::new(false);
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static TOTAL: AtomicUsize = AtomicUsize::new(0);
static COUNT: AtomicUsize = AtomicUsize::new(0);

const LEDGER_CAPACITY: usize = 4096;

#[derive(Clone, Copy)]
struct LedgerEntry {
    ptr: usize,
    size: usize,
    measured: bool,
}

struct AllocationLedger {
    entries: [LedgerEntry; LEDGER_CAPACITY],
}

impl AllocationLedger {
    const EMPTY: LedgerEntry = LedgerEntry {
        ptr: 0,
        size: 0,
        measured: false,
    };

    const fn new() -> Self {
        Self {
            entries: [Self::EMPTY; LEDGER_CAPACITY],
        }
    }

    fn alloc(&mut self, ptr: usize, size: usize, measured: bool) {
        let slot = self
            .entries
            .iter_mut()
            .find(|entry| entry.ptr == 0)
            .expect("allocation ledger capacity exceeded");
        *slot = LedgerEntry {
            ptr,
            size,
            measured,
        };
    }

    fn realloc(
        &mut self,
        old_ptr: usize,
        new_ptr: usize,
        new_size: usize,
    ) -> Option<(usize, bool)> {
        let entry = self.entries.iter_mut().find(|entry| entry.ptr == old_ptr);
        let Some(entry) = entry else {
            self.alloc(new_ptr, new_size, false);
            return None;
        };
        let old = (entry.size, entry.measured);
        entry.ptr = new_ptr;
        entry.size = new_size;
        Some(old)
    }

    fn dealloc(&mut self, ptr: usize) -> Option<(usize, bool)> {
        let entry = self.entries.iter_mut().find(|entry| entry.ptr == ptr)?;
        let result = (entry.size, entry.measured);
        *entry = Self::EMPTY;
        Some(result)
    }

    fn begin_measurement(&mut self) {
        for entry in &mut self.entries {
            if entry.ptr != 0 {
                entry.measured = false;
            }
        }
    }
}

struct LedgerLock {
    locked: AtomicBool,
    ledger: UnsafeCell<AllocationLedger>,
}

unsafe impl Sync for LedgerLock {}

struct LedgerGuard<'a> {
    lock: &'a LedgerLock,
}

impl LedgerLock {
    const fn new() -> Self {
        Self {
            locked: AtomicBool::new(false),
            ledger: UnsafeCell::new(AllocationLedger::new()),
        }
    }

    fn lock(&self) -> LedgerGuard<'_> {
        while self
            .locked
            .compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        LedgerGuard { lock: self }
    }
}

impl Deref for LedgerGuard<'_> {
    type Target = AllocationLedger;

    fn deref(&self) -> &Self::Target {
        // The guard owns the lock for the lifetime of this reference.
        unsafe { &*self.lock.ledger.get() }
    }
}

impl DerefMut for LedgerGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        // The guard owns the lock, so no other mutable reference exists.
        unsafe { &mut *self.lock.ledger.get() }
    }
}

impl Drop for LedgerGuard<'_> {
    fn drop(&mut self) {
        self.lock.locked.store(false, Ordering::Release);
    }
}

static ALLOCATION_LEDGER: LedgerLock = LedgerLock::new();

#[global_allocator]
static ALLOCATOR: CountingAlloc = CountingAlloc;

impl CountingAlloc {
    fn record_alloc(ptr: *mut u8, size: usize) {
        let measured = COUNTING.load(Ordering::Relaxed);
        ALLOCATION_LEDGER.lock().alloc(ptr as usize, size, measured);
        if !measured {
            return;
        }
        LIVE.fetch_add(size, Ordering::Relaxed);
        TOTAL.fetch_add(size, Ordering::Relaxed);
        COUNT.fetch_add(1, Ordering::Relaxed);
        Self::record_peak();
    }

    fn record_peak() {
        let live = LIVE.load(Ordering::Relaxed);
        let mut peak = PEAK.load(Ordering::Relaxed);
        while live > peak {
            match PEAK.compare_exchange_weak(peak, live, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => break,
                Err(current) => peak = current,
            }
        }
    }

    fn record_dealloc(ptr: *mut u8) {
        if let Some((size, measured)) = ALLOCATION_LEDGER.lock().dealloc(ptr as usize) {
            if measured {
                LIVE.fetch_sub(size, Ordering::Relaxed);
            }
        }
    }
}

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() {
            Self::record_alloc(ptr, layout.size());
        }
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc_zeroed(layout);
        if !ptr.is_null() {
            Self::record_alloc(ptr, layout.size());
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
        Self::record_dealloc(ptr);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let new_ptr = System.realloc(ptr, layout, new_size);
        if !new_ptr.is_null() {
            if let Some((old_size, measured)) =
                ALLOCATION_LEDGER
                    .lock()
                    .realloc(ptr as usize, new_ptr as usize, new_size)
            {
                if measured {
                    LIVE.fetch_sub(old_size, Ordering::Relaxed);
                    LIVE.fetch_add(new_size, Ordering::Relaxed);
                    TOTAL.fetch_add(new_size, Ordering::Relaxed);
                    COUNT.fetch_add(1, Ordering::Relaxed);
                    Self::record_peak();
                }
            }
        }
        new_ptr
    }
}

fn begin_measurement() {
    ALLOCATION_LEDGER.lock().begin_measurement();
    LIVE.store(0, Ordering::Relaxed);
    PEAK.store(0, Ordering::Relaxed);
    TOTAL.store(0, Ordering::Relaxed);
    COUNT.store(0, Ordering::Relaxed);
    COUNTING.store(true, Ordering::Relaxed);
}

fn end_measurement() {
    COUNTING.store(false, Ordering::Relaxed);
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn style_blob() -> Vec<u8> {
    // Three records: view, text, and image. The records use only fixed props,
    // so parsing them cannot introduce workload-dependent style allocations.
    let mut out = Vec::with_capacity(12 + 3 * 32);
    push_u32(&mut out, spec::style_table::MAGIC);
    push_u16(&mut out, spec::style_table::VERSION);
    push_u16(&mut out, 3);
    push_u16(&mut out, 0);
    push_u16(&mut out, 0);

    let records = [
        vec![
            (spec::prop::BG_COLOR, 0xff202830),
            (spec::prop::PADDING_T, 4.0f32.to_bits()),
            (spec::prop::PADDING_B, 4.0f32.to_bits()),
        ],
        vec![
            (spec::prop::TEXT_COLOR, 0xffffffff),
            (spec::prop::HEIGHT, 18.0f32.to_bits()),
        ],
        vec![(spec::prop::BG_COLOR, 0xff405060)],
    ];
    for props in records {
        out.push(spec::style_table::VARIANT_BASE);
        out.push(props.len() as u8);
        for (prop, value) in props {
            out.push(prop);
            out.push(0);
            push_u32(&mut out, value);
        }
    }
    out
}

fn texture_blob() -> Vec<u8> {
    let mut atlas = Vec::with_capacity(16 * 16 * 4);
    for i in 0..(16 * 16) {
        atlas.extend_from_slice(&[
            (i & 0xff) as u8,
            ((i * 3) & 0xff) as u8,
            ((i * 7) & 0xff) as u8,
            0xff,
        ]);
    }
    atlas
}

fn font_atlas_blob(slot: u8) -> Vec<u8> {
    const FIRST_GLYPH: u32 = 32;
    const GLYPH_COUNT: u16 = 95;
    const CELL_W: u8 = 8;
    const CELL_H: u8 = 16;
    const BYTES_PER_GLYPH: usize = CELL_W as usize * CELL_H as usize;

    let mut atlas = Vec::with_capacity(
        spec::font_atlas::HEADER_SIZE
            + GLYPH_COUNT as usize * spec::font_atlas::CMAP_ENTRY_SIZE
            + GLYPH_COUNT as usize * BYTES_PER_GLYPH,
    );
    push_u32(&mut atlas, spec::font_atlas::MAGIC);
    push_u16(&mut atlas, spec::font_atlas::VERSION);
    push_u16(&mut atlas, GLYPH_COUNT);
    atlas.extend_from_slice(&[CELL_W, CELL_H, 12, 18, slot, 0, 1, 0]);
    for gid in 0..GLYPH_COUNT {
        push_u32(&mut atlas, FIRST_GLYPH + u32::from(gid));
        push_u16(&mut atlas, gid);
        atlas.extend_from_slice(&[CELL_W, 0]);
    }
    for gid in 0..GLYPH_COUNT {
        for y in 0..CELL_H as usize {
            for x in 0..CELL_W as usize {
                // Keep the space transparent while giving every printable
                // glyph deterministic coverage to exercise atlas sampling.
                let covered = gid != 0
                    && (1..=6).contains(&x)
                    && (2..=13).contains(&y)
                    && (x + y + gid as usize) % 3 != 0;
                atlas.push(if covered { 255 } else { 0 });
            }
        }
    }
    atlas
}

fn image_entry(index: usize) -> Vec<u8> {
    const WIDTH: usize = 32;
    const HEIGHT: usize = 32;
    let mut image = Vec::with_capacity(8 + WIDTH * HEIGHT * 4);
    push_u16(&mut image, WIDTH as u16);
    push_u16(&mut image, HEIGHT as u16);
    image.push(spec::psm::PSM_8888 as u8);
    image.push(0);
    image.extend_from_slice(&[0, 0]);
    for pixel in 0..WIDTH * HEIGHT {
        image.extend_from_slice(&[
            (pixel as u8).wrapping_add(index as u8),
            (pixel as u8).wrapping_mul(3),
            (pixel as u8).wrapping_mul(7),
            0xff,
        ]);
    }
    image
}

fn sprite_entry(index: usize) -> Vec<u8> {
    const WIDTH: usize = 64;
    const HEIGHT: usize = 64;
    let mut sprite = Vec::with_capacity(16 + WIDTH * HEIGHT * 4);
    push_u16(&mut sprite, WIDTH as u16);
    push_u16(&mut sprite, HEIGHT as u16);
    sprite.push(spec::psm::PSM_8888 as u8);
    sprite.push(0);
    push_u16(&mut sprite, 4);
    push_u16(&mut sprite, 2);
    push_u16(&mut sprite, 3 + index as u16);
    push_u16(&mut sprite, 0);
    push_u16(&mut sprite, 0);
    for pixel in 0..WIDTH * HEIGHT {
        sprite.extend_from_slice(&[
            (pixel as u8).wrapping_add(index as u8),
            (pixel as u8).wrapping_mul(5),
            (pixel as u8).wrapping_mul(11),
            0xff,
        ]);
    }
    sprite
}

struct AssetInputs {
    blobs: Vec<Vec<u8>>,
    kinds: Vec<AssetKind>,
}

const ASSET_FONT_SLOTS: [u8; 2] = [12, 13];

impl AssetInputs {
    fn new() -> Self {
        let mut blobs = vec![
            style_blob(),
            font_atlas_blob(ASSET_FONT_SLOTS[0]),
            font_atlas_blob(ASSET_FONT_SLOTS[1]),
        ];
        let mut kinds = vec![AssetKind::Styles, AssetKind::Font, AssetKind::Font];
        for index in 0..8 {
            blobs.push(image_entry(index));
            kinds.push(AssetKind::Image);
        }
        for index in 0..4 {
            blobs.push(sprite_entry(index));
            kinds.push(AssetKind::Sprite);
        }
        Self { blobs, kinds }
    }

    fn inputs(&self) -> Vec<AssetInput<'_>> {
        self.kinds
            .iter()
            .copied()
            .zip(&self.blobs)
            .map(|(kind, bytes)| AssetInput { kind, bytes })
            .collect()
    }
}

fn hash_bytes(checksum: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *checksum ^= u64::from(*byte);
        *checksum = checksum.wrapping_mul(0x100000001b3);
    }
}

fn hash_u32(checksum: &mut u64, value: u32) {
    hash_bytes(checksum, &value.to_le_bytes());
}

fn resource_checksum(ui: &Ui, inputs: &AssetInputs, handles: &[i32], styles_loaded: bool) -> u64 {
    let mut checksum: u64 = 0xcbf29ce484222325;
    assert_eq!(inputs.kinds.len(), handles.len());
    // Ui exposes no decoded styles view, so successful load_assets plus the
    // exact fixture blob hash is the available post-load validation boundary.
    assert!(styles_loaded);
    checksum ^= u64::from(styles_loaded);
    checksum = checksum.wrapping_mul(0x100000001b3);
    let styles_blob = inputs
        .kinds
        .iter()
        .zip(&inputs.blobs)
        .find_map(|(kind, bytes)| matches!(kind, AssetKind::Styles).then_some(bytes.as_slice()))
        .expect("asset fixture must include styles");
    hash_bytes(&mut checksum, styles_blob);
    for (kind, handle) in inputs.kinds.iter().zip(handles) {
        checksum ^= *kind as u8 as u64;
        checksum = checksum.wrapping_mul(0x100000001b3);
        match kind {
            AssetKind::Styles | AssetKind::Font => assert_eq!(*handle, -1),
            AssetKind::Image | AssetKind::Sprite => {
                let texture = ui
                    .texture(*handle)
                    .expect("asset texture handle must resolve");
                for value in [texture.w, texture.h, texture.psm] {
                    hash_u32(&mut checksum, value);
                }
                checksum ^= u64::from(texture.linear);
                checksum = checksum.wrapping_mul(0x100000001b3);
                hash_bytes(&mut checksum, texture.pixels);
                if let Some(palette) = texture.palette {
                    hash_bytes(&mut checksum, palette);
                }
            }
        }
    }
    for slot in ASSET_FONT_SLOTS {
        let font = ui.font_atlas(slot).expect("asset font slot must resolve");
        for value in [
            u32::from(font.slot),
            font.cell_w,
            font.cell_h,
            font.baseline,
            font.line_height,
            u32::from(font.flags),
            u32::from(font.glyph_count),
            u32::from(font.raster_density),
        ] {
            hash_u32(&mut checksum, value);
        }
        // lookup_entry exposes the cmap's stable codepoint -> gid/advance/xoff mapping.
        for codepoint in 32..127 {
            hash_u32(&mut checksum, codepoint);
            let entry = font
                .lookup_entry(codepoint)
                .expect("asset font cmap entry must resolve");
            hash_u32(&mut checksum, u32::from(entry.gid));
            hash_u32(&mut checksum, u32::from(entry.advance));
            hash_u32(&mut checksum, u32::from(entry.xoff));
        }
        hash_bytes(&mut checksum, &font.bitmap);
    }
    checksum
}

fn format_asset_record(
    peak: usize,
    final_bytes: usize,
    count: usize,
    total: usize,
    checksum: u64,
) -> String {
    format!(
        "asset-workload peak_requested_bytes={peak} final_requested_bytes={final_bytes} allocation_count={count} total_allocated_bytes={total} resource_checksum={checksum:016x}"
    )
}

fn timing_capacity() -> usize {
    24 + 8 + 16 + 12
}

#[derive(Default)]
struct StageProfile {
    tick_ns: u128,
    draw_ns: u128,
    layout_ns: u128,
    animation_ns: u128,
    allocation_count: usize,
    total_allocated_bytes: usize,
}

enum WorkloadPhase {
    Animation,
    Layout,
}

fn structural_tick(tick: usize) -> bool {
    tick % 4 == 0
}

fn structural_probe(ui: &mut Ui, parent: i32, height: f64) {
    let node = ui.create_node(spec::NodeType::View as u8);
    ui.set_style(node, 0);
    ui.set_prop(node, spec::prop::HEIGHT, height);
    ui.insert_before(parent, node, 0);
    ui.destroy_node(node);
}

fn hash_draw(words: &[u32], checksum: &mut u64) {
    for word in words {
        *checksum ^= u64::from(*word);
        *checksum = checksum.wrapping_mul(0x100000001b3);
    }
}

fn draw_and_hash(ui: &mut Ui, checksum: &mut u64) {
    let words = &ui.draw().words;
    assert!(
        words.iter().any(|&word| word == spec::draw_op::GLYPH_RUN),
        "benchmark draw must emit atlas-backed glyphs"
    );
    hash_draw(words, checksum);
}

fn tick_and_measure(
    ui: &mut Ui,
    checksum: &mut u64,
    total_us: &mut u128,
    max_us: &mut u128,
    profile: &mut StageProfile,
    phase: WorkloadPhase,
) {
    let tick_started = Instant::now();
    ui.tick();
    let tick_elapsed = tick_started.elapsed();
    let tick_us = tick_elapsed.as_micros();
    let tick_ns = tick_elapsed.as_nanos();
    *total_us += tick_us;
    *max_us = (*max_us).max(tick_us);
    profile.tick_ns += tick_ns;
    // These are workload-phase proxies, not internal function timings.
    match phase {
        WorkloadPhase::Animation => profile.animation_ns += tick_ns,
        WorkloadPhase::Layout => profile.layout_ns += tick_ns,
    }

    let draw_started = Instant::now();
    let words = &ui.draw().words;
    let draw_ns = draw_started.elapsed().as_nanos();
    assert!(
        words.iter().any(|&word| word == spec::draw_op::GLYPH_RUN),
        "benchmark draw must emit atlas-backed glyphs"
    );
    hash_draw(words, checksum);
    profile.draw_ns += draw_ns;
}

fn main() {
    const STEADY_TICKS: usize = 24;
    const CHURN_ROUNDS: usize = 8;
    const CHURN_SIZE: usize = 4;
    const TEXT_TICKS: usize = 16;
    const BURST_TICKS: usize = 12;

    // Fixture bytes, source strings, handles, churn ids, and timing state are
    // prepared before measurement. Setup allocations are intentionally outside
    // the workload receipt.
    let styles = style_blob();
    let atlas = texture_blob();
    let font_atlas = font_atlas_blob(0);
    let source_strings = [
        String::from("PocketJS memory benchmark"),
        String::from("deterministic retained core workload"),
    ];
    let mut handles = Vec::with_capacity(1 + 1 + 32 + CHURN_SIZE);
    let mut churn_ids = Vec::with_capacity(CHURN_SIZE);
    let mut text_ids = Vec::with_capacity(32);
    let mut timings = Vec::with_capacity(timing_capacity());
    timings.clear();

    let mut ui = Ui::new();
    ui.set_viewport(spec::SCREEN_W as f32, spec::SCREEN_H as f32);
    assert!(ui.load_styles(&styles));
    assert!(ui.load_font_atlas(&font_atlas));
    let font = ui.font_atlas(0).unwrap();
    let (workload_gid, _) = font
        .lookup('P' as u32)
        .expect("workload glyph must be mapped");
    assert!(
        font.glyph_rows(workload_gid)
            .iter()
            .any(|&coverage| coverage != 0),
        "benchmark font atlas must contain non-zero coverage for P"
    );
    handles.push(ui.upload_texture(&atlas, 16, 16, spec::psm::PSM_8888));
    let texture = handles[0];

    begin_measurement();
    let mut checksum = 0xcbf29ce484222325;
    let mut total_us = 0u128;
    let mut max_us = 0u128;
    let mut profile = StageProfile::default();

    // Phase 1: initial tree and resources.
    let panel = ui.create_node(spec::NodeType::View as u8);
    ui.set_style(panel, 0);
    ui.insert_before(spec::ROOT_ID, panel, 0);
    let title = ui.create_node(spec::NodeType::Text as u8);
    ui.set_style(title, 1);
    ui.set_text(title, &source_strings[0]);
    ui.insert_before(panel, title, 0);
    for i in 0..32 {
        let row = ui.create_node(spec::NodeType::View as u8);
        ui.set_style(row, 0);
        ui.set_prop(row, spec::prop::HEIGHT, 24.0 + (i % 3) as f64);
        ui.insert_before(panel, row, 0);
        let text = ui.create_node(spec::NodeType::Text as u8);
        ui.set_style(text, 1);
        ui.set_text(text, &source_strings[1]);
        ui.insert_before(row, text, 0);
        text_ids.push(text);
        let image = ui.create_node(spec::NodeType::Image as u8);
        ui.set_style(image, 2);
        ui.set_prop(image, spec::prop::WIDTH, 16.0);
        ui.set_prop(image, spec::prop::HEIGHT, 16.0);
        ui.set_image(image, texture);
        ui.insert_before(row, image, 0);
    }
    draw_and_hash(&mut ui, &mut checksum);

    // Phase 2: steady style-only ticks.
    for i in 0..STEADY_TICKS {
        ui.set_prop(panel, spec::prop::OPACITY, 0.85 + (i % 4) as f64 * 0.03);
        tick_and_measure(
            &mut ui,
            &mut checksum,
            &mut total_us,
            &mut max_us,
            &mut profile,
            WorkloadPhase::Animation,
        );
        timings.push(i);
    }

    // Phase 3: fixed-size subtree creation and destruction.
    let mut structural_relayouts = 1u64;
    for round in 0..CHURN_ROUNDS {
        churn_ids.clear();
        for i in 0..CHURN_SIZE {
            let node = ui.create_node(spec::NodeType::View as u8);
            ui.set_style(node, 0);
            ui.set_prop(node, spec::prop::HEIGHT, (20 + i + round) as f64);
            ui.insert_before(panel, node, 0);
            churn_ids.push(node);
        }
        for node in churn_ids.iter().copied() {
            ui.destroy_node(node);
        }
        tick_and_measure(
            &mut ui,
            &mut checksum,
            &mut total_us,
            &mut max_us,
            &mut profile,
            WorkloadPhase::Layout,
        );
        structural_relayouts += 1;
        timings.push(STEADY_TICKS + round);
    }

    // Phase 4: text changes with a structural relayout at a fixed interval.
    for i in 0..TEXT_TICKS {
        let text = text_ids[i % text_ids.len()];
        let value = if i % 4 == 0 {
            "structural text update"
        } else {
            "steady text update"
        };
        ui.set_text(text, value);
        if structural_tick(i) {
            structural_probe(&mut ui, panel, 22.0 + i as f64);
            structural_relayouts += 1;
        }
        tick_and_measure(
            &mut ui,
            &mut checksum,
            &mut total_us,
            &mut max_us,
            &mut profile,
            WorkloadPhase::Layout,
        );
        timings.push(STEADY_TICKS + CHURN_ROUNDS + i);
    }

    // Phase 5: one fixed burst over the peak path.
    for i in 0..BURST_TICKS {
        let text = text_ids[(i * 7) % text_ids.len()];
        ui.set_text(text, if i & 1 == 0 { "burst A" } else { "burst B" });
        ui.set_prop(panel, spec::prop::GAP, (i % 5) as f64);
        if structural_tick(i) {
            structural_probe(&mut ui, panel, 30.0 + i as f64);
            structural_relayouts += 1;
        }
        tick_and_measure(
            &mut ui,
            &mut checksum,
            &mut total_us,
            &mut max_us,
            &mut profile,
            WorkloadPhase::Layout,
        );
        timings.push(STEADY_TICKS + CHURN_ROUNDS + TEXT_TICKS + i);
    }

    let nodes = 1 + 1 + 1 + 32 * 3;
    end_measurement();
    // Snapshot the measured workload receipt before reading the legacy fields.
    let (stage_allocation_count, stage_total_allocated_bytes) = (
        COUNT.load(Ordering::Relaxed),
        TOTAL.load(Ordering::Relaxed),
    );
    profile.allocation_count = stage_allocation_count;
    profile.total_allocated_bytes = stage_total_allocated_bytes;
    let allocation_count = COUNT.load(Ordering::Relaxed);
    let total_allocated_bytes = TOTAL.load(Ordering::Relaxed);
    assert_eq!(profile.allocation_count, allocation_count);
    assert_eq!(profile.total_allocated_bytes, total_allocated_bytes);
    // These are workload-phase proxies, not internal function timings. Convert
    // the aggregate nanosecond totals once so short animation ticks contribute.
    assert_eq!(profile.layout_ns + profile.animation_ns, profile.tick_ns);
    let stage_tick_us = profile.tick_ns / 1_000;
    let stage_layout_us = profile.layout_ns / 1_000;
    let stage_animation_us = profile.animation_ns / 1_000;
    let phase_us = stage_layout_us + stage_animation_us;
    assert!(phase_us <= stage_tick_us);
    assert!(stage_tick_us - phase_us < 2);
    let stage_draw_us = profile.draw_ns / 1_000;
    // avg_layout_us and max_layout_us are complete ui.tick() workload timing
    // proxies, not layout-only timings; preserve their per-tick microsecond
    // semantics. The stage fields above are workload-phase proxies instead.
    let avg_layout_us = total_us / timings.len() as u128;
    let max_layout_us = max_us;
    println!("stage_tick_us={stage_tick_us}");
    println!("stage_draw_us={stage_draw_us}");
    println!("stage_layout_us={stage_layout_us}");
    println!("stage_animation_us={stage_animation_us}");
    println!("stage_allocation_count={}", profile.allocation_count);
    println!(
        "stage_total_allocated_bytes={}",
        profile.total_allocated_bytes
    );
    println!("peak_requested_bytes={}", PEAK.load(Ordering::Relaxed));
    println!("final_requested_bytes={}", LIVE.load(Ordering::Relaxed));
    println!("allocation_count={allocation_count}");
    println!("total_allocated_bytes={total_allocated_bytes}");
    println!("avg_layout_us={avg_layout_us}");
    println!("max_layout_us={max_layout_us}");
    println!("nodes={nodes}");
    println!("structural_relayouts={structural_relayouts}");
    println!("text_mode=atlas");
    println!("texture_mode=atlas");
    println!("drawlist_checksum={checksum:016x}");
    assert_eq!(
        checksum, 0xcc6a0b00efdba151,
        "deterministic benchmark drawlist changed"
    );

    // Reproduce the opt-in asset receipt with POCKETJS_ASSET_WORKLOAD=1.
    if std::env::var("POCKETJS_ASSET_WORKLOAD").as_deref() == Ok("1") {
        let asset_fixture = AssetInputs::new();
        let asset_inputs = asset_fixture.inputs();
        const ASSET_REPETITIONS: usize = 3;
        let mut asset_record = None;
        for _ in 0..ASSET_REPETITIONS {
            let mut asset_ui = Ui::new();
            asset_ui.set_viewport(spec::SCREEN_W as f32, spec::SCREEN_H as f32);
            let mut handles = vec![-1; asset_inputs.len()];
            begin_measurement();
            let styles_loaded = asset_ui.load_assets(&asset_inputs, &mut handles).is_ok();
            end_measurement();
            assert!(styles_loaded);
            assert!(handles.iter().any(|handle| *handle >= 0));
            let receipt = (
                PEAK.load(Ordering::Relaxed),
                LIVE.load(Ordering::Relaxed),
                COUNT.load(Ordering::Relaxed),
                TOTAL.load(Ordering::Relaxed),
                resource_checksum(&asset_ui, &asset_fixture, &handles, styles_loaded),
            );
            if let Some(previous) = asset_record {
                assert_eq!(receipt, previous, "asset workload was not deterministic");
            }
            asset_record = Some(receipt);
        }
        let (asset_peak, asset_final, asset_count, asset_total, asset_checksum) =
            asset_record.unwrap();
        println!(
            "{}",
            format_asset_record(
                asset_peak,
                asset_final,
                asset_count,
                asset_total,
                asset_checksum
            )
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        font_atlas_blob, format_asset_record, resource_checksum, structural_tick, timing_capacity,
        AllocationLedger, AssetInputs, ASSET_FONT_SLOTS,
    };
    use pocketjs_core::Ui;

    #[test]
    fn reserves_all_measurement_entries() {
        assert_eq!(timing_capacity(), 60);
    }

    #[test]
    fn structural_schedule_is_fixed_and_coalesced() {
        assert_eq!((0..16).filter(|&tick| structural_tick(tick)).count(), 4);
        assert_eq!((0..12).filter(|&tick| structural_tick(tick)).count(), 3);
    }

    #[test]
    fn fixture_atlas_loads_and_has_workload_glyphs() {
        let mut ui = Ui::new();
        assert!(ui.load_font_atlas(&font_atlas_blob(0)));
        let font = ui.font_atlas(0).unwrap();
        let (workload_gid, _) = font.lookup('P' as u32).unwrap();
        assert!(font
            .glyph_rows(workload_gid)
            .iter()
            .any(|&coverage| coverage != 0));
        assert_eq!(ui.measure_text("P", 0), 8.0);
    }

    #[test]
    fn ledger_preserves_pre_measurement_realloc_state() {
        let mut ledger = AllocationLedger::new();
        ledger.alloc(0x1000, 16, false);
        ledger.begin_measurement();

        let event = ledger.realloc(0x1000, 0x2000, 32);
        assert_eq!(event, Some((16, false)));
        assert_eq!(ledger.dealloc(0x2000), Some((32, false)));

        ledger.alloc(0x3000, 8, true);
        let event = ledger.realloc(0x3000, 0x4000, 12);
        assert_eq!(event, Some((8, true)));
        assert_eq!(ledger.dealloc(0x4000), Some((12, true)));
    }

    #[test]
    fn asset_record_has_stable_measurement_shape() {
        let record = format_asset_record(1, 2, 3, 4, 0x0123_4567_89ab_cdef);
        assert_eq!(
            record,
            "asset-workload peak_requested_bytes=1 final_requested_bytes=2 allocation_count=3 total_allocated_bytes=4 resource_checksum=0123456789abcdef"
        );
    }

    #[test]
    fn asset_workload_installs_resources_with_stable_checksum() {
        let fixture = AssetInputs::new();
        let inputs = fixture.inputs();
        let mut first_ui = Ui::new();
        let mut first_handles = vec![-1; inputs.len()];
        let first_styles_loaded = first_ui.load_assets(&inputs, &mut first_handles).is_ok();
        assert!(first_styles_loaded);
        for (kind, handle) in fixture.kinds.iter().zip(&first_handles) {
            match kind {
                pocketjs_core::assets::AssetKind::Styles
                | pocketjs_core::assets::AssetKind::Font => assert_eq!(*handle, -1),
                pocketjs_core::assets::AssetKind::Image
                | pocketjs_core::assets::AssetKind::Sprite => {
                    assert!(*handle >= 0);
                    assert!(first_ui.texture(*handle).is_some());
                }
            }
        }
        for slot in ASSET_FONT_SLOTS {
            assert!(first_ui.font_atlas(slot).is_some());
        }
        let first_checksum =
            resource_checksum(&first_ui, &fixture, &first_handles, first_styles_loaded);

        let mut second_ui = Ui::new();
        let mut second_handles = vec![-1; inputs.len()];
        let second_styles_loaded = second_ui.load_assets(&inputs, &mut second_handles).is_ok();
        assert!(second_styles_loaded);
        let second_checksum =
            resource_checksum(&second_ui, &fixture, &second_handles, second_styles_loaded);

        assert_eq!(first_checksum, second_checksum);
        assert_eq!(first_checksum, 0xf2f7_a1ac_65b9_ff90);
    }

    #[test]
    fn asset_checksum_covers_the_installed_styles_fixture() {
        let fixture = AssetInputs::new();
        let inputs = fixture.inputs();
        let mut original_ui = Ui::new();
        let mut original_handles = vec![-1; inputs.len()];
        let original_styles_loaded = original_ui.load_assets(&inputs, &mut original_handles).is_ok();
        let original_checksum =
            resource_checksum(&original_ui, &fixture, &original_handles, original_styles_loaded);

        let mut changed_fixture = AssetInputs::new();
        changed_fixture.blobs[0][16] ^= 1;
        let changed_inputs = changed_fixture.inputs();
        let mut changed_ui = Ui::new();
        let mut changed_handles = vec![-1; changed_inputs.len()];
        let changed_styles_loaded = changed_ui.load_assets(&changed_inputs, &mut changed_handles).is_ok();
        let changed_checksum =
            resource_checksum(&changed_ui, &changed_fixture, &changed_handles, changed_styles_loaded);

        assert!(original_styles_loaded);
        assert!(changed_styles_loaded);
        assert_ne!(original_checksum, changed_checksum);
    }
}
