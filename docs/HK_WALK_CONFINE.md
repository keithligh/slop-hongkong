# Digit1 walk confinement

Person mode is fenced to a disc around the Digit1 eye.

| | |
| --- | --- |
| Centre | `HK_STREET_EYE` = (-1.4, 29.3) |
| Radius | `HK_WALK_RADIUS` = 50 m (body centre stays 0.5 m inside) |
| Modes | person only. Car, bike and helicopter are not clamped. |
| Bank of China Tower | scenery outside the fence. The radius does not grow to include it. |
| Overlay street gate | unchanged: `HK_STREET_NEAR` = 80 m (#50). |

Behaviour (`js/walk-confine.js`, wired in `js/controllers.js`):

- Walking: the step is projected back onto the circle, so the player slides along the fence.
- Teleport, `?at=` and saved state: `findTeleportPosition` clamps person targets into the disc.
- Digit1 / person mode switch: the idle pedestrian is returned inside the disc. The idle pedestrian turns back at the fence while another mode is driven.
- No invisible meshes.

Toggles (query string):

- default: fence on.
- `?confine=off` (also `0`, `false`, `no`): no fence, for MSI and dev.
- `?confine=on`: fence on and a thin red debug ring at the fence.
