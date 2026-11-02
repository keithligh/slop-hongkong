# Cut #43 — Digit1 Soft live far-frame grain (hold LandsD-first far NDC)

**Repo:** keithligh/slop-hongkong
**Base tip:** `cd4fed771f58dd6620ea59f320b2af4e8f5b95b5` (PR #42 far NDC yield — MSI Soft FAIL)
**Reviewer FAIL:** Soft `digit1FarFrameFidelity` live MSI A-B vs far39. No crop cleared MAD ≥ 2 and |grain Δ| ≥ 0.5. midfar MAD 4.049 / grain Δ −0.354; farframe MAD 2.645 / −0.125; henderson_far MAD 0.874 / −0.077.

## Verified root cause

The far NDC yield is doing what PR #42 measured. `centre_midfar` and `henderson_face` already first-hit sealed LandsD `B348641561601063A0` at ~379–382 m, with PlanD `tile_22_26` second. The live crops changed colour (MAD clears on midfar and farframe) and barely changed `hp_std_3x3`.

Lippo’s chart is the chase sampler: native 4096, full mip chain, anisotropy 16, `mipLevels` unset. On the Digit1 eye (FOV 56, 1280 wide) a ~43 m face at closest ~358 m wants about mip 5. That level has averaged the window grid down to the same local energy as the 2017 aerial it replaced, so grain Δ stays under 0.5. A two-level stop is the alias this chase already rejected, and it is not this cut. Fairmont House (~285 m) and The Henderson (~220 m) are inside 320 m, so they are not the over-filtered face. Soft paint, another on-eye atlas pack, and a wider PlanD omit were not the miss.

## What landed

1. `landsdFarGrainMaxLod` stops the mip chain one level above that hardware LOD, and never below four levels (0..3). Lippo’s 4096 chart caps at 3. A 1024 edge returns null and keeps the full chain. The GPU clamps to the last uploaded level, so a missing coarser mip is not sampled. `mipLevels` stays unset. Mount line: `[gltf] far-grain mip <file> maxLod N`.
2. Holds: LandsD-first far NDC (`plandOmitsDigit1FarNdc`, pad 1 m, past 320 m), the 11 far-frame seals, the Soft paint ban (`measureDigit1FarFrame` cannot pass), #41 ground tiles. `digit1FarFrameFidelity` from node stays false, reason `live-msi-required`.
3. A window-chart fixture scores the capped level against the next coarser levels with `keithEyeGrain` / `keithEyeMad` and clears both floors. That fixture is not a live crop and does not set Soft PASS.

## Soft contract

- PASS still requires a live MSI or rendered-eye crop on midfar, farframe, or henderson_far.
- This process does not claim that pass. The mip cap is what the next MSI pair has to rescore.
- Sleeping Dogs is not claimed.

## Next premise

Right-kerb / underfoot grain under the #41 tiles, after a live rescore of this cap. If midfar |grain Δ| is still short, the next guess is lit `MeshStandardMaterial` compressing the chart against the unlit aerial, not a wider far-NDC omit.
