# Android TV Floor Performance Report — Sports Legacy vs Document

- **Measured At**: `2026-11-24T18:23:21.345Z`
- **Target Floor Profile**: `vela-tv-floor` on `gpu-workstation` (budget Google TV stick class: onn 4K / Chromecast with Google TV)
  - **Display**: `1920x1080` @ `320 dpi`
  - **Memory**: `1972 MB` RAM
  - **CPU**: `4` vCPUs throttled via `systemd-run --user -p CPUQuota=200%` (Cortex-A55 class)
- **Compared Builds**:
  - **Legacy**: `/screen/sports` @ `49522fc6`
  - **Document**: `/screen/sports` @ `b96ea78e`
- **Budgets**:
  - First frame: `<= 400 ms`
  - Focus move `p95`: `<= 16 ms`
  - Single live record push: `<= 2 frames` (re-rendering only its readers)

## Summary Comparison

| Metric | Budget | Legacy (`/screen/sports` @ `49522fc6`) | Document (`/screen/sports` @ `b96ea78e`) | Delta (Doc - Legacy) | Document Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **First-frame time** (route entry to first rendered frame) | `<= 400 ms` | **16.9 ms** (peak mount frame: 483.60 ms, 17 frames) | **17.0 ms** (peak mount frame: 342.67 ms, 18 frames) | +0.0 ms | **PASS** |
| **Focus-move frame time (`p95`)** (16 D-pad moves) | `<= 16 ms` | **148.96 ms** (`p50`: 16.89 ms, `max`: 164.70 ms, frames: 31, jank: 20) | **88.41 ms** (`p50`: 16.93 ms, `max`: 90.72 ms, frames: 29, jank: 25) | -60.55 ms | **FAIL** |
| **Single live record push cost** (frames & reader isolation) | `<= 2 frames` & readers-only | **0 frames** (`p95`: 0.00 ms, `max`: 0.00 ms) | **0 frames** (`p95`: 0.00 ms, `max`: 0.00 ms; invalidated items: **4/33** vs **4** actual readers) | +0 frames | **PASS** (frames: PASS, isolation: PASS) |

## Detailed Findings for W3 (TV Focus & Perf Fixes)

### 1. Single Record Push Reader Isolation (`packages/skin/src/screen/host.tsx` & `packages/skin/src/blocks/record-scope.tsx`)
- **Pushed Record**: `event:sports:sports:nfl-nyg-phi`
- **Total Collection Items Rendered on Sports Index**: `33` (across hero, leagues, Your teams, Live now, schedule, standings, and team picker)
- **Actual Reader Items for `event:sports:sports:nfl-nyg-phi`**: `4` items
- **Currently Invalidated Items on Single Record Push**: `4/33` items (`rootReadsTotalRecords = 0`)
- **With Per-Item `useRecordReader()`**: `4/33` items
- **Summary**: Per-item ScopedRecordNode (ShelfBlock/GridBlock/MarqueeBlock) and per-node useScopedReads isolate live record pushes to only the items reading the pushed record.

### 2. Focus-Move Frame Distribution (16 D-pad steps)
- **Legacy (`/screen/sports` @ `49522fc6`)**:
  - Frames rendered: `31`
  - `p50 = 16.89 ms`, `p95 = 148.96 ms`, `max = 164.70 ms`, `mean = 40.42 ms`
  - Jank frames (`> 16.67 ms`): `20` (`64.5%`)
- **Document (`/screen/sports` @ `b96ea78e`)**:
  - Frames rendered: `29`
  - `p50 = 16.93 ms`, `p95 = 88.41 ms`, `max = 90.72 ms`, `mean = 36.53 ms`
  - Jank frames (`> 16.67 ms`): `25` (`86.2%`)
