# Cut #40 — Digit1 far NDC occlusion + Soft live MSI A-B (ban Soft paint)

**Repo:** keithligh/slop-hongkong
**Base tip:** `007d61ff815dc10fc1b42f9651f32ee8654c815b` (main after PR #41 GOOD ground Open3DHK tiles)
**Prior FAIL tip ea3ff3a / PR #39:** BLOCKING Soft paint. `digit1FarFrameFidelity` / `measureDigit1FarFrame` painted a 96×36 buffer from policy outcomes. Live tip-to-tip vs oneye38: midfar MAD 0.425, grain Δ −0.005; farframe MAD 0.045; henderson_far MAD 0.069; rightmid bit-identical.
**Do not regress** PR #41 `digit1GroundOwnership`, the manhole kill, or the Digit1 deck yield.

## Verified root cause

`plandOmitsDigit1FlankChart` requires the LandsD box near edge at or before along 216 m (short of The Henderson, near edge ~217 m). Lippo Centre `B348641561601063A0` is a street-chase box with closest ~358 m and min along ~358 m, so the yield never sees it.

Measured picks at `?at=-1.4,29.3,1.29`:

| Sample | First | Second |
| --- | --- | --- |
| `centre_midfar` | PlanD `tile_22_26` 378.55 m at (341.83, 54.78, 158.31) | LandsD `B348641561601063A0` 378.69 m |
| `henderson_face` | PlanD `tile_22_26` 381.96 m at (351.38, 59.4, 138.9) | LandsD `B348641561601063A0` 382.16 m |

Both points sit on the published Lippo box (x 341–384, z 135–178), below y 64. Fairmont House is closer (~285 m). `centre_low` (278.49, 15.44, 110.37) stays outside this yield. The Henderson interior stays outside it. Raising the 216 m flank cap would have been the waived @300 / @180 omit and was not the change.

## What landed

1. `plandOmitsDigit1FarNdc` drops a centroid below y 64 inside, or within 1 m of, a street-chase LandsD box whose closest point is past 320 m. Donor only. Mount line: `[pland] omitted N triangles on the Digit1 far NDC in front of a sealed LandsD facade`.
2. `digit1FarFrameFidelity` PASS only when `live: true`, `source` is `msi` or `rendered-eye`, and a `midfar`, `farframe`, or `henderson_far` crop clears MAD ≥ 2 and |grain Δ| ≥ 0.5 (`hp_std_3x3`). far39's published deltas fail those floors. `measureDigit1FarFrame` stays a policy fixture (`digit1FarFramePolicy`) and cannot set Soft PASS, including when its buffer is labelled live. A node run has no eye crop, so the gate reports Soft false, reason `live-msi-required`.
3. Holds: #22–#39 policy and seals, orange/ashlar veto, mid-band photo open residual, Soft PlanD @~300/@180 waived, ground tiles from #41. Sleeping Dogs is not claimed.

## Soft contract

- PASS requires a live crop, not a first-hit flag and not the policy buffer.
- FAIL on synthetic paint, a static path, or a near-flat pair like far39.
- `henderson_far` may clear the bar. `bocplate` and `rightmid` alone may not.
- This process does not claim a live MSI pass. The floors are what a later MSI pair has to clear.
