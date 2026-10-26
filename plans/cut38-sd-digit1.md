# Cut #38 — Digit1 on-eye LandsD atlas residual (BoC `_002`/`_003` + flank `_001`)

**Repo:** keithligh/slop-hongkong  
**Base tip:** `f5650466023878c0f09205d1dff06219d56e5373` (PR #37 Digit1 photo atlas fidelity — UV-crop+clamp+gutter-mip on chase charts; MSI SOFT_PASS_SD_NOT_YET; Reviewer PASS)  
**Reviewer PASS tip f565046 / PR #37:** BLOCKING none. `digit1PhotoAtlasFidelity` PASS. Grain vs photo35: bocplate 12.76→10.04 (Δ−2.73), midfar −1.01, rightcanyon −1.17. Soft PlanD @299.95/@180.36 waived. Midband photo stays false open residual. SD **NOT YET**.  
**Should-fix (non-blocking, becomes #38 lead):** Fixture/docs exemplars emphasized BoC `_001` left strip + flank `_002` left half, but **live Digit1 samples BoC `_002`/`_003` on the plate and flank `_001` on right_mid/_up/_far/_near** (only right_midfar seats flank `_002`). Runtime pack is UV-bounds-driven so those mats still improved — still, next Cut must aim at **on-eye materials**, not the fixture exemplars alone.  
**Evidence:** `/workspace/msi-street-atlas37/gate.json`, bocplate side-by-side, midfar/rightmid AFTER vs photo35 BEFORE. Plans: `cut27`…`cut37-sd-digit1.md`.  
**YOLO:** implement as PR #38 from tip `f565046` after this plan is written.

---

## 1. Problem (TOP Digit1 failure AFTER atlas #37 — binding)

At Digit1 `?at=-1.4,29.3,1.29` looking east on Des Voeux, **after** Cut #37:

| Layer | Status |
| --- | --- |
| #22–#36 invader / slime / ground / flank / aniso / BoC ownership+identity / mid-band ownership+facade / midband photo miss | **CLEARED or open residual only** |
| #37 photo atlas fidelity (UV-crop+clamp+gutter-mip on chase pack) | **CLEARED** as primary bar — fixture exemplars + pack path |
| Soft residual `centre_low` / `right_mid_low` | Distant PlanD @~300 / apron @180 — **still waived** |
| Mid-band procedural canyon / midband photo | Open residual — **do not re-lead** |
| **On-eye materials Digit1 actually samples** | **OPEN** — BoC plate `_002`/`_003` mosaic/grain + flank `_001` near/mid first-hits; rightmid grain Δ only −0.37; residual midfar still noisy (~9–10 grain) |

**Proof (Reviewer Cut #38 premise):**

- Live picks: BoC second-hits use `_002`/`_003` @212–217 m; flank first-hits on right_mid/_up/_far/_near use `_001`; only right_midfar seats flank `_002`.
- #37 pack still helps those mats via UV-bounds, but Keith-eye residual grain/mosaic on **those** materials dominates the remaining SD street-eye gap.
- Another generic pack pass that only retunes `_001`/`_002`-left fixtures is out of scope.

**TOP Sleeping Dogs blocker now:** **on-eye LandsD atlas residual** on materials Digit1 actually samples. Soft MSI PASS must not ship as SD.

---

## 2. Root cause (premise attack)

### 2.1 What #37 proved

- UV-crop + clamp + gutter-mip on `packLandsdChart` clears the primary atlas bar for chase charts; bocplate / midfar / rightcanyon grain improved vs photo35.
- Fixture exemplars (BoC `_001` left strip, flank `_002` left half) are **not** the dominant Digit1-eye sample set.

### 2.2 Failed premise A — soft far / apron PlanD omit (do NOT continue)

Waived through #28–#37. Do not lead.

### 2.3 Failed premise B — enamel densify / ashlar / orange remount (do NOT continue)

Holds. Never remount.

### 2.4 Failed premise C — mid-band BUILDING photo re-hunt (do NOT continue)

#36 closed. Permanently chartless.

### 2.5 Failed premise D — another generic pack pass on fixture exemplars only (do NOT continue)

Do not only retune BoC `_001` left strip / flank `_002` left half fixtures. Aim at **on-eye** mats.

### 2.6 Active premise — on-eye material atlas fidelity (attack)

**Premise:** Digit1 eye residual grain/mosaic lives on the materials the ray actually hits — BoC `_002`/`_003` plate tiles + flank `_001` near/mid — not only on the fixture UV exemplars #37 documented.

**Attack:** Cut #38 primary is **clear Keith-eye grain/mosaic on those on-eye materials** (and prove it with picks + crops). Prefer real LandsD Individualised textures; no invented shiny materials; no Mapillary; no NYC; no new sheets as the lead unless investigation proves a missing on-eye chart (unlikely — same meshes).

**Hypothesis (non-binding — agent verifies):** residual may be per-jpg tile UV crop bounds, mip/aniso on `_002`/`_003`/`_001`, wrong sub-rect, atlas gutter on those tiles, or pack not applied to the live material ids. Investigate tip static picks + `packLandsdChart` / material load path; discard wrong guesses.

### 2.7 Holds (do not remount)

Ashlar (#26), orange (#22), blank mid-band omit without replacement, Mapillary, NYC, soft PlanD lead, mid-band BUILDING photo re-hunt, enamel densify as lead, fixture-only retune of `_001`/`_002`-left exemplars without on-eye coverage.

---

## 3. Approach (falsifiable)

**Goal at Digit1 eye:** materials Digit1 actually samples (BoC plate `_002`/`_003`, flank `_001` on right_mid/_up/_far/_near) show **clearer atlas fidelity** — measurable grain drop on bocplate / midfar / rightmid vs atlas37 BEFORE; Keith eye less mosaic tear / gutter grain on those tiles. Mid-band procedural residual may remain documented. Soft far/apron may remain. Holds #22–#37. **Do not claim Sleeping Dogs.**

### 3.1 Primary — on-eye atlas residual

1. **Inventory live Digit1 picks** from tip `f565046` / atlas37 gate: BoC second-hits `_002`/`_003`; flank first-hits `_001`; right_midfar flank `_002`.
2. **Diagnose / fix atlas path for those material ids** (UV crop bounds, mip, clamp, gutter, pack assignment). Prefer smallest fix that clears Keith-eye residual on bocplate + midfar + rightmid vs atlas37 BEFORE.
3. **Do not** only retune fixture exemplars; do not lead soft PlanD / enamel / midband photo hunt; do not invent materials.
4. Add / tighten MSI gate primary bar (agent owns exact name, e.g. `digit1OnEyeAtlasFidelity` or extend `digit1PhotoAtlasFidelity` with on-eye predicates); keep `digit1MidbandPhotoFidelity` as open residual (false); overall `pass` must not require mid-band photo.
5. Docs: residual moves off “generic chase pack / fixture exemplars”; note on-eye mats; note soft far/apron; **SD still not claimed**.

### 3.2 MSI Digit1 gate (primary = on-eye atlas)

Eye: `?at=-1.4,29.3,1.29`  
Hold bocplate / midfar / rightmid / canyon / plandOff; A-B vs atlas37 BEFORE. Sheet `11-SW-14A` must be present on MSI (pin kept 1 = BoC). Soft PlanD @~300/@180 waived — do not FAIL solely on those.

**PASS requires:** primary on-eye atlas bar true; prior #22–#37 holds; midband photo may stay false open residual; Soft PASS ≠ SD claim.

**FAIL if:** only fixture exemplars retuned while on-eye `_002`/`_003`/`_001` grain/mosaic unchanged; or ashlar/orange/BoC photo regress.

Sleeping Dogs NOT YET even on soft PASS.

---

## 4. Out of scope

- Soft PlanD @~300/@180 as lead
- Enamel densify / ashlar / orange remount
- Mid-band BUILDING photo re-hunt / fake charts
- Another generic pack pass that only retunes `_001`/`_002`-left fixtures
- Mapillary / NYC / invented shiny materials
- Sleeping Dogs claim

---

## 5. Success

1. PR #38 from tip `f565046` with on-eye atlas fix + gate primary + docs.
2. MSI Digit1 Soft PASS (or honest FAIL) with primary on-eye bar; SD NOT YET.
3. Reviewer PASS/FAIL + Cut #39 premise.
4. Success = Keith eye cleaner on BoC `_002`/`_003` + flank `_001` samples — **not a Sleeping Dogs claim**.
