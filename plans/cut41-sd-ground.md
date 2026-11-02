# Cut #41 — Digit1 GOOD ground (Open3DHK tiles primary / Megascans bridge)

**Repo:** keithligh/slop-hongkong  
**Base tip:** `c2eeeb0` (main after PR #40 three.js jsDelivr pin; Digit1 tip lineage through `ea3ff3a` / PR #39)  
**Source:** YOLO ground cut from Keith via Reviewer (2026-11-02). Brief: `/workspace/threads-hk-roadside/GOOD_GROUND_OPTIONS.md`. No Keith phone/drone walk; no asks to him.  
**Parallel:** Cut #40 far-frame Soft live A-B (ban Soft paint) stays on the board for a separate PR when cloud capacity allows — **do not** fold Soft-paint rewrite into this ground PR.  
**YOLO:** implement as next open PR from tip `c2eeeb0` after this plan is written. PR #40 is already taken (three.js pin) — open **PR #41** (or next free).

---

## 1. Problem (binding)

At Digit1 `?at=-1.4,29.3,1.29` looking east on Des Voeux, carriageway / kerb / sidewalk are still **procedural Soft mush**:

| Layer | Status |
| --- | --- |
| LandsD Individualised **BUILDING** glTF + PlanD hybrid | In place (Cuts #22–#39) |
| `js/hk-road-deck.js` + `createRoadSurfaceMaterial` / sidewalk / granite kerb | Procedural grit; **BAD ground** |
| NYC / ConEd manhole leftovers in `js/tsl-materials.js` `createRoadSurfaceMaterial` | Still drawn (hash cells + cast-iron lids) |
| Soft≠SD ownership on carriageway samples | **FAIL** — albedo is shader toy, not HK photo mesh |
| Open3DHK / LandsD **tile-based** 3D Tiles under Digit1 | **Missing** |

**TOP failure now (this cut):** ground under Digit1 eye is not GOOD — procedural asphalt lead failed. Stop polishing `hk-road-deck` grit as the Soft≠SD strategy.

---

## 2. Lead (pick what ships without Keith capture)

### 2.1 PRIMARY — LandsD Open3DHK / tile-based Cesium 3D Tiles (or INFRASTRUCTURE+TERRAIN glTF)

1. Mount LandsD **3D Visualisation Map (Tile-based models)** — Cesium 3D Tiles from CSDI / `data.map.gov.hk` Open3Dhk family — under the Digit1 Des Voeux eye disc in Three.js.
2. Keep Individualised BUILDING charts in front where they win; punch / yield procedural deck under tiles (same spirit as PlanD road carpet yield).
3. If full tileset streaming cannot land in **one** cut: mount LandsD Individualised **INFRASTRUCTURE** and/or **TERRAIN** glTF sheets for the Digit1 disc (same fetch/manifest pattern as BUILDING in `docs/HK_GLTF_CUT.md` / `tools/fetch-central-gltf-sheet.mjs`) as the ownership ground plate.
4. Attribute Government / CSDI per T&Cs.

### 2.2 THIS-WEEK BRIDGE (only if tiles / INFRA+TERRAIN cannot ship in this PR)

1. Delete NYC / ConEd manhole leftovers from `createRoadSurfaceMaterial` (required either way).
2. Fab / Megascans asphalt + granite kerb PBR on current `hk-road-deck` ribbons **only if** assets are already licensed in-repo or fetchable without Keith. Do **not** invent Megascans paths or commit proprietary blobs without a clear Fab Standard claim in the PR.
3. Megascans alone = Soft-looking bridge — **not** Soft≠SD PASS unless tiles/photo mesh own the Soft sample (Reviewer hold).

### 2.3 Ban as lead

Mapillary / KartaView bake; Google Photorealistic offline extract; Meshy as Soft carriageway; more procedural grit polish as the Soft≠SD answer; UE5 abandon-browser jump.

### 2.4 Holds

Soft≠SD; Soft MSI **live A-B only** (no synthetic paint); Soft must not override Keith eye; #22–#37 holds; orange / ashlar veto; Cut #40 Soft live A-B far-frame remains separate; no Sleeping Dogs claim.

---

## 3. Approach (falsifiable)

**Goal at Digit1 eye:** carriageway / kerb / near sidewalk read as **photo-owned** ground (Open3DHK tiles or LandsD INFRA/TERRAIN plate), not ConEd manholes + procedural grit. Soft primary for this cut cites **live MSI A-B** on ground crops (asphalt / kerb band) vs tip `c2eeeb0` BEFORE — green only with real pixel Δ. SD NOT YET.

### 3.1 Inventory (agent verifies)

1. Digit1 eye ground samples: asphalt underfoot, granite kerb band, sidewalk flags within ~40 m.
2. Current first-hit layers on those rays (`hk-road-deck` asphalt / curb / sidewalk vs coast fill vs PlanD vs LandsD).
3. Available LandsD tile-based tileset URL + key path (env / docs) **or** INFRASTRUCTURE/TERRAIN sheet availability next to BUILDING.

### 3.2 Implement (smallest falsifiable)

1. **Kill NYC manholes** in `js/tsl-materials.js` `createRoadSurfaceMaterial` (ConEd / sewer lid hash) — always in this PR.
2. **PRIMARY path:** Three.js 3D Tiles loader (or existing compatible helper) streaming Open3DHK tile-based mesh for Central Digit1 disc; depth / render order so BUILDING charts and playable deck collision stay sane; yield / punch procedural asphalt under tile coverage in that disc.
3. **Fallback in same PR if tiles blocked:** wire INFRASTRUCTURE+TERRAIN Individualised glTF for the Digit1 disc; same yield rules.
4. **Bridge-only path if both lag:** manhole kill + documented Megascans bind **only with real assets**; Soft must **not** claim Soft≠SD ownership PASS on Megascans alone — gate labels bridge Soft-looking, ownership open.
5. Soft bar (agent names, e.g. `digit1GroundOwnership`): **PASS only** on live MSI A-B MAD+grain on ground crops vs BEFORE; **FAIL** if Soft green on synthetic paint / static path / manhole-only delta with no ownership change.
6. Docs: `docs/HK_GROUND_TILES_CUT.md` (or extend `HK_ROADS_CUT.md`) — what mounted, attribution, residual (aerial GSD vs phone eye, LOD melt).
7. Tests: manholes gone; tiles/INFRA mount path; Soft contract unit + note MSI live A-B floors.

### 3.3 MSI Digit1 gate

Eye: `?at=-1.4,29.3,1.29`  
Crops: asphalt underfoot / kerb south / sidewalk band (reuse `artifacts/digit1-eye-east-kerb*.png` naming if useful).  
A-B vs tip `c2eeeb0` BEFORE. Primary Soft = live ground ownership Δ. Far-frame Soft paint rewrite is **out of scope** here.

---

## 4. Out of scope

- Cut #40 Soft synthetic `measureDigit1FarFrame` rewrite / far NDC occlusion (parallel cut)
- Keith phone / drone capture
- Mapillary / Google Photorealistic bake / Meshy carriageway lead
- More procedural grit as Soft≠SD answer
- UE5 rewrite
- Orange / ashlar / enamel remount
- Sleeping Dogs claim

---

## 5. Success

1. PR from tip `c2eeeb0` with: NYC manhole kill + (Open3DHK tiles **or** INFRA/TERRAIN plate under Digit1) **or** honest Megascans bridge labeled non-ownership; Soft live A-B ground bar; tests; docs; this plan.
2. MSI Digit1 Soft PASS only if live Keith-eye ground crops clear floors **and** ownership path is tiles/photo mesh (Megascans-only → Soft-looking, ownership open / no Soft≠SD PASS claim).
3. Ping Reviewer with tip + PR for PASS/FAIL + next premise.
4. Success = Digit1 ground no longer reads ConEd + Soft grit as the lead — **not** a Sleeping Dogs claim.

---

## Shipped

Primary path. LandsD `f2` 3D Tiles under the Digit1 disc, manhole lids removed, procedural deck yielded inside 42 m once a photographed tile samples the eye. Individualised BUILDING triangles above y = 1.8 stay in front. No Megascans. `digit1GroundOwnership` does not pass without a live MSI crop. See docs/HK_GROUND_TILES_CUT.md.
