# Cut #44 — Digit1 Soft live far grain (lit chart vs unlit aerial)

**Repo:** keithligh/slop-hongkong
**Base tip:** `4431a6f14cd41e3a8928a6ff3e021159eeae4f9e` (PR #43 Soft live far-frame grain — MSI Soft FAIL)
**Reviewer FAIL:** Soft `digit1FarFrameFidelity` live MSI A-B vs far39. No crop cleared MAD ≥ 2 and |grain Δ| ≥ 0.5. midfar MAD 4.336 / grain Δ −0.160 (regressed from #42 −0.354); farframe MAD 3.242 / +0.179; henderson_far MAD 1.540 / +0.259.

## Verified

The far NDC yield still first-hits sealed LandsD `B348641561601063A0` at ~379–382 m. The mip 3 cap moved midfar grain toward the aerial (−0.354 → −0.160) and did not clear the floor. Fixture ≠ live. That cap stays. It is not the lead.

The Lippo JPEG is already sunlit. The aerial is drawn with a black base and the JPEG as emissive, so the scene sun does not multiply it. The chase chart is a lit `MeshStandardMaterial`. Golden-hour sun intensity 5.8, Lambert ÷ π, then ACES, shoulders a window grid. On a chart whose displayed grain is about 12, that response is about 0.6 `hp_std_3x3` under the captured photograph, with MAD about 11. Lippo’s screen box is a strip inside the Soft crops, so a full-chart delta is not a crop delta. This cut does not treat the fixture as Soft PASS.

## What landed

1. `presentLandsdFarChartUnlit` on a street-chase box past 320 m: black base, emissive = the albedo map, metalness 0, roughness 1, specular and env intensity 0. No map, no stand-in colour. Fairmont House and The Henderson stay lit. Mount line: `[gltf] far-chart unlit <file>`. `mipLevels` stays unset. The mip 3 cap stays.
2. Holds: LandsD-first far NDC (`plandOmitsDigit1FarNdc`, pad 1 m, past 320 m), the 11 far-frame seals, the Soft paint ban, #41 ground tiles. `digit1FarFrameFidelity()` from node stays false, reason `live-msi-required`.
3. The window-chart fixture scores captured against lit with `keithEyeGrain` / `keithEyeMad` and clears both floors on that pair. It is not a live crop and it is not wired into the gate.

## Soft contract

- PASS still requires a live MSI or rendered-eye crop on midfar (prefer farframe too).
- This process does not claim that pass. Tip `4431a6f` is Soft FAIL. The unlit chart is what the next MSI pair has to rescore.
- Sleeping Dogs is not claimed.

## Next premise

Right-kerb / underfoot grain under the #41 tiles, after a live rescore. If midfar |grain Δ| is still short, the chart’s share of the crop was too small for this response to clear 0.5, and the next guess is not another mip cap and not a wider far-NDC omit.
