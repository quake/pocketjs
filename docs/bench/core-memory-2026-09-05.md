# Core Memory Benchmark Baseline

The receipt was measured on benchmark commit `708d215`, with the core code
from `bench-optimize/sep3` at `553d0fd`. `git_revision` identifies the
revision where the receipt was measured.

The byte values below are **allocator-independent requested-byte metrics** from
the counting allocator. They are not process RSS, committed pages, or PSP arena
high-water measurements. Timing values are host measurements and are excluded
from deterministic receipt comparisons.

## Reproduction

```text
cargo run --manifest-path engine/core/Cargo.toml --example membench --quiet
```

Toolchain: `rustc 1.97.1 (8bab26f4f 2026-07-14)`, `cargo 1.97.1 (c980f4866 2026-06-30)`.

Workload shape: 99 nodes; 24 steady ticks; 8 rounds of 4-node subtree churn;
16 text ticks; 12 burst ticks. Text and texture modes are both `atlas`.

## Receipt

| Field | Value | Meaning |
| --- | ---: | --- |
| `peak_requested_bytes` | 25281 | Peak requested bytes |
| `final_requested_bytes` | 6969 | Final live requested bytes |
| `allocation_count` | 9336 | Count of measured allocation events |
| `total_allocated_bytes` | 6195449 | Total requested bytes across measured allocation events |
| `avg_layout_us` | 723 | Host timing, excluded from canonical comparison |
| `max_layout_us` | 2462 | Host timing, excluded from canonical comparison |
| `nodes` | 99 | Workload node count |
| `structural_relayouts` | 16 | Structural relayout count |
| `drawlist_checksum` | `cc6a0b00efdba151` | Deterministic drawlist checksum |
