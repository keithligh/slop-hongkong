# Cut #45 — Digit1 right-kerb + underfoot grain under LandsD tiles

**Repo:** keithligh/slop-hongkong  
**Base tip:** `22d91a4` (main after PR #44 Soft lit far-chart unlit; Soft Soft-grain still FAIL — **out of scope**)  
**Source:** Keith STOP Soft Soft-grain (2026-11-02 ~21:28 HKT) → asked Cursor + Claude Sonnet 5.5 → asked Jev. Jev choice `right_kerb_underfoot` P≈0.763 conf 0.684 (review band). Soft Soft-grain YOLO loop stays STOPPED.  
**Cloud model:** `claude-sonnet-5-5` (Claude Sonnet 5.5) — Keith binding.  
**Prior gate:** `/workspace/msi-street-ground41/gate.json` tip `007d61f` / PR #41 — Soft PASS overall; **OPEN residuals:** right-kerb |grainΔ| 0.022; underfoot |grainΔ| 0.156 (both MAD≫6 + tiles ownership; Soft grain floor was |grainΔ|≥0.35).

---

## 1. Problem (binding)

At Digit1 `?at=-1.4,29.3,1.29` looking east on Des Voeux, Open3DHK/LandsD 3D Tiles own the ground rays (mounted 39 / yield 69 at #41), and road-ahead + south-kerb cleared Soft live MAD+grain floors. **Right-kerb and underfoot still fail the Soft grain floor** — huge MAD vs procedural BEFORE, but grain barely moved:

| Crop | #41 MAD | #41 grainΔ | Soft grain floor | Status |
| --- | --- | --- | --- | --- |
| road-ahead | 40.24 | −2.96 | |grainΔ|≥0.35 | PASS |
| south-kerb | 37.76 | −3.31 | |grainΔ|≥0.35 | PASS |
| right-kerb | 34.49 | +0.022 | |grainΔ|≥0.35 | **OPEN** |
| underfoot | 40.02 | +0.156 | |grainΔ|≥0.35 | **OPEN** |

Hypothesis (non-binding — agent must verify): tiles own the ray but right-kerb/underfoot samples still read soft/melted (LOD, atlas GSD, mip, or procedural deck still bleeding underfoot) so high-frequency grain does not shift enough vs BEFORE mush.

**TOP failure now:** right-kerb + underfoot Soft grain residual under already-mounted LandsD tiles — not Soft Soft-grain far-frame, not Soft paint.

---

## 2. Lead (falsifiable)

1. **PRIMARY:** Improve Digit1-eye **right-kerb** and **underfoot** photo grain under existing Open3DHK/LandsD ground tiles (LOD bias / closer tile priority / mip / atlas / yield punch so procedural deck cannot win those Soft crops). Prefer real LandsD/Open3DHK content over invented grit.
2. Soft bar name (agent confirms or extends): `digit1GroundOwnership` live MSI A-B on **right-kerb** and **underfoot** crops vs tip `c2eeeb0` BEFORE (same BEFORE lineage as #41) **or** vs tip `007d61f` AFTER if that is the honest A-B for residual grain — document which. PASS only if ownership still tiles|infrastructure|terrain **and** live MAD≥6 **and** |grainΔ|≥0.35 on **both** right-kerb and underfoot (or agent names a tighter Keith-eye equivalent and proves it).
3. HOLD: Soft Soft-grain far-frame Cuts (#43/#44 style mip3 / lit→unlit chart) — **do not reopen**. Soft paint ban HOLD. Far NDC LandsD-first HOLD. #41 mount path HOLD unless a proven yield/LOD fix needs a surgical change.
4. Ban as lead: Soft paint / static Soft; inventing sidewalk props when OSM/LandsD already cover; NYC leftovers; Megascans-only Soft≠SD claim; Sleeping Dogs claim.

---

## 3. Approach (smallest falsifiable)

1. Inventory Digit1 right-kerb + underfoot Soft crops and ray first-hits at tip `22d91a4` (confirm still `HkGroundTile` / landsd-3dtiles; note LOD/mip/yield).
2. Fix only what blocks Soft grain floors on those two crops (tile LOD/selection, yield radius, deck punch, mip bias, atlas sample) — smallest change that moves live |grainΔ|.
3. Soft contract: live A-B only; FAIL if Soft green on synthetic paint / static path / far Soft Soft-grain metrics.
4. Docs note residual (aerial GSD vs phone eye) if still visible after Soft floors clear.
5. Tests for Soft floors + ownership path; no Soft Soft-grain far-frame regression work.

### MSI Digit1 gate

Eye: `?at=-1.4,29.3,1.29`  
Primary Soft: right-kerb + underfoot live A-B grain floors (MAD+grain as above).  
Reuse `/workspace/msi-street-ground41/` crop naming where useful; store new gate under `/workspace/msi-street-ground45/` (or next free).  
Soft≠SD; SD NOT YET.

---

## 4. Out of scope

- Soft Soft-grain far-frame / Lippo mip3 / lit far-chart unlit (#43/#44) — STOPPED
- Reverting #43/#44 unless Keith asks
- Far NDC rewrite
- Soft paint rewrite
- Keith phone/drone capture
- Orange/ashlar/enamel remount
- Sleeping Dogs claim

---

## 5. Success

1. PR from tip `22d91a4` via Cursor cloud agent **Claude Sonnet 5.5** (`claude-sonnet-5-5`) with right-kerb + underfoot Soft grain fix; tests; docs; this plan.
2. MSI Digit1 Soft PASS only on live right-kerb **and** underfoot floors with tiles ownership — Soft≠SD; SD NOT YET.
3. Ping Reviewer with tip + PR for PASS/FAIL + next premise.
4. Do **not** resume Soft Soft-grain far Cuts unless Keith explicitly asks.

---

## Shipped

Inventory at `22d91a4`: tiles own the rays, the eye tile is already the finest leaf (about 2 cm per texel, single-level ETC1S KTX2, bilinear, anisotropy 1), and the deck is punched. The grain was missing from the read. `hkGroundTilePhoto` is now a node material that reconstructs the tile photograph (Catmull-Rom plus a luma unsharp of its own texels) where it is magnified. `?groundPhoto=plain` is the A-B escape. Honest A-B is against `c2eeeb0`; headless numbers and the non-monotone `|grainΔ|` caveat are in docs/HK_GROUND_TILES_CUT.md. MSI live A-B decides Soft. Soft is not SD; SD NOT YET.
