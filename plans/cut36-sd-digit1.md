# Cut #36 — Digit1 still-chartless mid-band photo (BUILDING glTF hunt)

**Repo:** keithligh/slop-hongkong  
**Base tip:** `52cb1b6ae870b8116f8c084895f966446008db8f` (PR #35 BoC Tower LandsD photo from `11-SW-14A` CLEARED; MSI SOFT_PASS_SD_NOT_YET; Reviewer PASS)  
**Reviewer PASS tip 52cb1b6 / PR #35:** BLOCKING none. `digit1PhotoFidelity` PASS — pin sheet `11-SW-14A` kept 1 = `B346831557701063A0`; second-hits right_mid/_up/_far = HkGltfBuilding @212–217 m; Keith eye bocplate = LandsD white diagrid, not #32 prism. Mid-band still chartless procedural shopfront — expected non-FAIL for #35. Soft `centre_low` @299.95 / `right_mid_low` @180.36 — still NOT a FAIL. **SD NOT YET — BoC plate is photo, but Digit1 canyon mid-band walls remain procedural stand-in.**  
**Evidence:** `/workspace/msi-street-photo35/gate.json`, bocplate AFTER/BEFORE, midfar, plandOff. Prior: facade34 / midband33 / bocface / boc. Plans: `cut27`…`cut35-sd-digit1.md`. SD refs: `/workspace/sleeping-dogs-ref/central-street-level-shops-towers.png`, harbour BoC.  
**YOLO:** implement as PR #36 from tip `52cb1b6` after this plan is written.

---

## 1. Problem (TOP Digit1 failure AFTER BoC photo clear — binding)

At Digit1 `?at=-1.4,29.3,1.29` looking east on Des Voeux, **after** Cut #35:

| Layer | Status |
| --- | --- |
| #27–#34 slime / ground / flank / aniso / BoC ownership+identity / mid-band ownership+facade | **CLEARED** |
| #35 BoC Tower LandsD photograph (`11-SW-14A`) | **CLEARED** — second-hit glTF photo; prism skipped when manifest present |
| Soft residual `centre_low` / `right_mid_low` | Distant PlanD @~300 / apron @180 — **still waived** |
| BoC atlas grain/stretch | Co-residual only unless Keith eye flips it to dominate full-frame — **do not lead** |
| **Still-chartless mid-band photo** | **OPEN** — plates between near LandsD flanks and BoC still lack BUILDING glTF (Active rings miss on 9C/8D/14A bounds). Procedural `HkMidbandCanyon` shopfront+grid owns the band. |

**Proof:**

- #33–#35: Active footprints miss canyon hits (BoC Building ~25–29 m, CKC ~39 m, left Murray gap ≥56 m). Bounds pass of every BUILDING on `11-SW-9C` (73) and `11-SW-14A` (204) left hits outside every mesh.
- **Lesson from #35:** BoC photo lived on sheet **`11-SW-14A`**, which earlier audits never opened. Mid-band may similarly sit on an **unopened adjacent sheet** (or a BUILDING mass whose centroid is off-plate but mesh bounds cover the ray). Do not treat “9C+8D miss” as proof no sheet exists anywhere.
- Digit1 full-frame / midfar / canyon zooms still fail SD street ref because mid-band walls are procedural, not photograph.

**TOP Sleeping Dogs blocker now:** **still-chartless mid-band photo** — find and mount LandsD/Open3Dhk BUILDING glTF covering the canyon look-frame plates (right ≈(84.9,14.7,77.3)/(80.9,18.3,71.1); left ≈(141.2,21.6,44.1)), the way #35 found BoC on 14A. Soft MSI PASS must not ship as SD.

---

## 2. Root cause (premise attack)

### 2.1 What #35 proved

- BoC plate photograph exists on an adjacent pin sheet — **cleared** as the prism co-residual lead.
- Mid-band rediscovery on 9C/8D/14A bounds alone — **still miss**. Residual SD gap = mid-band photo, not BoC atlas polish, not soft far PlanD.

### 2.2 Failed premise A — soft far / apron PlanD omit (do NOT continue)

Waived through #28–#35. Do not lead.

### 2.3 Failed premise B — another mid-band procedural enamel/mullion densify (do NOT continue)

#34 cleared facade bar; Reviewer still SD NOT YET on **photo**. Another procedural polish without a photograph is exhausted as the lead.

### 2.4 Failed premise C — “9C+8D+14A miss ⇒ no mid-band BUILDING exists” (attack)

**Premise:** audits of street-chase + 14A prove mid-band must stay chartless forever.

**Counter:** #35 BoC was on a sheet those same “street” audits skipped. Mid-band hits may sit on other SW sheets (e.g. 14B, 13A/B, 15A, 10D, 12C — agent verifies real sheet IDs from LandsD/Open3Dhk inventory), or a BUILDING whose **mesh AABB** covers the ray while centroid is outside Active ring / plate. Prefer mesh-bounds / ray-in-volume search over centroid-in-ring only.

**Attack:** Cut #36 primary is a **broader BUILDING sheet hunt + mount** for mid-band canyon plates (BoC-style pin sheet if needed). If after exhaustive MSI/repo sheet inventory still none, report that honestly and ship the smallest falsifiable photo-adjacent progress Reviewer can judge — **not** another enamel pass, **not** BoC grain polish as lead, **not** soft PlanD omit. Do not invent fake BUILDING charts.

### 2.5 Failed premise D — BoC atlas grain/stretch as primary (do NOT continue)

Reviewer: co-residual only unless Keith eye flips it to dominate full-frame (it does not — mid-band procedural dominates). Do not lead with BoC re-bake / aniso-only on 14A.

### 2.6 Holds (do not remount)

Ashlar (#26), orange (#22), blank mid-band omit without replacement, Mapillary, NYC, fake Murray 2024 podium.

---

## 3. Approach (falsifiable)

**Goal at Digit1 eye:** mid-band canyon walls (~90–160 m) owned by **LandsD/Open3Dhk BUILDING photograph(s)** where MSI finds covering meshes; shrink/retire `HkMidbandCanyon` where charts cover. Soft far/apron may remain. BoC 14A photo hold. Facade/Canyon ownership bars hold where boxes remain. **Do not claim Sleeping Dogs.**

### 3.1 Primary — mid-band BUILDING photo mount

1. **Inventory all candidate Central sheets** beyond 9C/8D/14A (agent lists from fetch tool / docs / Open3Dhk). For each, bounds-test BUILDING glTFs against live canyon hit points (and optional thin ray samples along mid-band plates). Prefer mesh AABB / triangle proximity over Active-ring centroid only.
2. **If covering BUILDING(s) found:** pin-mount (BoC 14A pattern — keep only covering mesh(es) so cap slots stay sane); yield PlanD already omitted; first-hit / early-hit on mid-band picks becomes `HkGltfBuilding`; shrink or hide overlapping `HkMidbandCanyon` faces so photo owns the sample.
3. **If still none after exhaustive hunt:** document the sheet list + miss distances; do **not** fake a chart. Prefer the smallest honest alternative that still advances Digit1 mid-band **photo** read (e.g. mount a near-miss Building that can own more of the look if MSI proves the ray grazes it after pin/yield — only if falsifiable). If truly blocked, leave mid-band procedural and FAIL the primary photo-midband bar honestly rather than enamel-polish PASS.

**Falsifiable:**

- Mid-band picks (`right_midfar` / `_up` / `left_midfar`) include LandsD BUILDING chart on the canyon band, **or** Keith eye midfar/canyon zooms clearly show photograph where #35 showed procedural shopfront — **or** Cut reports exhaustive miss with evidence (then primary FAIL / soft path Reviewer named, not a fake PASS).
- BoC `digit1PhotoFidelity` + 14A second-hits still PASS.
- Soft `centre_low` / `right_mid_low` may remain.
- No ashlar / orange / void regress.

### 3.2 Explicit non-goals

- Do not primary soft PlanD @~300/@180.
- Do not another mid-band procedural densify as the lead.
- Do not BoC atlas grain/stretch polish as the lead.
- Do not remount ashlar/orange; no blank omit without replacement.
- Do not invent BUILDING meshes / Mapillary / NYC.
- Do not claim Sleeping Dogs.

---

## 4. MSI Digit1 gate (primary = mid-band photo)

Eye: `?at=-1.4,29.3,1.29`  
Hold midfar / canyon / facade zooms / bocplate (BoC photo hold) / plandOff. Fetch any new sheets on MSI before shooting (glTF gitignored).

**PASS requires all:**

1. **`digit1MidbandPhotoFidelity` (PRIMARY)** — mid-band canyon samples owned by LandsD BUILDING photograph(s) at Keith eye / picks; not procedural shopfront alone on those plates. Agent owns exact predicates.
2. Hold `digit1PhotoFidelity` (BoC 14A), Facade, Canyon, #32–#22 bars.
3. Soft far/apron may remain — do not FAIL solely on those.

**FAIL if:** no mid-band photo mounted and primary claimed green on procedural polish; or ashlar/orange/void/BoC photo regress.

Sleeping Dogs NOT YET even on soft PASS if other SD slices remain.

---

## 5. Implementation sketch (agent investigates and owns the diff)

- Broad sheet inventory + bounds/ray search first (lesson: 14A was the BoC unlock).
- Pin-sheet pattern from #35 if a new sheet is mostly irrelevant masses.
- `js/hk-gltf*.js` / fetch tool / docs — add sheet(s); tests for pin keep-count and mid-band hit coverage.
- Shrink/hide `HkMidbandCanyon` where photo covers.
- `tools/digit1-invader-gate.mjs` — add `digit1MidbandPhotoFidelity`; hold Photo + Facade + Canyon + prior.
- Docs: residual moves off “mid-band must stay procedural”; note soft far/apron; note BoC grain co-residual; **SD still not claimed**.

Open PR against main from tip `52cb1b6`. Title roughly: `Digit1 still-chartless mid-band photo — BUILDING glTF hunt (#36)`.

---

## 6. Done when

1. Plan at `/workspace/plans/cut36-sd-digit1.md`; YOLO implement PR #36 from tip `52cb1b6`.
2. Diff mounts mid-band BUILDING photo(s) **or** exhaustively documents miss without fake PASS; not enamel lead; not soft PlanD lead; not BoC grain lead; holds #22–#35.
3. MSI Digit1: primary mid-band photo bar green (or honest FAIL); report sheets searched, miss distances, before/after picks, whether canyon boxes shrank; fetch instructions for new sheets.
4. Success = Keith eye mid-band photograph (or honest blocker) — **not a Sleeping Dogs claim**.
