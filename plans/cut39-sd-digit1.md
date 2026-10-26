# Cut #39 — Digit1 far-frame / look-corridor LandsD fidelity (past ~200 m)

**Repo:** keithligh/slop-hongkong  
**Base tip:** `af12a8bde08f417c67d80496c45a39c304516705` (PR #38 Digit1 on-eye atlas — face-pack for BoC `_002`/`_003` + flank `_001`; MSI Soft PASS static-only; **Reviewer FAIL BLOCKING**)  
**Reviewer FAIL tip af12a8b / PR #38:** BLOCKING. Plan required measurable grain drop + Keith-eye cleanup; bocplate bit-identical to atlas37 (MAD 0 / grain Δ0); midfar/rightmid Δ noise; Soft bar `digit1OnEyeAtlasFidelity` was static-only (no MAD/grain). Soft PASS must not override Keith eye. Holds #22–#37 intact; SD NOT claimed.  
**On-eye / face-pack atlas retired as lead** (#37 moved grain; #38 ≈ no-op at eye). Do not re-pack `_002`/`_003`/`_001` without a real Keith-eye delta.  
**Evidence:** `/workspace/msi-street-oneye38/gate.json`, grain-metrics.json, side-by-sides vs atlas37; prior atlas37 Soft PASS tip f565046. Plans: `cut27`…`cut38-sd-digit1.md`.  
**YOLO:** implement as PR #39 from tip `af12a8b` after this plan is written.

---

## 1. Problem (TOP Digit1 failure AFTER on-eye atlas miss — binding)

At Digit1 `?at=-1.4,29.3,1.29` looking east on Des Voeux, **after** Cut #38:

| Layer | Status |
| --- | --- |
| #22–#37 invader / slime / ground / flank / aniso / BoC ownership+identity / mid-band / photo / chase atlas | **CLEARED or open residual** |
| #38 on-eye face-pack (`_002`/`_003`/`_001`) | **FAIL** — no Keith-eye delta; Soft static-only bar vetoed |
| Soft residual `centre_low` / `right_mid_low` | Distant PlanD @~300 / apron @180 — **still waived** |
| Mid-band procedural / midband photo | Open residual — **do not re-lead** |
| **Far-frame / look-corridor past ~200 m** | **OPEN** — curtain holes / loaded-chase triangle hits beyond midband stack; ownership + fidelity at midfar–far Digit1 eye |

**Proof (Reviewer Cut #39 premise):**

- Atlas packing (#37/#38) exhausted as lead for remaining midfar noise.
- Remaining SD street-eye gap is **outside atlas packing**: far-frame / look-corridor LandsD ownership past ~200 m (curtain holes, loaded-chase triangles beyond midband).
- Soft bar for next Cut **must** cite Keith-eye crops + measured delta — not static path/export checks alone.

**TOP Sleeping Dogs blocker now:** **far-frame fidelity** on Digit1 look corridor past ~200 m. Soft MSI PASS must not ship as SD.

---

## 2. Root cause (premise attack)

### 2.1 What #38 proved

- On-eye face-pack applied correctly (bins logged) but produced **zero** bocplate Keith-eye change and noise-level midfar/rightmid grain Δ.
- Static Soft bars without measured eye Δ are vetoed (`keithHardVeto`).

### 2.2 Failed premise A — soft far / apron PlanD omit (do NOT continue)

Waived through #28–#38. Do not lead. Far-frame fidelity ≠ “omit PlanD @300/180”.

### 2.3 Failed premise B — enamel densify / ashlar / orange remount (do NOT continue)

Holds. Never remount.

### 2.4 Failed premise C — mid-band BUILDING photo re-hunt (do NOT continue)

#36 closed. Permanently chartless.

### 2.5 Failed premise D — another face-pack / gutter-pack of on-eye mats (do NOT continue)

#37/#38 exhausted. Do not extend on-eye list without a real Keith-eye delta.

### 2.6 Active premise — far-frame / look-corridor LandsD fidelity (attack)

**Premise:** Digit1 midfar residual and SD-not-yet read are dominated by **far-frame** issues outside atlas packing — look-corridor curtain glass / holes onto loaded LandsD past ~200 m, ownership of far samples, triangle hits on already-loaded chase meshes beyond the midband stack (docs historically mention Lippo / courtyard / far curtain metres).

**Attack:** Cut #39 primary is **clear Keith-eye far-frame / midfar–far corridor fidelity** — measurable crop delta + Soft bar that **requires** measured eye metrics (not static exports alone). Prefer real LandsD Individualised ownership; no invented shiny materials; no Mapillary; no NYC.

**Hypothesis (non-binding — agent verifies):** residual may be cap-200 skip of far chase masses, 260 m box/ray test, curtain still covering loaded triangles past 200 m, wrong PlanD/glass layer in far NDC, or mip/LOD on far LandsD — investigate tip docs (`HK_GLTF_CUT.md` far-curtain notes), picks (`centre_midfar`, `henderson_face`, far second-hits), and MSI midfar crops; discard wrong guesses. Frame as **far-frame fidelity**, not soft PlanD omit.

### 2.7 Holds (do not remount)

Ashlar (#26), orange (#22), blank mid-band omit without replacement, Mapillary, NYC, soft PlanD lead, mid-band BUILDING photo re-hunt, enamel densify as lead, another on-eye face-pack without Keith-eye Δ, Soft bar that is static-path-only.

---

## 3. Approach (falsifiable)

**Goal at Digit1 eye:** midfar / far look-corridor reads with clearer LandsD ownership / less curtain-hole / far mush vs oneye38 / atlas37 BEFORE; Soft primary bar **binds to measured Keith-eye crop delta** (grain/MAD or equivalent) plus eye crops — not static source checks alone. Mid-band procedural residual may remain documented. Soft far/apron PlanD may remain. Holds #22–#38 code (no ashlar/orange regress). **Do not claim Sleeping Dogs.**

### 3.1 Primary — far-frame fidelity

1. **Inventory far Digit1 samples** from tip static / MSI picks past ~200 m (centre_midfar, henderson_face, far second-hits, curtain metres in docs).
2. **Diagnose / fix** look-corridor far ownership (curtain vs loaded LandsD triangles, cap/ray/box thresholds, far mesh mount) — smallest falsifiable advance with Keith-eye midfar/far crop delta.
3. **Soft gate bar** (agent owns name, e.g. `digit1FarFrameFidelity`): **must** include measured eye Δ / crop predicates; static-only PASS is FAIL for this Cut.
4. Keep `digit1MidbandPhotoFidelity` as open residual (false); overall `pass` must not require mid-band photo; hold #22–#37 bars; do not claim #38 Soft PASS retroactively.
5. Docs: residual moves off atlas packing / on-eye face-pack; note soft PlanD waived; **SD still not claimed**.

### 3.2 MSI Digit1 gate (primary = far-frame; Soft binds to eye Δ)

Eye: `?at=-1.4,29.3,1.29`  
Hold midfar / bocplate / rightmid / canyon / plandOff; A-B vs oneye38 and/or atlas37 BEFORE. Soft PlanD @~300/@180 waived — do not FAIL solely on those.

**PASS requires:** primary far-frame Soft bar true **with measured Keith-eye delta**; prior holds; midband photo may stay false; Soft PASS ≠ SD claim.

**FAIL if:** Soft bar green on static-only with near-zero eye Δ (repeat of #38); or ashlar/orange/BoC photo regress; or another face-pack-only change.

Sleeping Dogs NOT YET even on soft PASS.

---

## 4. Out of scope

- Soft PlanD @~300/@180 as lead
- Enamel densify / ashlar / orange remount
- Mid-band BUILDING photo re-hunt / fake charts
- Another face-pack / gutter-pack of `_002`/`_003`/`_001` (or extending on-eye list) without real Keith-eye delta
- Mapillary / NYC / invented shiny materials
- Sleeping Dogs claim
- Soft bar that is static path/export checks alone

---

## 5. Success

1. PR #39 from tip `af12a8b` with far-frame fidelity fix + Soft bar bound to measured eye Δ + tests + docs + plan.
2. MSI Digit1 Soft PASS only if Keith-eye delta lands; else honest FAIL. SD NOT YET.
3. Reviewer PASS/FAIL + Cut #40 premise.
4. Success = Keith eye cleaner far-frame / midfar corridor + Soft bar cites measured delta — **not a Sleeping Dogs claim**.
