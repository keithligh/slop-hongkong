# Cut #46 — Digit1 aerial GSD / LOD seams under LandsD tiles

**Repo:** keithligh/slop-hongkong  
**Base tip:** `0a71f80` (main after PR #45 Soft residuals PASS)  
**Source:** Reviewer PASS tip 0a71f80 / PR #45 (2026-11-03). Soft Soft-grain far (#43/#44) stays STOPPED unless Keith asks. Next premise: lead aerial GSD / LOD seams under tiles — not Soft Soft-grain, not Soft paint.  
**Cloud model:** `claude-sonnet-5-5` (Claude Sonnet 5.5) — Keith binding.  
**Prior Soft:** `/workspace/msi-street-ground45/gate.json` — digit1GroundResiduals PASS (right-kerb MAD 62.09 Δ+0.59; underfoot MAD 12.88 Δ+0.40; tiles). Soft≠SD; SD NOT YET. Soft PASS ≠ Keith eye.

---

## 1. Problem (binding)

At Digit1 `?at=-1.4,29.3,1.29`, Open3DHK/LandsD tiles own the ground and Soft residual floors cleared (#45). Keith-eye still soft because the **source** is oblique aerial ~2 cm/texel ETC1S with visible **LOD seams / GSD mismatch** between neighbouring tiles (docs: neighbours 2–5 cm/texel; 0.5 cm tiles are building bases, not carriageway; `f2` only tileset served).

**TOP failure now:** aerial GSD / LOD seam readability under already-mounted tiles at phone eye — not Soft Soft-grain far-frame, not Soft paint, not ownership-open.

Should-fix from Reviewer: Soft PASS ≠ Keith eye while aerial GSD + ETC1S soft at phone mag.

---

## 2. Lead (falsifiable)

1. **PRIMARY:** Reduce Digit1-eye **LOD seams / GSD discontinuities** between LandsD/Open3DHK ground tiles (selection, geometric/error bias, transition blending, neighbour LOD lock, or honest higher-res tile preference where the host actually serves it). Prefer real LandsD/Open3DHK content — do not invent phone-detail grit.
2. Soft bar (agent names, e.g. extend ground Soft or a seam-specific live A-B): live MSI A-B only; PASS only with tiles|infra|terrain ownership and measured Keith-eye Δ that cites seam/GSD crops (not Soft Soft-grain far metrics; not Soft paint). Document floors honestly; Soft≠SD.
3. HOLD: Soft Soft-grain far Cuts STOPPED; Soft paint ban; far NDC LandsD-first; #41 mount + #45 photo reconstruction unless a proven seam fix needs a surgical change.
4. Ban as lead: Soft Soft-grain far (#43/#44); Soft paint; Megascans-only Soft≠SD claim; synthesizing asphalt detail the aerial never had; Sleeping Dogs claim.

---

## 3. Approach (smallest falsifiable)

1. Inventory Digit1 eye LOD/GSD: which tiles meet at right-kerb / underfoot / road-ahead; seam screenshots; host levels (`f2` vs others); leaf LOD already confirmed for eye tile `L21_00102210`.
2. Smallest fix that reduces live seam/GSD discontinuity at phone eye (LOD force/neighbour lock, geometric error, crossfade, atlas/mip only if it reduces seam without Soft paint).
3. Soft live A-B vs tip `0a71f80` AFTER (or document why another BEFORE); Soft Soft-grain far out of scope.
4. Docs: residual aerial GSD vs phone eye if still visible after Soft floors.
5. Tests for Soft bar + no Soft Soft-grain reopen.

### MSI Digit1 gate

Eye: `?at=-1.4,29.3,1.29`  
Primary Soft: live A-B on seam/GSD crops the agent names (plus residual holds on right-kerb/underfoot if touched).  
Store under `/workspace/msi-street-ground46/` (or next free). Soft≠SD; SD NOT YET.

---

## 4. Out of scope

- Soft Soft-grain far-frame / Lippo mip3 / lit far-chart (#43/#44) — STOPPED
- Soft paint rewrite
- Far NDC rewrite
- Keith phone/drone capture as lead
- Sleeping Dogs claim

---

## 5. Success

1. PR from tip `0a71f80` via Cursor cloud **Claude Sonnet 5.5** with LOD/GSD seam fix; tests; docs; this plan.
2. MSI Soft PASS only on live seam/GSD floors with tiles ownership — Soft≠SD; Soft PASS ≠ Keith eye; SD NOT YET.
3. Ping Reviewer with tip + PR for PASS/FAIL + next premise.
4. Do **not** resume Soft Soft-grain far Cuts unless Keith asks.

---

## Shipped

Inventory at `0a71f80` (published tileset `f2`, 51 tiles mounted, headless frame): the eye tile `Tile_+230_+104_L21_00102210` is 2.1 cm per texel on the ground band; the north half of the carriageway is `Tile_+230_+105_L20_0000000`, a leaf at 4.0 cm (no finer child; the host serves nothing finer). The two meet at z = 28.6, 0.7 m north of the eye, and that line runs ahead along the avatar's left. Neighbouring tiles overlap by a strip 0.2 to 0.3 m wide whose two surfaces agree to 2 mm, so which photograph shows was decided triangle by triangle by depth noise (`polygonOffset` 1/1 is nothing on the 32-bit reversed depth buffer): the seam was a ragged tooth edge, 5.6 px rms, not a line. Across the clean seam the photographs agree in luma (26.9 against 27.0) and in grain (1.47 against 1.42), so the readable seam was the GSD step and the teeth.

Fix: each tile moves vertically by 4 mm per cm of GSD relative to the eye tile, so the finer photograph always owns an overlap and the eye tile does not move. `?groundPriority=off` is the #45 mount for the A-B. `?groundTint=gsd|tile` paints tiles by GSD or file; `tools/digit1-ground-seam.mjs` scores a tint and photograph pair; `tools/digit1-ground-seams.html` is a plan view. `digit1GroundSeams` is the Soft bar. Numbers and what was tried and not shipped are in docs/HK_GROUND_TILES_CUT.md. MSI live A-B decides Soft. Soft is not SD; SD NOT YET.
