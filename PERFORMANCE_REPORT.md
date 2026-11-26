# Performance report — 26 November 2026

These are Node/SQLite simulations with controlled test transport. They do not measure production DAU capacity, Cloudflare billed CPU/rows, network latency, provider bandwidth or actual movie drift. Real workerd compatibility/idle reconstruction is tested separately.

| Participants | Rooms | Two-ping P50 ms | P95 ms | P99 ms | Read-only writes | Rejected writes | Record bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1 | 1.43 | 1.78 | 1.85 | 0 | 0 | 10,692 |
| 50 | 5 | 5.47 | 7.57 | 8.04 | 0 | 0 | 53,460 |
| 100 | 10 | 10.22 | 13.27 | 13.56 | 0 | 0 | 106,920 |
| 250 | 25 | 24.92 | 33.73 | 35.83 | 0 | 0 | 267,300 |
| 500 | 50 | 46.38 | 58.34 | 60.26 | 0 | 0 | 534,600 |

The 500-participant case performed 5500 read-only events and 450 unauthorized controls with zero room-record writes. Its 1000 accepted queue/chat mutations wrote 3500 logical rows. Index updates/alarm metering are not included. RSS is process-wide across cases, not per-room memory. Queue reorder/removal can update multiple ordering records.

Dirty-table plans now skip unrelated users/queue/chat/invites/status collections. Pure projections avoid read mutations; transient signaling/telemetry stays out of authoritative storage. This reduces unnecessary work, but no controlled hardware-matched before/after speedup percentage is claimed.

| Presence accounts | Friends/account | Rooms | Total workload ms | SQL statements | Returned rows | Targeted notifications |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 10 | 1 | 21.47 | 1084 | 766 | 1 |
| 250 | 10 | 5 | 59.16 | 4655 | 3472 | 5 |
| 500 | 10 | 10 | 104.23 | 9085 | 6832 | 10 |

Presence results include population, one friend-status query per account, a room departure and notification drain with mocked transport. These are instrumented statement/returned-row counts, not platform billing. The indexed directory remains single; no 10000-account sharding/throughput claim is made.

The accelerated lifecycle workload simulates 8 hours with 10 users, 32 reconstructions and 10560 read-only events with zero read-induced logical writes. A separate real-time in-process run lasted 60 seconds (30 samples). Neither is an eight-hour wall-clock media/network soak.

Native server delivery is bounded to 128 KiB/32 pending frames and 16 MiB of object-queued data, with 4 MiB maximum logical snapshots and chunk/reconnect recovery. Unit tests exercise large queues/slow readers; actual workerd exercises receipts/chunks and idle reconstruction. These bounds do not establish platform network-buffer behavior against dishonest receipt peers.

Clock requests coalesce and cancellation fences late samples. Native stable progress reports run every 15 seconds; foreground clock refresh runs every 120 seconds with smaller periodic samples. Authenticated clients re-supply credentials every five minutes. Timer-derived traffic estimates vary with visibility, reconnects and user activity; no exact wire count or billed-CPU number is inferred.

Reproduce with npm run test:benchmark, npm run test:presence, npm run test:soak and npm run test:runtime. JSON evidence is in docs/local-benchmark.json, docs/presence-benchmark.json and docs/soak-results.json.
