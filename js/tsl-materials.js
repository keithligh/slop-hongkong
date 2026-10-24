import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  attribute,
  varying,
  positionGeometry,
  positionLocal,
  positionWorld,
  positionView,
  positionViewDirection,
  normalLocal,
  normalWorld,
  normalWorldGeometry,
  normalGeometry,
  normalView,
  normalViewGeometry,
  modelNormalMatrix,
  frontFacing,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  screenSize,
  uv,
  time,
  sin,
  cos,
  abs,
  floor,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  length,
  normalize,
  reflect,
  pow,
  sign,
  fwidth,
  texture,
  rotateUV,
  mrt,
  If,
  sqrt,
  specularColor,
  specularColorBlended,
  specularF90
} from 'three/tsl';
import {
  CENTRAL_PARK_BOUNDS,
  PLAY_BOUNDS,
  ISLAND_BOUNDS,
  HK_RETAIL_BELT
} from './city-config.js';

// js/tsl-materials.js
// Photorealistic TSL (Three.js Shading Language) procedural shaders for Three.js r186 WebGPURenderer
// Incorporating techniques from three.js webgpu_generator_city.html:
// - Mikkelsen Surface-Gradient Hardware Derivative Bump Mapping (bumpNormal)
// - Filter-Width Anti-Aliased Procedural Markings & Mortar (lineAA & gridLine via fwidth)
// - True 3D Slab Ray-Marched Room & Retail Storefront Interiors (walls, ceiling lamps, floors, rugs, doors, art, shelves, curtains)
// - Window Air-Conditioner Units with Louver Relief & Grimy Soda-Lime Window Glazing
// - Crown-Sphere Foliage Normal Relief, Radial Interior Canopy AO & Cast-Iron Tree Grate Shading
// - Occlusion-Aware Urban Canyon Global Illumination (aoNode + Warm Terracotta/Limestone Bounce)

// Shared live uniforms controlled by lighting / time-of-day presets
const cityUniforms = {
  uSunColor: uniform(new THREE.Color(0xffca92)),
  uSkyTopColor: uniform(new THREE.Color(0x2c568c)),
  uSkyHorizonColor: uniform(new THREE.Color(0xebd1b5)),
  uSkySunDir: uniform(new THREE.Vector3(-0.66, 0.34, -0.67).normalize()),
  uInteriorGlow: uniform(0.78),
  uRoadWetness: uniform(0.38),
  uCanyonBounce: uniform(0.52)
};

// Fast deterministic 2D -> 1D hash in TSL
const hash2D = Fn(([p]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Smooth 2D value noise in TSL
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i);
  const b = hash2D(i.add(vec2(1.0, 0.0)));
  const c = hash2D(i.add(vec2(0.0, 1.0)));
  const d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Mikkelsen's Surface-Gradient Hardware Derivative Bump Mapping (ported from CityGeneratorUtils.js)
 * Wrapped in Fn() so `height` is evaluated once into a scalar parameter before dFdx/dFdy!
 */
const bumpNormal = Fn(([height]) => {
  const h = float(height).toVar();
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
  return det.abs().mul(normalView).sub(grad).normalize();
});

/**
 * Filter-Width Anti-Aliased Filled Band (ported from CityGenerator.js)
 * Wrapped in Fn() so NodeBuilder emits a single WGSL function instead of inlining fwidth trees.
 */
const lineAA = Fn(([coord, halfWidth]) => {
  const c = float(coord).toVar();
  const hw = float(halfWidth).toVar();
  const aa = fwidth(c).max(0.0001).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), abs(c));
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Filter-Width Anti-Aliased Repeating Grid Line (ported from CityGenerator.js & SidewalkGenerator.js)
 */
const gridLine = Fn(([coord, period, halfWidth]) => {
  const p = float(period).toVar();
  const g = float(coord).div(p).toVar();
  const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
  const aa = fwidth(g).max(0.0001).toVar();
  const hw = float(halfWidth).div(p).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Box-Filtered Periodic Pulse: fraction of a footprint `w` wide around `x` where fract() lies in [a, b].
 * Exact anti-aliasing that settles to the mean coverage (b - a) once a period shrinks below a pixel, so facade grids
 * don't shimmer or moiré at distance & grazing angles. Pass the in-cell coordinate (fract) for precision.
 */
const filteredPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

/**
 * Occlusion-Aware Urban Canyon Sky Visibility (aoNode)
 * Models how street canyons occlude overhead sky irradiance near the street floor (y = 0..65m),
 * while opening up in Central Park and on upper tower shafts.
 */
const canyonSkyAONode = Fn(() => {
  const wp = positionWorld;
  // A zero park box (Hong Kong has no Central Park rectangle) must not open the sky at the origin.
  const cp = CENTRAL_PARK_BOUNDS;
  const hasPark = (cp.maxX - cp.minX) > 1 && (cp.maxZ - cp.minZ) > 1;
  const inParkX = smoothstep(cp.minX - 10.0, cp.minX + 20.0, wp.x).mul(float(1.0).sub(smoothstep(cp.maxX - 20.0, cp.maxX + 10.0, wp.x)));
  const inParkZ = smoothstep(cp.minZ - 10.0, cp.minZ + 30.0, wp.z).mul(float(1.0).sub(smoothstep(cp.maxZ - 30.0, cp.maxZ + 10.0, wp.z)));
  const inPark = hasPark ? inParkX.mul(inParkZ) : float(0.0);

  const heightOpenness = smoothstep(0.0, 68.0, wp.y);
  const streetCrevice = smoothstep(0.0, 7.5, wp.y).mul(0.22).add(0.78);
  const canyonAO = mix(float(0.44), float(1.0), heightOpenness).mul(streetCrevice);
  return mix(canyonAO, float(1.0), inPark);
});

// Material caches to prevent duplicate WebGPU WGSL shader compilation across blocks & landmarks
const _curtainWallCache = new Map();
let _retailPodium = null;

// Camera-independent facade frame: the view/world normal round trip can change the dominant axis on 45-degree
// walls. Resolve near-ties in the vertex shader and keep that choice flat across each face.
const facadeNormalVertex = normalize(modelNormalMatrix.mul(normalLocal));
const facadeWorldNormal = varying(facadeNormalVertex, 'vFacadeWorldNormal').normalize();
const facadeAlongZ = varying(
  step(abs(facadeNormalVertex.z).sub(0.0001), abs(facadeNormalVertex.x)),
  'vFacadeAlongZ'
).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.EITHER);

/**
 * Lightweight, Fast-Compiling 3D Parallax Apartment Interior Mapping (Upper Floors Only)
 * Modelled directly after `interior()` in `three/addons/generators/city/SkyscraperGenerator.js`:
 * - Evaluates `origin`, `dir`, `boxMin`, and `boxMax` in true world meters (isotropic 1:1:1 scale)
 *   so 3D room perspective is accurate from all viewing angles.
 * - Each apartment room spans 2.5 window bays wide (~6.8m) × 1 story tall (~3.5m) × ~5.2m deep,
 *   set back behind the facade so neighbouring windows look into the same full-sized room.
 * - Includes left & right fabric drapes hung just inside the window frame (`winUV`) from a 6-swatch
 *   domestic palette that block interior glow (`emit = 0.20`) so drapes silhouette against lit rooms.
 * - Once windows shrink to a pixel or two (`fwNode`: pixel footprint in cells) rooms glow at the mean lit level (with
 *   a lit room's tint), drapes at their mean coverage & lamps fade out, so distant towers don't twinkle in motion.
 * - Returns `vec4(roomColor, litEmit)`.
 */
const evaluateApartmentInterior = Fn(([uCoord, vCoord, winUV, cellId, winWNode, floorHNode, seedNode, warmthNode, litProbNode, fwNode]) => {
  const u = float(uCoord).toVar();
  const v = float(vCoord).toVar();
  const wUV = vec2(winUV).toVar();
  const cid = vec2(cellId).toVar();
  const wW = float(winWNode).toVar();
  const fH = float(floorHNode).toVar();

  // Room module (SkyscraperGenerator.js lines 959-975):
  // Each room spans an INTEGER 2 or 3 window bays wide (~5.4m - 8.1m) and an INTEGER bay phase
  // offset per floor so partition walls ALWAYS land behind masonry piers/mullions, never mid-window!
  const floorIdx = floor(v.div(fH)).toVar();
  const fHash1 = fract(sin(floorIdx.mul(41.3).add(seedNode)).mul(43758.5453));
  const fHash2 = fract(sin(floorIdx.mul(73.7).add(seedNode.mul(1.7))).mul(43758.5453));
  const roomBays = mix(float(2.0), float(3.0), step(0.5, fHash1)).toVar();
  const roomPhase = floor(fHash2.mul(roomBays)).toVar();

  const gridU = u.div(wW);
  const roomU = gridU.add(roomPhase).div(roomBays).toVar();
  const roomIdx = floor(roomU).toVar();
  const roomId = vec2(roomIdx, floorIdx).toVar();

  const roomW = wW.mul(roomBays).toVar();
  const roomH = fH.mul(0.92).toVar();
  const setback = float(0.12);
  const depth = roomH.mul(1.55).toVar();

  // Pixel entry position `origin` in world meters relative to the multi-bay room center:
  // Window sill (wUV.y=0) sits ~0.75m above the room floor; window lintel (wUV.y=1) sits ~0.58m below the ceiling
  const originX = fract(roomU).sub(0.5).mul(roomW).toVar();
  const originY = wUV.y.sub(0.46).mul(roomH.mul(0.62)).toVar();

  // View ray `dir` in world meters in the room's (across, up, depth) frame. `across` runs along the wall's tangent
  // (+x on walls facing ±z, +z on walls facing ±x, turning with walls that follow a non-grid street)
  const rayWorld = normalize(positionWorld.sub(cameraPosition)).toVar();
  const tSign = mix(sign(facadeWorldNormal.z).negate(), sign(facadeWorldNormal.x), facadeAlongZ);
  const dirX = dot(rayWorld, vec3(facadeWorldNormal.z.negate(), 0.0, facadeWorldNormal.x).mul(tSign)).toVar();
  const dirY = rayWorld.y.toVar();
  const dirZ = max(abs(dot(rayWorld, facadeWorldNormal)), 0.05).toVar();

  // Slab intersection with the far planes of the room box:
  // [-halfW .. +halfW] x [-halfH .. +halfH] x [setback .. setback + depth]
  const halfW = roomW.mul(0.5).toVar();
  const halfH = roomH.mul(0.5).toVar();
  const tFarX = halfW.sub(originX.mul(sign(dirX))).div(max(abs(dirX), 0.0001)).toVar();
  const tFarY = halfH.sub(originY.mul(sign(dirY))).div(max(abs(dirY), 0.0001)).toVar();
  const tFarZ = setback.add(depth).div(dirZ).toVar();
  const t = min(min(tFarX, tFarY), tFarZ).toVar();
  const hit = vec3(originX.add(dirX.mul(t)), originY.add(dirY.mul(t)), dirZ.mul(t)).toVar();

  // Normalized 0..1 coordinates inside the room box (SkyscraperGenerator.js line 1150)
  const q = clamp(
    vec3(
      hit.x.div(roomW).add(0.5),
      hit.y.div(roomH).add(0.5),
      hit.z.sub(setback).div(depth)
    ),
    vec3(0.0),
    vec3(1.0)
  ).toVar();

  const onBack = step(tFarZ, tFarX).mul(step(tFarZ, tFarY)).toVar();
  const isYPlane = step(tFarY, tFarX).mul(step(tFarY, tFarZ)).toVar();
  const onCeil = isYPlane.mul(step(0.0, dirY)).toVar();
  const onFloor = isYPlane.mul(float(1.0).sub(step(0.0, dirY))).toVar();

  // Per-room hashes & bulb temperature (SkyscraperGenerator.js lines 1162-1171)
  const seed1 = hash2D(roomId.add(vec2(seedNode, 19.4))).toVar();
  const seed2 = hash2D(roomId.add(vec2(seedNode.mul(1.9), 83.1))).toVar();
  const seed3 = hash2D(roomId.add(vec2(63.2, seedNode.mul(0.7)))).toVar();
  const lod = smoothstep(0.3, 0.8, max(fwNode.x, fwNode.y)).toVar();
  const litRoom = step(float(1.0).sub(litProbNode), seed3).toVar();
  const lit = mix(litRoom, 1.0, lod).toVar();

  const warmLight = mix(color(0xffb845), color(0xffe49c), seed1);
  const coolLight = mix(color(0xdfe8ff), color(0x9fb6ff), seed2);
  const lightCol = mix(coolLight, warmLight, step(float(1.0).sub(warmthNode), seed2)).toVar();

  // Room shell: muted plaster walls with skirting board, wood floorboards + rug, ceiling lamp, back-wall door & art
  const wallBase = mix(mix(color(0x9a8b73), color(0x6f7a82), seed1), color(0xb9ad97), seed2.mul(0.6)).toVar();
  const wallCol = mix(wallBase, wallBase.mul(0.5), smoothstep(0.06, 0.04, q.y)).toVar();

  const seam = step(0.92, fract(q.x.mul(7.0)));
  const boards = mix(color(0x4a3320), color(0x6a4c30), seed1).mul(float(1.0).sub(seam.mul(0.3)));
  const rug = mix(color(0x7a3b32), color(0x3a5760), seed2);
  const inRug = step(abs(q.x.sub(0.5)), 0.28).mul(step(abs(q.z.sub(0.58)), 0.25));
  const floorCol = mix(boards, rug, inRug.mul(0.88)).toVar();

  const lamp = smoothstep(0.18, 0.11, length(vec2(q.x.sub(0.5), q.z.sub(0.5)))).mul(float(1.0).sub(lod));
  const ceilBase = mix(wallBase, color(0xe8e2d5), 0.28);
  const ceilCol = mix(ceilBase, lightCol.mul(mix(float(0.85), float(3.8), lit)), lamp).toVar();

  const doorX = mix(float(0.24), float(0.76), seed1);
  const doorCol = mix(color(0x5a4631), color(0x39383c), step(0.5, seed2));
  const inDoor = step(abs(q.x.sub(doorX)), 0.09).mul(step(abs(q.y.sub(0.34)), 0.34));
  const picX = mix(float(0.72), float(0.28), step(0.5, seed1));
  const inPicFrame = step(abs(q.x.sub(picX)), 0.085).mul(step(abs(q.y.sub(0.56)), 0.095));
  const inPicCanvas = step(abs(q.x.sub(picX)), 0.065).mul(step(abs(q.y.sub(0.56)), 0.075));
  const picCol = mix(color(0x2c3a4a), color(0x7a5a3a), fract(seed1.add(seed2)));
  const backWithDoor = mix(wallCol, doorCol, inDoor);
  const backWithFrame = mix(backWithDoor, color(0x141210), inPicFrame);
  const backCol = mix(backWithFrame, picCol, inPicCanvas).toVar();

  const shellCol = mix(mix(mix(wallCol, floorCol, onFloor), ceilCol, onCeil), backCol, onBack).toVar();

  // Soft 3D corner ambient occlusion & depth falloff (SkyscraperGenerator.js lines 1176 & 1213-1216)
  const aoX = smoothstep(0.0, 0.16, q.x).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.x))).toVar();
  const aoY = smoothstep(0.0, 0.16, q.y).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.y))).toVar();
  const aoZ = smoothstep(0.0, 0.16, q.z).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.z))).toVar();
  const edgeAO = mix(mix(aoY.mul(aoZ), aoX.mul(aoZ), isYPlane), aoX.mul(aoY), onBack);
  const shellAO = mix(float(0.66), float(1.0), edgeAO);
  const falloff = mix(float(1.0), float(0.42), q.z);
  const shadedRoom = shellCol.mul(shellAO).mul(falloff).toVar();

  // Curtains hung just inside the glass of each window opening (SkyscraperGenerator.js lines 1274-1302)
  // Parallax shift onto the curtain plane behind the glass
  const cUVx = clamp(wUV.x.add(dirX.div(dirZ).mul(0.06)), 0.0, 1.0).toVar();
  const wSeed1 = hash2D(cid.add(vec2(seedNode.mul(0.8), 41.2))).toVar();
  const wSeed2 = hash2D(cid.add(vec2(17.9, seedNode.mul(1.3)))).toVar();

  const sL = smoothstep(0.18, 1.0, wSeed1);
  const sR = smoothstep(0.18, 1.0, wSeed2);
  const lw = sL.mul(sL).mul(0.48); // Left drape width (0..48% of window width)
  const rw = sR.mul(sR).mul(0.48); // Right drape width (0..48% of window width)
  // Drape edges widen to the pixel footprint & pleats fade to their mean shade once they'd shrink below a few pixels
  const cFw = fwidth(cUVx).toVar();
  const drapeAA = cFw.add(0.015).toVar();
  const inLeftDrape = smoothstep(lw.add(drapeAA), lw.sub(drapeAA), cUVx).mul(step(0.03, lw));
  const inRightDrape = smoothstep(float(1.0).sub(rw).sub(drapeAA), float(1.0).sub(rw).add(drapeAA), cUVx).mul(step(0.03, rw));
  const inDrape = mix(clamp(max(inLeftDrape, inRightDrape), 0.0, 1.0), 0.29, lod).toVar(); // 0.29: mean drape coverage

  // Domestic curtain fabric palette (cream, taupe, warm grey, dusty blue, sage green, faded terracotta)
  const pick = fract(seed1.mul(5.7)).mul(5.0);
  const sw0 = mix(color(0xcabfa6), color(0xd8cdb8), seed2);
  const sw1 = mix(color(0x8a7a64), color(0x9b8c72), seed2);
  const sw2 = mix(color(0x5f7079), color(0x6f818b), seed2);
  const sw3 = mix(color(0x6c7558), color(0x79835f), seed2);
  const sw4 = mix(color(0x8c5a44), color(0x9a6a52), seed2);
  const fabric = mix(
    mix(mix(mix(sw0, sw1, step(1.0, pick)), sw2, step(2.0, pick)), sw3, step(3.0, pick)),
    sw4,
    step(4.0, pick)
  );
  const pleatWave = sin(cUVx.mul(48.0).add(wSeed1.mul(6.28))).mul(float(1.0).sub(smoothstep(0.6, 1.6, cFw.mul(48.0))));
  const pleat = pleatWave.mul(0.205).add(0.945);
  const drapeCol = fabric.mul(pleat).mul(0.92).toVar();

  // A drape only transmits a little of the room's glow (0.20), never out-glowing the interior!
  const bestCol = mix(shadedRoom, drapeCol, inDrape);
  const bestEmit = mix(float(1.0), float(0.20), inDrape);
  const roomWarmth = mix(vec3(1.0), lightCol, lit.mul(0.85));
  const finalRoomCol = bestCol.mul(roomWarmth).mul(mix(float(0.85), float(1.35), lit));

  return vec4(finalRoomCol, mix(litRoom, litProbNode, lod).mul(bestEmit));
});

/**
 * Treatment of each wall of a box-local facade box (the box-local facade mesh `faces`, read by facadeCell). shop: street front
 * with storefronts on the ground floor; entry: residential street front, windows down to the ground floor and one
 * entrance door; rear: yard, court & air-shaft walls, plain common brick with windows on every floor; lotLine:
 * windowless lot-line (party) wall, common brick or grey parging; blankStone: windowless wall in the facade's stone.
 */
const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };

/**
 * Facade cell coordinates shared by the curtain-wall & pre-war materials: wall UV (u runs along whichever horizontal
 * axis the wall faces, v is world height), window cell id/UV, bay width, pixel footprint in cells (`fw`, for
 * filtering) and roof/ground-floor masks.
 * World-space by default. With `boxLocal` the mesh must come from the box-local facade mesh: u then starts at each wall's
 * corner and every wall fits a whole number of bays, so no window straddles a corner. `cornerPier` (m, box-local only)
 * keeps a solid band of wall at both ends of every wall (masonry corners): the bays fill the width between the piers
 * and `solid` is 1 inside the piers above the ground floor, where callers suppress windows, sills & AC units.
 * Box-local walls also read their treatment from the per-instance `faces` attribute (see WALL_KINDS / the box-local facade mesh):
 * `isGroundFloor` is 1 only on storefront ground floors, `door` marks the entrance bay of residential fronts, `back`
 * the plain common-brick rear & lot-line walls (tinted by the building's `tone`) and `blank` the windowless ones
 * (folded into `solid`); `wallS`, `wallW`, `wallH`, `fromTop` & `boxSeed` place things on the wall (painted signs).
 * Plain JS (not Fn) so it inlines into each node graph exactly like hand-written code.
 */
function facadeCell(windowWidth, floorHeight, boxLocal, cornerPier = 0) {
  // Box-local walls are told apart by the box's own normals (the box-local facade mesh instances may be turned about +y to
  // follow a non-grid street); world-space walls by the world normal
  const nWall = boxLocal ? normalGeometry : facadeWorldNormal;
  const nW = abs(nWall);
  const isRoof = step(0.75, nW.y);
  const alongZ = boxLocal ? step(nW.z, nW.x) : facadeAlongZ;
  let uCoord = mix(positionWorld.x, positionWorld.z, alongZ);
  let bayWidth = float(windowWidth);
  let gridU = uCoord.div(bayWidth);
  let inPier = float(0.0);
  let kind = float(WALL_KINDS.shop);
  let tone = float(0.5);
  let bayIdx = float(0.0); // bay index along the wall (0 at its corner; -1 / bays inside the corner piers)
  let bays = float(1.0);
  // Box-local wall frame: metres along the wall (from its left end, seen facing it), its width & height, metres
  // below the box's top
  let wallS = float(0.0);
  let wallW = float(1.0);
  let wallH = float(1.0);
  let fromTop = float(0.0);
  let boxSeed = float(0.0);

  if (boxLocal) {
    const box = attribute('box', 'vec4'); // width, height, depth, seed (+ the building's tone in its fraction)
    const faces = attribute('faces', 'vec4'); // WALL_KINDS of the -x, +x, -z & +z walls
    const wallWidth = mix(box.x, box.z, alongZ);
    // The box-local normal's sign tells which wall this is
    kind = mix(
      mix(faces.z, faces.w, step(0.0, nWall.z)),
      mix(faces.x, faces.y, step(0.0, nWall.x)),
      alongZ
    );
    // The seed's fraction (0.1..0.9, never near an integer so floor() is stable on inexact varyings) is the tone
    tone = fract(box.w).sub(0.1).div(0.8);
    boxSeed = floor(box.w);
    // Whole-bay offset per wall so walls don't repeat each other's windows
    const wallSeed = floor(box.w.add(dot(nWall, vec3(17.0, 0.0, 37.0))));
    const along = mix(positionGeometry.x, positionGeometry.z, alongZ).add(0.5); // 0..1 from the wall's corner
    wallW = wallWidth;
    // Reading left to right for someone facing the wall
    const flip = mix(step(nWall.z, 0.0), step(0.0, nWall.x), alongZ);
    wallS = mix(along, float(1.0).sub(along), flip).mul(wallWidth);
    wallH = box.y;
    fromTop = float(0.5).sub(positionGeometry.y).mul(box.y);
    if (cornerPier > 0) {
      const pier = min(float(cornerPier), wallWidth.mul(0.2));
      const inner = wallWidth.sub(pier.mul(2.0));
      bays = max(floor(inner.div(windowWidth).add(0.5)), 1.0);
      const s = along.mul(wallWidth); // metres from the wall's corner
      bayWidth = inner.div(bays);
      bayIdx = floor(s.sub(pier).div(bayWidth));
      gridU = s.sub(pier).div(bayWidth).add(wallSeed);
      inPier = float(1.0).sub(step(pier, s).mul(step(s, wallWidth.sub(pier))));
    } else {
      bays = max(floor(wallWidth.div(windowWidth).add(0.5)), 1.0);
      bayWidth = wallWidth.div(bays);
      bayIdx = floor(along.mul(bays));
      gridU = along.mul(bays).add(wallSeed);
    }
    uCoord = gridU.mul(bayWidth);
  }

  const vCoord = positionWorld.y;
  const gridV = vCoord.div(floorHeight);
  const cellId = vec2(floor(gridU), floor(gridV));
  const cellUV = vec2(fract(gridU), fract(gridV));
  const fw = vec2(fwidth(gridU), fwidth(gridV));

  // Ground floor is strictly floor index 0 (gridV < 1.0) so floor 1 is never sliced in half!
  const floor0 = float(1.0).sub(step(1.0, gridV));
  const wall = float(1.0).sub(isRoof);
  const isGroundFloor = floor0.mul(float(1.0).sub(step(WALL_KINDS.shop + 0.5, kind)));
  const blank = step(WALL_KINDS.lotLine - 0.5, kind).mul(wall);
  const back = step(WALL_KINDS.rear - 0.5, kind).mul(float(1.0).sub(step(WALL_KINDS.blankStone - 0.5, kind))).mul(wall);
  // One entrance per residential front, in a bay picked by the building's tone
  const isEntry = step(WALL_KINDS.entry - 0.5, kind).mul(float(1.0).sub(step(WALL_KINDS.entry + 0.5, kind)));
  const door = floor0.mul(isEntry).mul(wall).mul(step(abs(bayIdx.sub(min(floor(tone.mul(bays)), bays.sub(1.0)))), 0.5));
  // A box that isn't a whole number of storeys (landmark tiers) ends in a solid parapet instead of slicing a row of
  // windows, and starts with one above the roof it stands on; every wall is capped by a coping at its top
  let partial = float(0.0);
  let coping = float(0.0);
  if (boxLocal) {
    const top = vCoord.add(fromTop);
    const floorBase = floor(gridV).mul(floorHeight);
    const whole = step(top.sub(wallH).sub(0.05), floorBase).mul(step(floorBase.add(floorHeight), top.add(0.05)));
    partial = float(1.0).sub(whole).mul(wall);
    coping = float(1.0).sub(step(0.32, fromTop)).mul(wall);
  }
  const solid = max(max(inPier.mul(float(1.0).sub(isGroundFloor)), blank), partial);
  return {
    isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, solid, floor0, back, blank, door, tone,
    wallS, wallW, wallH, fromTop, boxSeed, partial, coping
  };
}

/**
 * Curtain-Wall Glass Skyscraper TSL Material
 * Features:
 * - Mikkelsen `bumpNormal` 3D Mullion Relief & Per-Pane Thermal Glass Warble
 * - Fast 3D Apartment/Upper-Level Interior Mapping (2D Glazing on Ground-Floor Shops)
 * - Urban Canyon Global Illumination (`aoNode` + warm bounce)
 */
function createCurtainWallMaterial(opts = {}) {
  const {
    glassTint = 0x162c42,
    frameTint = 0x26323e,
    windowWidth = 2.8,
    floorHeight = 3.8,
    mullionThickness = 0.075,
    spandrelRatio = 0.20,
    litProbability = 0.36,
    warmth = 0.62,
    reflectivity = 0.92,
    reflectionFloor = 0.18,
    glassMetalness = 0.72,
    glassRoughness = 0.05,
    seed = 1.0,
    boxLocal = false
  } = opts;

  const cacheKey = `${glassTint}_${frameTint}_${windowWidth}_${floorHeight}_${litProbability}_${warmth}_${reflectivity}_${reflectionFloor}_${glassMetalness}_${glassRoughness}_${seed}_${boxLocal}`;
  if (_curtainWallCache.has(cacheKey)) {
    return _curtainWallCache.get(cacheKey);
  }

  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: glassMetalness,
    roughness: Math.max(glassRoughness, 0.12)
  });

  // The style's parameters are uniforms (not baked-in constants), so every curtain-wall style compiles to one shader
  const cGlass = uniform(new THREE.Color(glassTint));
  const cFrame = uniform(new THREE.Color(frameTint));
  const uWindowWidth = uniform(windowWidth);
  const uFloorHeight = uniform(floorHeight);
  const uLitProbability = uniform(litProbability);
  const uWarmth = uniform(warmth);
  const uReflectivity = uniform(reflectivity);
  const uReflectionFloor = uniform(reflectionFloor);
  const uGlassMetal = uniform(glassMetalness);
  const uGlassRough = uniform(glassRoughness);
  const uSeed = uniform(seed);
  const cWarmLight = color(0xffe1a6);
  const cCanyonBounce = color(0xe89c68);

  mat.aoNode = canyonSkyAONode();

  // The facade cell and the apartment behind each pane are built once and shared by every output below, so the
  // shader carries a single copy of them (and evaluates the interior mapping once per pixel)
  const facade = facadeCell(uWindowWidth, uFloorHeight, boxLocal);
  const { isRoof, uCoord, vCoord, gridV, cellId, cellUV, fw, bayWidth, isGroundFloor, blank, tone, partial, coping } = facade;
  // Pane UV inside the mullions & spandrel, the 3D apartment behind it and whether the ground-floor shop is lit
  const winUV = clamp(
    vec2(
      cellUV.x.sub(mullionThickness).div(max(0.01, 1.0 - 2.0 * mullionThickness)),
      cellUV.y.sub(spandrelRatio).div(max(0.01, 1.0 - spandrelRatio - mullionThickness))
    ),
    vec2(0.0),
    vec2(1.0)
  );
  const aptRoom = evaluateApartmentInterior(uCoord, vCoord, winUV, cellId, bayWidth, uFloorHeight, uSeed, uWarmth, uLitProbability.mul(0.65), fw);
  const shopLit = step(0.24, hash2D(cellId.add(vec2(uSeed, 19.4))));
  const floorIdx = floor(gridV);
  const isMechFloor = float(1.0).sub(step(1.0, mod(floorIdx.add(uSeed), 16.0))).mul(step(4.0, floorIdx));

  mat.colorNode = Fn(() => {
    // No glass in a storey the box cuts short (solid spandrel instead) nor behind the coping
    const isGlassPane = filteredPulse(cellUV.x, mullionThickness * 0.5, 1.0 - mullionThickness * 0.5, fw.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.015, 1.0 - mullionThickness * 0.5, fw.y))
      .mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));

    const louverStripes = sin(vCoord.mul(22.0)).mul(0.5).add(0.5);

    // Per-Pane Thermal/Wind Glass Warble & Pillow Distortion
    const paneRandX = hash2D(cellId.add(vec2(uSeed, 3.7))).sub(0.5);
    const paneRandY = hash2D(cellId.add(vec2(11.3, uSeed))).sub(0.5);
    const pillowBowX = cellUV.x.sub(0.5).mul(0.11).add(paneRandX.mul(0.09));
    const pillowBowY = cellUV.y.sub(0.55).mul(0.11).add(paneRandY.mul(0.09));

    const sunDir = normalize(cityUniforms.uSkySunDir);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nPane = normalize(normalWorldGeometry.add(vec3(pillowBowX, pillowBowY, pillowBowX.negate())));
    const reflectDir = reflect(viewDir.negate(), nPane);

    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, nPane))), 0.0, 1.0), 2.1);
    const reflectElev = clamp(reflectDir.y.mul(0.65).add(0.38), 0.0, 1.0);

    // Reflected neighbouring tower silhouette, its edge and window grid filtered by their screen footprint
    const refAzimuth = uCoord.mul(0.045).add(reflectDir.x.mul(3.8)).add(reflectDir.z.mul(3.8));
    const neighborTowerH = hash2D(vec2(floor(refAzimuth.mul(2.4)), uSeed)).mul(0.46).add(0.16);
    const elevAA = fwidth(reflectElev).add(0.004);
    const inReflectedTower = smoothstep(neighborTowerH.add(elevAA), neighborTowerH.sub(elevAA), reflectElev);
    const refCols = refAzimuth.mul(15.0);
    const refRows = reflectElev.mul(30.0);
    const refWinGrid = filteredPulse(fract(refCols), 0.32, 1.0, fwidth(refCols))
      .mul(filteredPulse(fract(refRows), 0.32, 1.0, fwidth(refRows)));
    const reflectedBuildingCol = mix(
      color(0x0c1420),
      color(0xffd494),
      refWinGrid.mul(0.42).mul(cityUniforms.uInteriorGlow)
    );

    const skyReflect = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(reflectElev.mul(1.4), 0.0, 1.0));
    const envReflection = mix(skyReflect, reflectedBuildingCol, inReflectedTower.mul(0.62));
    const sunSpec = pow(max(dot(reflectDir, sunDir), 0.0), 48.0).mul(1.25);

    // Upper levels use 3D apartment interior mapping; ground-floor shops use 2D glass
    const pooledDirt = float(1.0).sub(smoothstep(spandrelRatio, spandrelRatio + 0.22, cellUV.y)).mul(0.32);
    const grime = float(0.56).add(pooledDirt).clamp(0.0, 0.92);
    const shopShelves = float(1.0).sub(step(0.78, fract(winUV.y.mul(3.0))).mul(0.35));
    const shopTransomGlow = step(0.76, winUV.y).mul(0.35).add(0.65);
    const shopInterior = cWarmLight.mul(shopShelves).mul(shopTransomGlow).mul(mix(float(0.28), float(0.88), shopLit));
    const shopBase = mix(cGlass, shopInterior, float(0.56).mul(float(1.0).sub(pooledDirt)));
    const upperGlazed = mix(aptRoom.xyz.mul(color(0xb6c6bf)), cGlass, grime);
    const glazedBase = mix(upperGlazed, shopBase, isGroundFloor);

    const glassColor = mix(glazedBase, envReflection, fresnel.mul(uReflectivity).add(uReflectionFloor))
      .add(cityUniforms.uSunColor.mul(sunSpec));

    const spandrelDark = cFrame.mul(0.52);
    const frameBase = mix(cFrame, spandrelDark, filteredPulse(cellUV.y, 0.0, spandrelRatio, fw.y));

    const canyonBand = smoothstep(0.0, 14.0, vCoord).mul(float(1.0).sub(smoothstep(22.0, 75.0, vCoord)));
    const canyonGlow = cCanyonBounce.mul(canyonBand.mul(cityUniforms.uCanyonBounce).mul(0.16));

    const roofNoise = noise2D(positionWorld.xz.mul(0.35));
    const roofColor = mix(color(0x202429), color(0x3b4149), roofNoise);

    const facadeCol = mix(frameBase, glassColor, isGlassPane.mul(float(1.0).sub(isMechFloor))).add(canyonGlow);
    const mechCol = mix(cFrame.mul(0.36), cFrame.mul(0.76), louverStripes);
    const finalWall = mix(facadeCol, mechCol, isMechFloor.mul(float(1.0).sub(isRoof)));

    // Windowless lot-line walls: weathered precast concrete panels, a panel per bay & storey
    const panelJoint = max(filteredPulse(cellUV.x, 0.0, 0.025, fw.x), filteredPulse(cellUV.y, 0.0, 0.03, fw.y));
    const panelStain = noise2D(vec2(uCoord.mul(0.9), vCoord.mul(0.04))).mul(float(1.0).sub(smoothstep(0.4, 1.2, fwidth(uCoord))));
    const panelCol = mix(color(0x8a867e), color(0xaaa59b), tone).mul(panelStain.mul(0.16).add(0.9)).mul(float(1.0).sub(panelJoint.mul(0.3)));
    const withBlank = mix(finalWall, panelCol.add(canyonGlow), blank);
    // Brushed-aluminium coping capping every wall
    const withCap = mix(withBlank, mix(cFrame, color(0xc9ced3), 0.45), coping);
    const curtainCol = mix(withCap, roofColor, isRoof);
    // World-space towers cannot draw a mullion grid below the shopfront belt.
    // Box-local facade tests keep their own ground floor.
    if (boxLocal) return curtainCol;
    const onPodium = float(1.0).sub(step(float(HK_RETAIL_BELT), positionWorld.y));
    return mix(curtainCol, podiumStreetColor(), onPodium);
  })();

  mat.roughnessNode = Fn(() => {
    const isFrame = float(1.0).sub(
      filteredPulse(cellUV.x, mullionThickness, 1.0 - mullionThickness, fw.x).mul(filteredPulse(cellUV.y, spandrelRatio, 1.0, fw.y))
    );
    const sillDirt = float(1.0).sub(smoothstep(spandrelRatio, spandrelRatio + 0.18, cellUV.y)).mul(0.18);
    const glassOrFrame = mix(uGlassRough.add(sillDirt), float(0.54), max(max(isFrame, isRoof), partial));
    const glassRough = mix(mix(glassOrFrame, float(0.36), coping), float(0.88), blank);
    if (boxLocal) return glassRough;
    const onPodium = float(1.0).sub(step(float(HK_RETAIL_BELT), positionWorld.y));
    return mix(glassRough, float(0.9), onPodium);
  })();

  // Glass & metal above the belt. The shopfront is stone, not a metal curtain.
  mat.metalnessNode = Fn(() => {
    const glassMetal = mix(uGlassMetal, float(0.0), blank);
    if (boxLocal) return glassMetal;
    const onPodium = float(1.0).sub(step(float(HK_RETAIL_BELT), positionWorld.y));
    return mix(glassMetal, float(0.02), onPodium);
  })();

  // Hardware derivative bumpNormal for raised curtain-wall mullions & spandrel channels (ramps >= 2px, see pre-war)
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detailFade = float(1.0).sub(smoothstep(18.0, 140.0, camDist)).mul(float(1.0).sub(isRoof))
      .mul(float(1.0).sub(smoothstep(0.03, 0.1, max(fw.x, fw.y))));

    const ramp = fw.mul(2.0).max(0.02);
    const inPane = filteredPulse(cellUV.x, mullionThickness + 0.01, 0.99 - mullionThickness, ramp.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.01, 0.99 - mullionThickness, ramp.y))
      .mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));
    const mullionRelief = float(1.0).sub(inPane).mul(0.014).mul(float(1.0).sub(blank)).add(coping.mul(0.01));
    const relief = mullionRelief.mul(detailFade);
    if (boxLocal) return bumpNormal(relief);
    const onPodium = float(1.0).sub(step(float(HK_RETAIL_BELT), positionWorld.y));
    return bumpNormal(relief.mul(float(1.0).sub(onPodium)));
  })();

  mat.emissiveNode = Fn(() => {
    const inPane = filteredPulse(cellUV.x, mullionThickness + 0.015, 1.0 - mullionThickness - 0.015, fw.x)
      .mul(filteredPulse(cellUV.y, spandrelRatio + 0.02, 1.0 - mullionThickness * 0.5, fw.y));
    const paneMask = inPane.mul(float(1.0).sub(isRoof)).mul(float(1.0).sub(isMechFloor)).mul(float(1.0).sub(blank))
      .mul(float(1.0).sub(partial)).mul(float(1.0).sub(coping));

    const shopShelves = float(1.0).sub(step(0.78, fract(winUV.y.mul(3.0))).mul(0.32));
    const shopEmit = cWarmLight.mul(shopLit).mul(shopShelves).mul(0.62);
    const emitCol = mix(aptRoom.xyz.mul(aptRoom.w), shopEmit, isGroundFloor);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorldGeometry))), 0.0, 1.0), 2.0);
    const transmission = float(1.0).sub(fresnel.mul(0.75));

    const glassEmit = emitCol
      .mul(transmission)
      .mul(paneMask)
      .mul(cityUniforms.uInteriorGlow)
      .mul(0.72);
    if (boxLocal) return glassEmit;
    const onPodium = float(1.0).sub(step(float(HK_RETAIL_BELT), positionWorld.y));
    return mix(glassEmit, podiumShopGlow(), onPodium);
  })();

  _curtainWallCache.set(cacheKey, mat);
  return mat;
}

const _carPaintCache = new Map();


/**
 * GTA 6-Style Metallic Clearcoat Vehicle Paint TSL Material
 */
function createCarPaintMaterial(baseHex = 0xffc218) {
  if (_carPaintCache.has(baseHex)) return _carPaintCache.get(baseHex);
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.56,
    roughness: 0.11
  });

  const cBase = color(baseHex);

  mat.colorNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const sunDir = normalize(cityUniforms.uSkySunDir);
    const reflectDir = reflect(viewDir.negate(), normalWorld);
    const fresnel = pow(clamp(float(1.0).sub(abs(dot(viewDir, normalWorld))), 0.0, 1.0), 2.2);
    const envCol = mix(cityUniforms.uSkyHorizonColor, color(0xffffff), clamp(reflectDir.y.mul(0.55).add(0.5), 0.0, 1.0));
    const clearcoatSpec = pow(max(dot(reflectDir, sunDir), 0.0), 36.0).mul(0.55);
    return mix(cBase, envCol, fresnel.mul(0.48)).add(cityUniforms.uSunColor.mul(clearcoatSpec));
  })();

  _carPaintCache.set(baseHex, mat);
  return mat;
}

// Sunlight shining through leaves (Barré-Brisebois & Bouchard's fast translucency approximation): looking against
// the light, a leaf glows with the light it lets through. It takes the direct light's colour, so shadows (the crown's
// own included) dim it like the sunlit side. Materials set `translucencyNode` (vec3, 0 where nothing shines through).
class FoliageLightingModel extends THREE.PhysicalLightingModel {
  direct(lightData, builder) {
    const { lightDirection, lightColor, reflectedLight } = lightData;
    const translucency = builder.material.translucencyNode;
    if (translucency) {
      const scatter = normalize(lightDirection.add(normalView.mul(0.3)));
      const through = pow(clamp(dot(positionViewDirection, scatter.negate()), 0.0, 1.0), 3.0);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(translucency).mul(through));
    }
    super.direct(lightData, builder);
  }
}

class TreeNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'TreeNodeMaterial';
  }

  constructor(parameters) {
    super(parameters);
    this.translucencyNode = null;
  }

  setupLightingModel() {
    return new FoliageLightingModel();
  }
}

// Prevailing wind (xz, from the west-north-west)
const TREE_WIND = vec2(0.86, 0.51);

/**
 * Instanced street & park tree material (js/trees.js): bark tubes and alpha-tested leaf cards in ONE draw per mesh.
 * Geometry attributes:
 * - uv: leaf-atlas coordinates on the cards; on the bark (metres round the stem, metres along it)
 * - normal: on the cards, crown-shell normals (out from the crown centre, blended with the card face), so a crown
 *   shades as one leafy volume and both sides of a card light alike (the back faces keep them unflipped)
 * - aTree (vec4): x = 1 on leaf cards / 0 on bark, y = crown occlusion (0 deep inside .. 1 on the outer shell),
 *   z = sway weight (0 on the trunk .. 1 at the twig tips & cards), w = per-card random (leaf flutter phase)
 * - aTreeData (instanced vec4): rgb = per-tree linear foliage tint, w = species index + per-tree random fraction
 *   (species 0 London plane: flaking camouflage bark, 1 honey locust & 2 elm: dark furrowed bark)
 * Leaf atlas texels: r = leaf brightness, g = per-leaf hue jitter, b = twig / stalk mask, a = coverage (its mipmaps
 * keep the coverage, so distant crowns stay full).
 * Shading: per-tree tint with sun-yellowed & cooler leaves, deep leaves darker and occluded from the sky, sunlight
 * shining through the leaves toward the camera (FoliageLightingModel), alpha-to-coverage leaf edges on the MSAA scene
 * pass (alpha-tested in the shadow maps: dappled shadows). Wind: gusts rolling across the city sway the crowns
 * (shadows follow), branches bob and leaves flutter.
 */
function createTreeMaterial(leafAtlas) {
  // The alpha test is given as nodes (alphaTestNode on the scene pass, maskShadowNode in the shadow maps) rather than
  // `alphaTest`: the shadow passes copy each caster's `alphaTest` onto one shared shadow material, and every switch
  // between 0 and > 0 bumps its version, which made three.js re-hash the node graphs of all the casters' shadow render
  // objects every frame (~10 ms of CPU). The trees were the only alpha-tested casters.
  const mat = new TreeNodeMaterial({
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    metalness: 0.0,
    roughness: 0.8
  });

  const aTree = attribute('aTree', 'vec4');
  const aData = attribute('aTreeData', 'vec4');
  const isLeaf = aTree.x;
  const crownAO = aTree.y;
  const rnd = fract(aData.w);
  const species = floor(aData.w);
  const leaf = texture(leafAtlas, uv());

  // Wind. positionLocal is already instanced (world space); positionGeometry is the tree's own frame (metres)
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const g = positionGeometry;
    const phase = rnd.mul(6.2832);
    // gusts rolling downwind across the city
    const gust = sin(time.mul(0.5).sub(dot(p.xz, TREE_WIND).mul(0.045))).mul(0.5).add(0.5);
    const strength = gust.mul(gust).mul(0.7).add(0.3);
    // the whole tree bends with height, leaning downwind and rocking across it
    const h = g.y.div(11.0);
    const bend = h.mul(h);
    const lean = sin(time.mul(0.85).add(phase)).mul(0.45).add(0.55).mul(strength).mul(0.2);
    const rock = sin(time.mul(0.67).add(phase.mul(1.7))).mul(0.06).mul(strength);
    const sway = vec3(TREE_WIND.x.mul(lean).sub(TREE_WIND.y.mul(rock)), 0.0, TREE_WIND.y.mul(lean).add(TREE_WIND.x.mul(rock))).mul(bend);
    // branches bob, the phase flowing smoothly through the crown so joints stay together
    const bob = sin(time.mul(2.1).add(g.x.mul(0.9)).add(g.z.mul(0.7)).add(phase)).mul(0.05).mul(aTree.z).mul(strength);
    // leaves flutter, every card on its own
    const flutter = sin(time.mul(8.0).add(aTree.w.mul(37.0)).add(g.y.mul(2.0))).mul(0.03).mul(isLeaf).mul(aTree.z).mul(strength.add(0.25));
    return p.add(sway).add(vec3(0.0, bob, 0.0)).add(normalLocal.mul(flutter));
  })();

  // Coverage: leaf cards from the atlas; bark is opaque from outside (its back faces are dropped)
  const alpha = mix(float(frontFacing), leaf.a, isLeaf);
  mat.alphaTestNode = float(0.5);
  mat.maskShadowNode = alpha.greaterThan(0.5);

  mat.colorNode = Fn(() => {
    // Leaves: per-tree tint x atlas brightness, a share of sun-yellowed and of cooler leaves, brown twigs & stalks,
    // darker deep in the crown
    const tint = aData.xyz;
    const base = tint.mul(leaf.r.mul(1.4));
    const warm = smoothstep(0.62, 1.0, leaf.g).mul(0.55);
    const cool = smoothstep(0.38, 0.0, leaf.g).mul(0.45);
    const leafCol = mix(mix(base, base.mul(vec3(1.25, 1.08, 0.5)), warm), base.mul(vec3(0.8, 0.92, 1.05)), cool);
    const foliage = mix(leafCol, color(0x4a3b2c), leaf.b).mul(crownAO.mul(0.45).add(0.55));

    // Bark (uv in metres): furrowed grey-brown ridges, or the London plane's olive bark flaking to cream & tan
    const bu = uv();
    const n1 = noise2D(vec2(bu.x.mul(5.0), bu.y.mul(1.1)).add(rnd.mul(17.0)));
    const n2 = noise2D(bu.mul(vec2(3.2, 1.9)).add(rnd.mul(31.0)));
    const ridge = float(1.0).sub(abs(n1.sub(0.5).mul(2.0)));
    const furrowed = mix(color(0x2e261f), color(0x5c5043), smoothstep(0.35, 0.9, ridge));
    const planeBark = mix(mix(color(0x645e4b), color(0x948c73), smoothstep(0.56, 0.66, n2)), color(0x4a3f31), smoothstep(0.3, 0.22, n2));
    const bark = mix(furrowed, planeBark, step(species, 0.5)).mul(crownAO.mul(0.4).add(0.6));

    return vec4(mix(bark, foliage, isLeaf), alpha);
  })();

  mat.roughnessNode = mix(float(0.93), float(0.72).sub(leaf.r.mul(0.1)), isLeaf);

  // Card normals are crown-shell normals on both faces: no back-face flip
  mat.normalNode = normalViewGeometry;

  // Sky light: street-canyon occlusion, deep inside the crown far less
  mat.aoNode = canyonSkyAONode().mul(crownAO.mul(0.75).add(0.25));

  // Light through the leaves: yellow-green, strongest out on the thin shell
  mat.translucencyNode = aData.xyz.mul(vec3(1.0, 1.2, 0.45)).mul(leaf.r.mul(1.5)).mul(crownAO.mul(0.8).add(0.2)).mul(isLeaf);

  return mat;
}

// Pointy-top hexagon cell of p (in hex units): x = distance to the cell edge (0 at the joint .. 0.5 at the centre),
// yz = cell id
const hexCell = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const r = vec2(1.0, 1.7320508);
  const h = vec2(0.5, 0.8660254);
  const a = mod(pv, r).sub(h).toVar();
  const b = mod(pv.sub(h), r).sub(h).toVar();
  const gv = mix(b, a, step(dot(a, a), dot(b, b))).toVar();
  const q = abs(gv);
  const edge = float(0.5).sub(max(dot(q, vec2(0.5, 0.8660254)), q.x));
  return vec3(edge, pv.sub(gv));
});

// Joint mask (1 in the joints) of the park / plaza paving style at world xz
const pavingJoints = Fn(([style, wx, wz]) => {
  const hex = hexCell(vec2(wx, wz).div(0.21));
  const hexAA = fwidth(hex.x).max(0.0001);
  const hexJoint = smoothstep(hexAA.add(0.035), float(0.035).sub(hexAA), hex.x);
  const offG = mod(floor(wz.div(0.45)), 2.0).mul(0.45);
  const granJoint = max(gridLine(wx.add(offG), 0.9, 0.01), gridLine(wz, 0.45, 0.01));
  const blueJoint = max(gridLine(wx, 0.6, 0.012), gridLine(wz, 0.6, 0.012));
  const isGranite = step(0.5, style).mul(float(1.0).sub(step(1.5, style)));
  return mix(mix(hexJoint, granJoint, isGranite), blueJoint, step(1.5, style));
});

/**
 * NYC Parks Paths & Pedestrian Plaza Paving TSL Material: one shared material (one batched draw call) whose
 * paving style is picked per mesh through its uv.x:
 * - 0: NYC Parks hexagonal asphalt paver blocks (charcoal 8-inch hexes with sanded joints)
 * - 1: Light-grey granite plaza pavers in running bond with scattered dark pavers (Times Sq, Herald Sq, Flatiron)
 * - 2: Bluestone & granite square slabs (fountain & monument plazas)
 */
function createParkPavingMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.86
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const style = uv().x;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(170.0, 12.0, camDist);
    const grime = noise2D(vec2(wx.mul(0.35), wz.mul(0.35)));
    const grit = noise2D(vec2(wx.mul(13.0), wz.mul(13.0))).sub(0.5).mul(0.06).mul(detail);
    const joints = pavingJoints(style, wx, wz).mul(detail);

    // 0: charcoal hex asphalt pavers with per-block tone
    const hexTone = hash2D(hexCell(vec2(wx, wz).div(0.21)).yz);
    const hexCol = mix(color(0x41413e), color(0x5c5b57), hexTone);

    // 1: granite running bond, 15% darker pavers
    const rowG = floor(wz.div(0.45));
    const idG = vec2(floor(wx.add(mod(rowG, 2.0).mul(0.45)).div(0.9)), rowG);
    const granCol = mix(
      mix(color(0x9d9c95), color(0xbab9b1), hash2D(idG)),
      color(0x6a6964),
      step(0.85, hash2D(idG.add(vec2(17.3, 5.1))))
    );

    // 2: bluestone squares
    const blueCol = mix(color(0x62686d), color(0x878b8c), hash2D(floor(vec2(wx, wz).div(0.6))));

    const isGranite = step(0.5, style).mul(float(1.0).sub(step(1.5, style)));
    const base = mix(mix(hexCol, granCol, isGranite), blueCol, step(1.5, style));
    return base.mul(grime.mul(0.18).add(0.91)).add(grit).mul(float(1.0).sub(joints.mul(0.42)));
  })();

  mat.roughnessNode = Fn(() => {
    const style = uv().x;
    return mix(mix(float(0.9), float(0.72), step(0.5, style)), float(0.78), step(1.5, style));
  })();

  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(110.0, 10.0, camDist);
    const grain = noise2D(vec2(wx.mul(5.0), wz.mul(5.0))).sub(0.5).mul(0.0025);
    return bumpNormal(grain.sub(pavingJoints(uv().x, wx, wz).mul(0.006)).mul(detail));
  })();

  return mat;
}

/**
 * Central Park Perimeter Wall TSL Material: coursed grey schist & gneiss ashlar with recessed mortar joints on
 * the vertical faces and a smoother pale bluestone coping on top (axis-aligned walls, world-space courses).
 */
function createParkWallMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.9
  });

  mat.aoNode = canyonSkyAONode();

  const wallField = (wp, n) => {
    const u = wp.x.mul(abs(n.z)).add(wp.z.mul(abs(n.x)));
    const row = floor(wp.y.div(0.31));
    const off = hash2D(vec2(row, 3.7)).mul(1.3);
    const blockL = hash2D(vec2(row, 9.1)).mul(0.35).add(0.62);
    const id = hash2D(vec2(floor(u.add(off).div(blockL)), row));
    const mortar = max(gridLine(wp.y, 0.31, 0.016), gridLine(u.add(off), blockL, 0.018));
    return vec3(id, mortar, u);
  };

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const n = normalWorldGeometry;
    const f = wallField(wp, n);
    const camDist = length(wp.sub(cameraPosition));
    const detail = smoothstep(160.0, 12.0, camDist);
    const rough = noise2D(vec2(f.z, wp.y).mul(5.0));
    const stone = mix(color(0x55524d), color(0x8a8378), f.x).mul(rough.mul(0.24).add(0.86));
    const wall = mix(stone, color(0x3a3833), f.y.mul(detail).mul(0.75));
    const coping = mix(color(0x8f8e88), color(0x75746d), noise2D(wp.xz.mul(0.7)));
    return mix(wall, coping, smoothstep(0.6, 0.9, n.y));
  })();

  mat.normalNode = Fn(() => {
    const wp = positionWorld;
    const n = normalWorldGeometry;
    const f = wallField(wp, n);
    const camDist = length(wp.sub(cameraPosition));
    const detail = smoothstep(90.0, 8.0, camDist).mul(float(1.0).sub(smoothstep(0.6, 0.9, n.y)));
    const relief = noise2D(vec2(f.z, wp.y).mul(3.0)).mul(0.012).sub(f.y.mul(0.012));
    return bumpNormal(relief.mul(detail));
  })();

  return mat;
}

/**
 * Black Cast-Iron Park Fence TSL Material for flat fence strips (alpha-tested pickets, posts & rails).
 * uv.x = metres along the fence, uv.y = 0 (ground) .. 1 (top). Sub-pixel pickets fade out with distance.
 */
function createIronFenceMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.55,
    roughness: 0.5,
    side: THREE.DoubleSide
  });
  mat.alphaTest = 0.5;

  mat.colorNode = Fn(() => {
    const u = uv().x;
    const v = uv().y;
    const picket = lineAA(fract(u.div(0.13)).sub(0.5), 0.1).mul(step(v, 0.985));
    const post = lineAA(fract(u.div(2.6).add(0.5)).sub(0.5), 0.017);
    const rails = max(lineAA(v.sub(0.9), 0.028), lineAA(v.sub(0.12), 0.022));
    const alpha = clamp(max(max(picket, post), rails), 0.0, 1.0);
    return vec4(color(0x171a17), alpha);
  })();

  return mat;
}

/**
 * NYC Parks Lamppost Glass Globe: milky white by day, warm glow (bloom) at dusk & night.
 */
function createParkLampGlobeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0xece8dc,
    roughness: 0.35,
    metalness: 0.0
  });
  mat.emissiveNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    return color(0xffd6a0).mul(night.mul(2.6).add(0.05));
  })();
  return mat;
}

/**
 * Warm pool of lamplight on the paving under a park lamppost: additive, depth-tested flat decal (uv radial falloff),
 * fading in with the dusk/night interior-glow uniform and fully off by day.
 */
function createParkLampPoolMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.colorNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    const r = length(uv().sub(0.5)).mul(2.0);
    const falloff = pow(clamp(float(1.0).sub(r), 0.0, 1.0), 2.2);
    return color(0xffc890).mul(falloff.mul(night).mul(0.32));
  })();
  mat.opacityNode = float(1.0);
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the walks & lawns underneath
  return mat;
}

/**
 * Darkness inside a tunnel mouth: a black, depth-tested layer laid over the tunnel's road, walls and ceiling whose
 * opacity rises with uv.x (0 at the mouth -> 1 at the far end of the layer), standing in for the missing sky
 * occlusion so the bore fades from daylit concrete at the portal to black within a few metres.
 */
function createTunnelShadeMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false });
  mat.opacityNode = Fn(() => float(0.22).add(smoothstep(0.0, 1.0, uv().x).mul(0.76)))();
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the road underneath
  return mat;
}


/**
 * Weathered Tuckahoe Marble Ashlar TSL Material for park monuments (Washington Square Arch): coursed blocks with
 * fine joints on the vertical faces, faint veining & per-block tone, rain streaks and ground-splash grime.
 */
function createMarbleAshlarMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.6 });
  mat.aoNode = canyonSkyAONode();
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const n = normalWorldGeometry;
    const vertical = float(1.0).sub(abs(n.y));
    const u = wp.x.mul(abs(n.z)).add(wp.z.mul(abs(n.x)));
    const row = floor(wp.y.div(0.62));
    const off = hash2D(vec2(row, 5.3)).mul(1.4);
    const detail = smoothstep(240.0, 15.0, length(wp.sub(cameraPosition)));
    const joints = max(gridLine(wp.y, 0.62, 0.012), gridLine(u.add(off), 1.45, 0.012)).mul(vertical).mul(detail);
    const blockTone = hash2D(vec2(floor(u.add(off).div(1.45)), row));
    const vein = noise2D(vec2(u.mul(1.3).add(wp.y.mul(0.7)), wp.y.mul(2.1)));
    const base = mix(color(0xa9a293), color(0xc4bdae), blockTone.mul(0.55).add(vein.mul(0.45)));
    const streaks = smoothstep(0.55, 0.9, noise2D(vec2(u.mul(2.7), wp.y.mul(0.08)))).mul(0.14).mul(vertical);
    const grime = smoothstep(3.6, 0.2, wp.y).mul(0.24);
    return base.mul(float(1.0).sub(streaks).sub(grime)).mul(float(1.0).sub(joints.mul(0.4)));
  })();
  return mat;
}

/**
 * Concentric Cast-Iron Sidewalk Tree Pit Grate TSL Material (ported from StreetTreeGenerator.js)
 */
function createTreeGrateMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.45,
    roughness: 0.68
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const r = length(positionLocal.xz);
    const concentricSlots = smoothstep(0.35, 0.52, fract(r.mul(11.0)));
    const radialRibs = smoothstep(0.25, 0.45, abs(sin(positionLocal.x.mul(14.0)).mul(cos(positionLocal.z.mul(14.0)))));
    return mix(color(0x141312), color(0x3b3936), max(concentricSlots, radialRibs));
  })();

  return mat;
}

// Post-rain puddle field (organic standing rainwater pools) shared by every road surface channel
function roadPuddleField(wx, wz) {
  const nMacro = noise2D(vec2(wx.mul(0.095), wz.mul(0.075)));
  const nMid = noise2D(vec2(wx.mul(0.25).add(19.4), wz.mul(0.22).add(11.8)));
  const nDetail = noise2D(vec2(wx.mul(0.68).sub(7.3), wz.mul(0.68).add(29.1)));
  const spawnPool = smoothstep(4.2, 1.4, length(vec2(wx.sub(1.6), wz.sub(122.8)))).mul(0.10);
  return nMacro.mul(0.52).add(nMid.mul(0.34)).add(nDetail.mul(0.14)).add(spawnPool);
}

/**
 * Wetness masks over a puddle field, driven by cityUniforms.uRoadWetness (0 = bone dry … 1 = right after a downpour):
 * x = damp stains (darker, satin), y = standing water (mirror-smooth; none on a dry day), z = wet film over everything.
 * Water collects in the field's highest (lowest-lying) spots first, so pools appear, grow & merge as wetness rises;
 * `drainage` raises the water line for better-drained surfaces such as the crowned sidewalk flags.
 */
function roadWetMasks(field, drainage = 0.0) {
  const w = cityUniforms.uRoadWetness;
  const level = mix(float(0.86), float(0.56), clamp(w.sub(0.1).div(0.55), 0.0, 1.0)).add(drainage);
  const damp = smoothstep(level.sub(0.09), level.sub(0.015), field);
  const puddle = smoothstep(level, level.add(0.022), field).mul(smoothstep(0.1, 0.22, w));
  const film = smoothstep(0.2, 0.8, w);
  return vec3(damp, puddle, film);
}

/**
 * Roadway asphalt, footprint-filtered aggregate `bumpNormal`, scattered manholes
 * & Post-Rain Wetness (upgraded with techniques from CityGenerator.js `createRoadMaterial`).
 * cityUniforms.uRoadWetness drives damp stains, a glossy wet film & standing puddles (roadWetMasks): bone dry at
 * midday, a few small pools at golden hour, slick & mirroring the lights at night. Water's Fresnel rides on metalness
 * (as for the rivers), so puddles reflect the street through SSR at grazing angles yet only darken seen from above.
 * Lane markings are separate geometry built from the road network (js/road-paint.js).
 */
function createRoadSurfaceMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.24,
    roughness: 0.48
  });

  const cAsphaltDark = color(0x2b2e33);
  const cAsphaltLight = color(0x464a51);
  const cManhole = color(0x4a433c);

  // Puddle field & wetness masks shared by every channel below (each node is generated once per fragment)
  const puddleField = roadPuddleField(positionWorld.x, positionWorld.z);
  const wet = roadWetMasks(puddleField);
  const damp = wet.x;
  const puddle = wet.y;
  const film = wet.z;
  // World size of a pixel: fine texture settles to its mean before it can alias at grazing angles or from the air
  const pixelSize = length(fwidth(positionWorld.xz));
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const waterFresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(240.0, 22.0, camDist);

    // Two-scale aggregate grit, patchwork pours, oily wear stains & tar crack seams
    const microAggregate = mix(float(0.5), noise2D(vec2(wx.mul(16.0), wz.mul(16.0))), smoothstep(0.06, 0.02, pixelSize));
    const fineGrain = mix(float(0.5), noise2D(vec2(wx.mul(3.2), wz.mul(3.2))), smoothstep(0.4, 0.12, pixelSize));
    const patchNoise = noise2D(vec2(wx.mul(0.18), wz.mul(0.18)));
    const oilyStain = smoothstep(0.52, 0.84, noise2D(vec2(wx.mul(0.42), wz.mul(0.42)))).mul(detail);
    const tarSeam = float(1.0).sub(smoothstep(0.0, 0.04, abs(patchNoise.sub(0.52)))).mul(0.42).mul(detail);

    const baseAsphalt = mix(
      cAsphaltDark,
      cAsphaltLight,
      fineGrain.mul(0.36).add(microAggregate.mul(0.22)).add(patchNoise.mul(0.26))
    )
      .mul(float(1.0).sub(oilyStain.mul(0.32)))
      .mul(float(1.0).sub(tarSeam));

    // Circular cast-iron ConEd / NYC Sewer manhole covers scattered over the roadway (one 14 m cell in three)
    const mhCell = floor(vec2(wx, wz).div(14.0));
    const mhCentre = mhCell.add(vec2(hash2D(mhCell.add(13.7)), hash2D(mhCell.add(29.1))).mul(0.6).add(0.2)).mul(14.0);
    const mhDist = length(vec2(wx, wz).sub(mhCentre));
    const isManhole = float(1.0).sub(smoothstep(0.52, 0.60, mhDist)).mul(step(0.66, hash2D(mhCell))).mul(detail);
    const mhRings = sin(mhDist.mul(36.0)).mul(0.15).add(0.85);

    // Water filling the pores darkens the surface: damp stains & pools most, the overall wet film a little
    const wetDarkening = mix(mix(float(1.0), float(0.72), damp), float(0.6), puddle).mul(mix(float(1.0), float(0.8), film));
    return mix(baseAsphalt, cManhole.mul(mhRings), isManhole).mul(wetDarkening);
  })();

  mat.roughnessNode = Fn(() => {
    const microRough = mix(float(0.04), noise2D(positionWorld.xz.mul(12.0)).mul(0.08), smoothstep(0.08, 0.03, pixelSize));
    const wetRough = mix(float(0.90).add(microRough), float(0.38), max(film.mul(0.9), damp.mul(0.8)));
    return mix(wetRough, float(0.1), puddle);
  })();

  // Water's Fresnel (F0 = 0.02): weights SSR & trades diffuse for reflection in pools (fully) and the wet film (partly)
  mat.metalnessNode = clamp(waterFresnel.mul(1.6), 0.0, 0.85).mul(max(puddle, film.mul(0.6)));

  // Footprint-gated 3mm + 1.6mm asphalt aggregate relief via bumpNormal (from CityGenerator.js)
  // Flattens to mirror-smooth 0.0 inside standing rainwater puddles so SSR reflections stay crisp!
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const coarseFade = smoothstep(0.08, 0.025, pixelSize);
    const fineFade = smoothstep(0.02, 0.006, pixelSize).mul(float(1.0).sub(film.mul(0.6)));

    const coarseGrit = noise2D(vec2(wx.mul(8.5), wz.mul(8.5))).sub(0.5).mul(0.0032).mul(coarseFade);
    const fineGrit = noise2D(vec2(wx.mul(36.0), wz.mul(36.0))).sub(0.5).mul(0.0016).mul(fineFade);
    return bumpNormal(coarseGrit.add(fineGrit).mul(float(1.0).sub(puddle)));
  })();

  mat.emissiveNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;

    const roadFresnel = pow(clamp(float(1.0).sub(abs(viewDir.y)), 0.0, 1.0), 2.3);

    const skyMirror = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, 0.40).mul(0.10);

    const tsDist = clamp(float(1.0).sub(length(vec2(wx.add(212.0), wz.add(45.0))).div(145.0)), 0.0, 1.0);
    const neonPatch = noise2D(vec2(wx.mul(0.15), wz.mul(0.15)));
    const neonCol = mix(color(0xff2a85), color(0x2ad4ff), neonPatch).mul(0.32);
    const reflectCol = mix(skyMirror, neonCol, tsDist.mul(0.65));

    return reflectCol.mul(max(puddle, film.mul(0.35))).mul(roadFresnel).mul(cityUniforms.uInteriorGlow).mul(0.07);
  })();

  return mat;
}

/**
 * Road markings built from the road network (js/road-paint.js): vertex-coloured strips whose `paint` attribute
 * holds (metres along the strip, pattern period, duty cycle) and `side` the offset from the strip's centre line.
 * Strips thinner than ~1.5 px are widened on screen and faded to match (phone-wire AA) and dashes are box-filtered,
 * so distant markings fade out smoothly instead of breaking up and flickering. Worn, and dark & glossy in puddles.
 */
function createRoadPaintMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    metalness: 0.0
  });
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the asphalt (and its puddles) underneath

  const paint = attribute('paint', 'vec3');
  const side = attribute('side', 'vec2');
  const sideOffset = vec3(side.x, 0.0, side.y);

  // How much to widen the strip so it is at least 1.5 px wide on screen (1 when it already is)
  const widen = Fn(() => {
    const viewProjection = cameraProjectionMatrix.mul(cameraViewMatrix);
    const edge = viewProjection.mul(vec4(positionGeometry, 1.0));
    const centre = viewProjection.mul(vec4(positionGeometry.sub(sideOffset), 1.0));
    const halfWidthPx = length(edge.xy.div(edge.w).sub(centre.xy.div(centre.w)).mul(screenSize).mul(0.5));
    const inFront = step(0.05, min(edge.w, centre.w));
    return clamp(float(0.75).div(max(halfWidthPx, 0.001)), 1.0, 16.0).mul(inFront).max(1.0);
  })();
  mat.positionNode = positionGeometry.add(sideOffset.mul(widen.sub(1.0)));

  // Exact box filter of the dashes (on for `duty` of each period) over the pixel footprint
  const t = paint.x.div(paint.y);
  const footprint = max(fwidth(t), 0.0001);
  const duty = paint.z;
  const onSoFar = (x) => floor(x).mul(duty).add(clamp(fract(x).sub(float(1.0).sub(duty).mul(0.5)), 0.0, duty));
  const dashes = onSoFar(t.add(footprint.mul(0.5))).sub(onSoFar(t.sub(footprint.mul(0.5)))).div(footprint);

  const xz = positionWorld.xz;
  const detail = smoothstep(70.0, 15.0, length(positionWorld.sub(cameraPosition)));
  const wear = mix(float(0.5), noise2D(xz.mul(0.8)).mul(0.6).add(noise2D(xz.mul(2.3)).mul(0.4)), detail);
  mat.opacityNode = dashes.mul(varying(float(1.0).div(widen))).mul(smoothstep(0.1, 0.6, wear).mul(0.4).add(0.55));

  const wet = roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z)); // same pools & film as the asphalt
  mat.colorNode = vec3(mix(float(1.0), float(0.72), wet.y).mul(mix(float(1.0), float(0.86), wet.z)));
  mat.roughnessNode = mix(mix(float(0.62), float(0.42), wet.z), float(0.2), wet.y);
  mat.aoNode = canyonSkyAONode();

  return mat;
}

// Painted lane, stop, and keep-clear strips. Same wetness field as the asphalt so rain darkens them.
function createLaneStripeMaterial(hex) {
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.45,
    metalness: 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });
  const tint = color(hex);
  mat.colorNode = Fn(() => {
    const wet = roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z));
    return tint.mul(mix(float(1.0), float(0.9), max(wet.y, wet.z.mul(0.45))));
  })();
  mat.roughnessNode = Fn(() => {
    const wet = roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z));
    return mix(float(0.46), float(0.2), max(wet.z, wet.y));
  })();
  mat.metalnessNode = Fn(() => {
    const wet = roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z));
    return clamp(wet.y.mul(0.55).add(wet.z.mul(0.2)), 0.0, 0.65);
  })();
  return mat;
}

/**
 * NYC Concrete Sidewalk Flagstones with Filter-Width Anti-Aliased 1.5m Scored Expansion Joints,
 * -12mm `bumpNormal` Groove Relief, Per-Flag Tone Variation & Post-Rain Damp Patches
 * that follow cityUniforms.uRoadWetness like the roadway (better drained: fewer, smaller pools)
 * (Ported from SidewalkGenerator.js)
 */
function createSidewalkMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.88
  });

  const cConcreteA = color(0x8e8d85);
  const cConcreteB = color(0x73726b);

  // Damp patches & pools on the flags, shared by every channel below (own field; drains better than the roadway)
  const swField = noise2D(vec2(positionWorld.x.mul(0.14).add(7.4), positionWorld.z.mul(0.14).sub(13.1))).mul(0.65)
    .add(noise2D(vec2(positionWorld.x.mul(0.38), positionWorld.z.mul(0.38))).mul(0.35));
  const swWet = roadWetMasks(swField, 0.06);
  const swPuddle = swWet.y.mul(smoothstep(0.5, 0.9, normalWorldGeometry.y));
  const swFresnel = pow(float(1.0).sub(clamp(normalize(cameraPosition.sub(positionWorld)).y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  const pixelSize = length(fwidth(positionWorld.xz));

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(190.0, 16.0, camDist);

    const panel = 1.5; // 5 ft NYC concrete sidewalk flags
    const panelHash = hash2D(floor(vec2(wx.div(panel), wz.div(panel))));
    const tone = noise2D(vec2(wx.mul(0.48), wz.mul(0.48)));
    const grit = noise2D(vec2(wx.mul(14.0), wz.mul(14.0))).sub(0.5).mul(0.08).mul(detail).mul(smoothstep(0.07, 0.02, pixelSize));

    // Filter-width anti-aliased 1.5m scored joints
    const joints = max(gridLine(wx, panel, 0.042), gridLine(wz, panel, 0.042)).mul(detail);

    // Post-rain damp patches, pools & the overall wet film darken the flags
    const baseConcrete = mix(cConcreteB, cConcreteA, tone)
      .mul(panelHash.sub(0.5).mul(0.16).add(1.0))
      .add(grit)
      .mul(mix(float(1.0), float(0.72), max(swWet.x, swPuddle)))
      .mul(mix(float(1.0), float(0.8), swWet.z));

    return baseConcrete.mul(float(1.0).sub(joints.mul(0.45)));
  })();

  mat.roughnessNode = Fn(() => {
    const panelHash = hash2D(floor(vec2(positionWorld.x.div(1.5), positionWorld.z.div(1.5))));
    const wetRough = mix(float(0.90).sub(panelHash.mul(0.06)), float(0.55), max(swWet.z, swWet.x.mul(0.7)));
    return mix(wetRough, float(0.2), swPuddle);
  })();

  // Water's Fresnel (F0 = 0.02) on pools & the wet film, as for the roadway
  mat.metalnessNode = clamp(swFresnel.mul(1.6), 0.0, 0.85).mul(max(swPuddle, swWet.z.mul(0.3)));

  // Physical -12mm scored expansion joints + +3mm concrete aggregate grain via bumpNormal
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(140.0, 14.0, camDist);

    const joints = max(gridLine(wx, 1.5, 0.042), gridLine(wz, 1.5, 0.042));
    const grain = noise2D(vec2(wx.mul(4.5), wz.mul(4.5))).sub(0.5).mul(0.003);
    const height = grain.sub(joints.mul(0.012)).mul(detail).mul(float(1.0).sub(swPuddle));
    return bumpNormal(height);
  })();

  return mat;
}

/**
 * NYC Dressed Granite Curbstone TSL Material (ported from SidewalkGenerator.js `createCurbMaterial`)
 * Dense cool grey flamed granite with 1.5m segment joints, grimier road-facing vertical face,
 * and `bumpNormal` granite grain.
 */
function createCurbMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.06,
    roughness: 0.72
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(180.0, 16.0, camDist);

    const tone = noise2D(vec2(wx.mul(0.6), wz.mul(0.6)));
    const speckle = noise2D(vec2(wx.mul(18.0), wz.mul(18.0))).sub(0.5).mul(0.06).mul(detail);
    const stone = mix(color(0x4c4c45), color(0x63635a), tone).add(speckle);

    const joints = max(gridLine(wx, 1.5, 0.038), gridLine(wz, 1.5, 0.038)).mul(detail);
    const topFace = smoothstep(0.5, 0.85, normalWorldGeometry.y);
    const wetFilm = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness); // rain-darkened granite, like the roadway's film
    return mix(stone.mul(0.68), stone, topFace).mul(float(1.0).sub(joints.mul(0.42))).mul(mix(float(1.0), float(0.78), wetFilm));
  })();

  mat.roughnessNode = mix(float(0.72), float(0.5), smoothstep(0.2, 0.8, cityUniforms.uRoadWetness));

  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(120.0, 12.0, camDist);
    const grain = noise2D(vec2(wx.mul(5.5), wz.mul(5.5))).sub(0.5).mul(0.0022);
    return bumpNormal(grain.mul(detail));
  })();

  return mat;
}


/**
 * Tileable wind-wave texture shared by every water surface, synthesised once on the CPU: a random-phase directional
 * wind-sea spectrum (k^-4 saturation range above a spectral peak, cos² spreading) inverse-FFT'd to height & slopes.
 * RGBA half-float: R,G = slope (dh/du, dh/dv in tile units, unit RMS), B = squared slope, A = height (unit RMS).
 * The box-filtered mip chain is averaged in float, so trilinear / anisotropic sampling returns the mean slope AND the
 * mean squared slope over each pixel footprint: their difference is the slope variance of waves too small to resolve,
 * which createWaterMaterial turns into GGX roughness (LEAN mapping) instead of letting them shimmer.
 */
let _waterWaveTexture = null;

// In-place 2D inverse FFT (unnormalised, n = power of two) on separate real / imaginary arrays
function fft2DInverse(re, im, n) {
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const fft1D = () => {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = ar[i]; ar[i] = ar[j]; ar[j] = t;
        t = ai[i]; ai[i] = ai[j]; ai[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const wr = Math.cos((2 * Math.PI) / len);
      const wi = Math.sin((2 * Math.PI) / len);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k;
          const b = a + half;
          const tr = ar[b] * cr - ai[b] * ci;
          const ti = ar[b] * ci + ai[b] * cr;
          ar[b] = ar[a] - tr; ai[b] = ai[a] - ti;
          ar[a] += tr; ai[a] += ti;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  };
  for (let pass = 0; pass < 2; pass++) { // rows, then columns
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) { const idx = pass === 0 ? r * n + c : c * n + r; ar[c] = re[idx]; ai[c] = im[idx]; }
      fft1D();
      for (let c = 0; c < n; c++) { const idx = pass === 0 ? r * n + c : c * n + r; re[idx] = ar[c]; im[idx] = ai[c]; }
    }
  }
}

function getWaterWaveTexture() {
  if (_waterWaveTexture) return _waterWaveTexture;
  const N = 256;
  const size = N * N;
  let seed = 0x2f6b9d1;
  const rand = () => { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gRe = new Float64Array(size);
  const gIm = new Float64Array(size);
  for (let i = 0; i < size; i++) { // complex Gaussian white noise (Box-Muller)
    const r = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9)));
    const a = 2 * Math.PI * rand();
    gRe[i] = r * Math.cos(a);
    gIm[i] = r * Math.sin(a);
  }

  const sRe = new Float64Array(size); // slope field packed as dh/du + i dh/dv
  const sIm = new Float64Array(size);
  const hRe = new Float64Array(size); // height field
  const hIm = new Float64Array(size);
  const kPeak = 5.0; // spectral peak (cycles per tile)
  const kCut = 56.0; // soft high cut, well inside Nyquist so slopes stay resolved at mip 0
  const windU = Math.cos(0.3);
  const windV = Math.sin(0.3);
  for (let y = 0; y < N; y++) {
    const ky = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const k = Math.hypot(kx, ky);
      if (k < 1 || k > N / 2 - 2) continue;
      const c = (kx * windU + ky * windV) / k;
      const spread = 0.22 + c * c; // mostly along the wind axis, with some cross-sea
      const amp = Math.sqrt(spread * Math.exp(-1.25 * (kPeak / k) ** 2 - (k / kCut) ** 2)) / (k * k);
      const i = y * N + x;
      const m = ((N - y) % N) * N + ((N - x) % N); // index of -k: H(-k) = conj(H(k)) keeps both fields real
      const aRe = (gRe[i] + gRe[m]) * amp;
      const aIm = (gIm[i] - gIm[m]) * amp;
      hRe[i] = aRe;
      hIm[i] = aIm;
      sRe[i] = -kx * aIm - ky * aRe; // FFT⁻¹(i·kx·H − ky·H) = dh/du + i·dh/dv (up to 2π, normalised below)
      sIm[i] = kx * aRe - ky * aIm;
    }
  }
  fft2DInverse(sRe, sIm, N);
  fft2DInverse(hRe, hIm, N);

  let s2 = 0;
  let h2 = 0;
  for (let i = 0; i < size; i++) {
    s2 += sRe[i] * sRe[i] + sIm[i] * sIm[i];
    h2 += hRe[i] * hRe[i];
  }
  const sNorm = 1 / Math.sqrt(s2 / size);
  const hNorm = 1 / Math.sqrt(h2 / size);

  let w = N;
  let level = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const sx = sRe[i] * sNorm;
    const sy = sIm[i] * sNorm;
    level[i * 4] = sx;
    level[i * 4 + 1] = sy;
    level[i * 4 + 2] = sx * sx + sy * sy;
    level[i * 4 + 3] = hRe[i] * hNorm;
  }
  const toHalf = THREE.DataUtils.toHalfFloat;
  const mipmaps = [];
  for (;;) {
    const data = new Uint16Array(level.length);
    for (let i = 0; i < level.length; i++) data[i] = toHalf(level[i]);
    mipmaps.push({ data, width: w, height: w });
    if (w === 1) break;
    const h = w >> 1;
    const next = new Float32Array(h * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        for (let c = 0; c < 4; c++) {
          const a = (2 * y * w + 2 * x) * 4 + c;
          next[(y * h + x) * 4 + c] = 0.25 * (level[a] + level[a + 4] + level[a + w * 4] + level[a + w * 4 + 4]);
        }
      }
    }
    level = next;
    w = h;
  }

  const tex = new THREE.DataTexture(mipmaps[0].data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mipmaps = mipmaps;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _waterWaveTexture = tex;
  return tex;
}

// Share of the window [x - s, x + s] covered by the interval [a, b]: an exact box filter for bands & points of light
const waterBoxCover = Fn(([x, a, b, s]) => {
  const xv = float(x).toVar();
  const sv = max(float(s), 0.001).toVar();
  return clamp(min(xv.add(sv), b).sub(max(xv.sub(sv), a)).div(sv.mul(2.0)), 0.0, 1.0);
});

/**
 * Victoria Harbour water: physically based estuary material
 * - Wave normals (normalNode) from 4 rotated, scaled & drifting samples of the LEAN wave texture whose energy follows
 *   slowly drifting wind patches; the slope variance below each pixel footprint (plus always-unresolved capillary
 *   ripples) becomes GGX roughness, so crisp chop near the piers turns into a soft glitter path towards the horizon
 *   and from the air, without shimmer or visible tiling.
 * - Murky, sediment-laden green-grey body colour lit as a diffuse volume. Metalness carries the water's Fresnel
 *   (F0 = 0.02): it hands the transmitted share to the body colour and weights the pipeline's SSR, so reflections come
 *   only from the sky IBL, the sun's GGX specular and SSR (no painted-in glint).
 * - Night: the lit skyline & far shores sit beyond SSR's reach, so an analytic city (lots, lit windows, storefronts &
 *   riverside lamps along the Island and Kowloon shores) is reflected
 *   through the same wave normals & Fresnel, blurred by the unresolved slopes into the familiar vertical light streaks.
 * - Park lakes, the Reservoir & fountains (well above the harbour) get finer, calmer ripples and a greener, duller body.
 */
function createWaterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.25
  });

  const waveTex = getWaterWaveTexture();
  const waterBounds = PLAY_BOUNDS || ISLAND_BOUNDS;
  const harbourY = waterBounds ? waterBounds.waterLevel : -2.2;
  const pond = smoothstep(harbourY + 1.0, harbourY + 2.0, positionWorld.y);

  // [tile size (m), rotation (rad), RMS slope]: incommensurate scales & angles so no pattern repeats
  const LAYERS = [
    [61.0, 0.0, 0.052],
    [23.3, 1.93, 0.06],
    [8.7, 4.07, 0.064],
    [3.3, 2.71, 0.064]
  ];

  // vec4(mean slope x, mean slope z, unresolved slope variance, crest height)
  const waves = Fn(() => {
    const p = positionWorld.xz;
    const t = time;
    const q = p.mul(mix(float(1.0), float(2.6), pond)); // sheltered ponds: finer ripples

    // Wind patches drifting with the breeze: large-scale wave energy that reads from the air and hides tiling
    const gustA = noise2D(p.mul(0.0047).add(vec2(t.mul(0.011), t.mul(-0.007))));
    const gustB = noise2D(p.mul(0.0135).add(vec2(t.mul(-0.009), t.mul(0.013))).add(31.7));
    const gust = smoothstep(0.18, 0.82, gustA.mul(0.62).add(gustB.mul(0.38)));
    const energy = mix(float(0.45), float(1.3), gust).mul(mix(float(1.0), float(0.42), pond)).toVar();

    const slope = vec2(0.0, 0.0).toVar();
    const variance = energy.mul(energy).mul(0.0022).toVar(); // capillary ripples, always below a pixel
    const crest = float(0.0).toVar();
    for (const [L, rot, sigma] of LAYERS) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const speed = (0.8 * Math.sqrt(L / 9)) / L; // ~phase speed of the tile's dominant waves, in tiles per second
      const uv = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c))).div(L)
        .add(vec2(Math.cos(0.3) * speed, Math.sin(0.3) * speed).mul(t));
      const smp = texture(waveTex, uv);
      const amp = energy.mul(sigma);
      slope.addAssign(vec2(smp.x.mul(c).add(smp.y.mul(s)), smp.y.mul(c).sub(smp.x.mul(s))).mul(amp));
      variance.addAssign(max(smp.z.sub(dot(smp.xy, smp.xy)), 0.0).mul(amp.mul(amp)));
      crest.addAssign(smp.w.mul(sigma));
    }
    return vec4(slope, variance, crest.mul(4.0));
  })();

  const slope = waves.xy;
  const variance = waves.z;
  // Fountain rims & other non-horizontal faces keep their own normal
  const flatTop = smoothstep(0.5, 0.9, normalWorldGeometry.y);
  const waterNormal = normalize(mix(normalWorldGeometry, vec3(slope.x.negate(), 1.0, slope.y.negate()), flatTop));
  mat.normalNode = cameraViewMatrix.transformDirection(waterNormal);

  // GGX alpha ≈ RMS slope of the unresolved waves (Beckmann m), roughness = sqrt(alpha); murkier ponds a touch duller
  mat.roughnessNode = clamp(pow(variance, 0.25).add(pond.mul(0.05)), 0.08, 0.65);

  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1.0).sub(clamp(dot(waterNormal, viewDir), 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.9);

  // Sediment-laden estuary: deep blue-green grey ↔ silty olive grey; thin sunlit crests transmit a greener tint
  mat.colorNode = Fn(() => {
    const silt = noise2D(positionWorld.xz.mul(0.0031).add(7.3));
    const body = mix(color(0x162d2c), color(0x2e3f36), smoothstep(0.25, 0.85, silt));
    const lake = mix(color(0x24321f), color(0x33402a), silt);
    const crestTint = smoothstep(0.6, 2.4, waves.w).mul(0.35).add(1.0);
    return mix(body, lake, pond).mul(crestTint);
  })();

  // Physical water only. Island + Kowloon + Victoria Harbour is the water plane (PLAY_BOUNDS).
  mat.emissiveNode = color(0x000000);

  return mat;
}

/**
 * Park turf: multi-octave grass, clover, and mowing stripes
 */
function createParkLawnMaterial(isMeadow = false) {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.86
  });

  const cGrassDeep = color(isMeadow ? 0x2c5c28 : 0x224c20);
  const cGrassMid = color(isMeadow ? 0x457d36 : 0x36682c);
  const cGrassSun = color(0x6b9c3e);

  mat.colorNode = Fn(() => {
    const wp = positionWorld.xz;
    const macroPatch = noise2D(wp.mul(0.06));
    const midClover = noise2D(wp.mul(0.35));
    const microBlade = noise2D(wp.mul(3.8));
    const mowStripe = sin(wp.x.mul(0.55).add(wp.y.mul(0.25))).mul(0.5).add(0.5);

    const baseLawn = mix(
      cGrassDeep,
      cGrassMid,
      macroPatch.mul(0.45).add(midClover.mul(0.35)).add(mowStripe.mul(0.20))
    );
    return mix(baseLawn, cGrassSun, microBlade.mul(0.38));
  })();

  mat.normalNode = Fn(() => {
    const wp = positionWorld.xz;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(85.0, 10.0, camDist);
    const turf = noise2D(wp.mul(7.5)).sub(0.5).mul(0.008);
    return bumpNormal(turf.mul(detail));
  })();

  // Grass is a canopy of blades that shadow each other, not a flat dielectric: at grazing angles a plain F0 = 0.04 /
  // F90 = 1 Fresnel mirrors the sky and turns lawns teal, so weaken the specular and cap its grazing rise
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };

  return mat;
}

/**
 * Synthesizes a 256x256 procedural domain-warped multi-octave turbulent smoke/steam cloud texture
 * for camera-facing SpriteNodeMaterial particles (following webgpu_particles.html):
 * - R: local 3D cloud billow illumination (top-left warm sun catch)
 * - G: vertical hemisphere self-shadowing gradient (1 at top rim, 0 at shadowed belly)
 * - B: inner core vapor density
 * - A: soft, wispy, multi-lobe cloud silhouette that feathers to 0.0 well inside the quad edges
 */
let _smokeCloudTexture = null;
function getSmokeCloudTexture() {
  if (_smokeCloudTexture) return _smokeCloudTexture;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;

  // Adjacent texels and fBm samples reuse the same lattice points. Keep full-precision hashes for this bake only.
  const hashRows = [];
  const hash = (ix, iy) => {
    const row = hashRows[iy] || (hashRows[iy] = []);
    if (row[ix] !== undefined) return row[ix];
    const s = Math.sin(ix * 127.1 + iy * 311.7 + 19.19) * 43758.5453;
    return row[ix] = s - Math.floor(s);
  };
  const vnoise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y) => {
    let v = 0.0;
    let amp = 0.52;
    let freq = 1.0;
    for (let o = 0; o < 5; o++) {
      v += vnoise(x * freq, y * freq) * amp;
      freq *= 2.05;
      amp *= 0.5;
    }
    return v;
  };

  for (let py = 0; py < size; py++) {
    const ny = (py / (size - 1)) * 2.0 - 1.0; // -1 (top) to +1 (bottom)
    for (let px = 0; px < size; px++) {
      const nx = (px / (size - 1)) * 2.0 - 1.0;
      const r = Math.hypot(nx, ny);
      const idx = (py * size + px) * 4;

      if (r >= 0.98) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      // Domain-warped coordinates for swirling turbulent vapor tendrils
      const u = nx * 2.3 + 4.1;
      const v = ny * 2.3 + 7.3;
      const wx = fbm(u, v) - 0.5;
      const wy = fbm(u + 5.2, v + 1.3) - 0.5;
      const cloud = fbm(u + wx * 2.2, v + wy * 2.2);
      const fineWisp = fbm((u + wx) * 2.4 + 11.7, (v + wy) * 2.4 + 3.9);

      // Multi-lobe billowy outer boundary so the puff silhouette is organic, never circular or boxy
      const angle = Math.atan2(ny, nx);
      const lobeRadius =
        0.78 +
        0.11 * Math.sin(angle * 3.0 + wx * 4.0) +
        0.07 * Math.cos(angle * 5.0 - wy * 4.0);
      const normR = r / Math.max(0.25, lobeRadius);
      const radialFalloff = Math.pow(Math.max(0.0, 1.0 - normR * normR), 1.95);

      const density = radialFalloff * Math.max(0.0, Math.min(1.0, (cloud * 0.72 + fineWisp * 0.38 - 0.14) * 1.45));

      // Finite-difference cloud height gradient for 3D puff self-shadowing
      const cloudUp = fbm(u + wx * 2.2, v - 0.18 + wy * 2.2);
      const cloudLeft = fbm(u - 0.18 + wx * 2.2, v + wy * 2.2);
      const dUp = (cloud - cloudUp) * 1.8 - ny * 0.45;
      const dLeft = (cloud - cloudLeft) * 1.8 - nx * 0.35;
      const sunLobe = Math.max(0.0, Math.min(1.0, 0.58 + dUp * 0.42 + dLeft * 0.28));
      const hemiGrad = Math.max(0.0, Math.min(1.0, (1.0 - ny) * 0.5 * 0.75 + cloud * 0.25));

      data[idx] = Math.round(sunLobe * 255);
      data[idx + 1] = Math.round(hemiGrad * 255);
      data[idx + 2] = Math.round(radialFalloff * 255);
      data[idx + 3] = Math.round(Math.min(1.0, density) * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _smokeCloudTexture = tex;
  return tex;
}

/**
 * Transparent decals keep a zero normal and roughness sample so they do not overwrite the road G-buffer.
 */
const _transparentEffectMRT = mrt({
  normal: vec4(0.0, 0.0, 0.0, 0.0),
  metalRough: vec4(0.0, 0.0, 0.0, 0.0)
});


/**
 * Soft Rounded-Rectangle Under-Vehicle Contact Shadow (Ambient Occlusion) TSL Material
 */
function createContactShadowMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false
  });

  const shadowOpacity = Fn(() => {
    const uvCentered = uv().sub(vec2(0.5, 0.5)).mul(2.0);
    const p = abs(uvCentered);
    // Rounded-box SDF in normalized [-1, 1]^2 quad coords with smooth falloff to 0 before quad edges
    const q = p.sub(vec2(0.64, 0.70));
    const d = length(max(q, vec2(0.0, 0.0))).add(min(max(q.x, q.y), 0.0));
    const chassisAO = smoothstep(0.30, -0.14, d);
    const coreAO = smoothstep(0.76, 0.12, p.x).mul(smoothstep(0.82, 0.16, p.y));
    // Extra contact darkening directly under the 4 tires
    const wheelPatch = smoothstep(0.22, 0.0, length(p.sub(vec2(0.68, 0.56)).mul(vec2(1.4, 1.0))));
    return clamp(chassisAO.mul(0.72).add(coreAO.mul(0.18)).add(wheelPatch.mul(0.18)), 0.0, 0.88);
  })();

  mat.colorNode = Fn(() => color(0x020305))();
  mat.opacityNode = shadowOpacity;
  // Smoothly occlude wet-road SSR under the vehicle footprint proportional to shadow opacity (0 at quad edges)
  mat.mrtNode = mrt({
    normal: vec4(0.0, 0.0, 0.0, 0.0),
    metalRough: vec4(0.0, 1.0, 0.0, shadowOpacity.mul(0.88))
  });

  return mat;
}

/**
 * Car lamp flares for distant traffic (instanced sprites on a unit quad): a soft round glow with a hot core per lamp,
 * placed and sized per instance (`flarePos` = x, y, z, world size) and tinted (`flareCol` = rgb (+ an unused w, so
 * the attribute needs no padding on upload), already including the lamp's visibility from the camera), lit only at
 * dusk & night. Additive, so no fog (it would add fog colour).
 */
function createCarFlareMaterial() {
  const mat = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending
  });
  mat.mrtNode = _transparentEffectMRT;
  const p = attribute('flarePos', 'vec4');
  mat.positionNode = p.xyz;
  mat.scaleNode = vec2(p.w, p.w);
  mat.colorNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    const r = length(uv().sub(0.5)).mul(2.0);
    const halo = pow(smoothstep(1.0, 0.0, r), 1.5);
    const core = smoothstep(0.5, 0.0, r);
    return attribute('flareCol', 'vec4').rgb.mul(halo.add(core.mul(2.0))).mul(night);
  })();
  mat.opacityNode = float(1.0);
  return mat;
}

// Street podium shared by the retail belt, the massing podium, and the curtain-wall
// backstop. Shop mouth sits above a granite plinth. Punched openings exist only
// above HK_RETAIL_BELT, so a curtain grid cannot reach the pavement.
function podiumStreetColor() {
  const y = positionWorld.y;
  const n = normalWorld;
  const facing = step(abs(n.z), abs(n.x));
  const along = mix(positionWorld.z, positionWorld.x, facing);
  const bay = fract(along.mul(0.227));
  const pier = smoothstep(0.1, 0.16, bay).mul(float(1.0).sub(smoothstep(0.84, 0.9, bay)));
  const wall = float(1.0).sub(step(0.72, abs(n.y)));
  const plinth = float(1.0).sub(smoothstep(1.05, 1.22, y));
  const shop = smoothstep(1.12, 1.28, y).mul(float(1.0).sub(smoothstep(3.25, 3.45, y))).mul(pier).mul(wall);
  const fascia = smoothstep(3.25, 3.45, y).mul(float(1.0).sub(smoothstep(4.5, 4.7, y))).mul(wall);
  const belt = float(HK_RETAIL_BELT);
  const above = smoothstep(belt, belt.add(0.15), y);
  const storey = fract(y.sub(belt).div(3.9));
  const hole = smoothstep(0.28, 0.36, bay).mul(float(1.0).sub(smoothstep(0.64, 0.72, bay)));
  const punched = above
    .mul(smoothstep(0.18, 0.26, storey))
    .mul(float(1.0).sub(smoothstep(0.68, 0.76, storey)))
    .mul(hole)
    .mul(wall);
  const granite = vec3(0.34, 0.33, 0.31);
  const stone = vec3(0.55, 0.5, 0.45);
  const tile = vec3(0.78, 0.71, 0.58);
  const mouth = vec3(0.07, 0.06, 0.055);
  const ashlar = vec3(0.63, 0.58, 0.52);
  const pane = vec3(0.13, 0.17, 0.2);
  const base = mix(mix(mix(stone, granite, plinth), mouth, shop), tile, fascia);
  return mix(mix(base, ashlar, above), pane, punched);
}

function podiumShopGlow() {
  const y = positionWorld.y;
  const n = normalWorld;
  const facing = step(abs(n.z), abs(n.x));
  const along = mix(positionWorld.z, positionWorld.x, facing);
  const bay = fract(along.mul(0.227));
  const pier = smoothstep(0.1, 0.16, bay).mul(float(1.0).sub(smoothstep(0.84, 0.9, bay)));
  const wall = float(1.0).sub(step(0.72, abs(n.y)));
  const shop = smoothstep(1.35, 1.55, y).mul(float(1.0).sub(smoothstep(3.05, 3.2, y))).mul(pier).mul(wall);
  const below = float(1.0).sub(step(float(HK_RETAIL_BELT), y));
  const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
  return vec3(1.0, 0.72, 0.38).mul(shop).mul(below).mul(wall).mul(night).mul(0.45);
}

/**
 * Opaque shopfront for extrude and canyon gaps that have no LandsD mesh yet.
 * Granite meets the pavement. The shop mouth is above that plinth. No window
 * grid runs through this belt.
 */
function createRetailPodiumMaterial() {
  if (_retailPodium) return _retailPodium;
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0.02
  });
  mat.name = 'hkRetailPodium';
  mat.colorNode = Fn(() => podiumStreetColor())();
  mat.emissiveNode = Fn(() => podiumShopGlow())();
  _retailPodium = mat;
  return mat;
}

// Massing podium above the shopfront belt: ashlar and punched openings.
// Curtain glass is reserved for the setback tower.
let _podiumMasonry = null;
function createPodiumMasonryMaterial() {
  if (_podiumMasonry) return _podiumMasonry;
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.88,
    metalness: 0.04
  });
  mat.name = 'hkPodiumMasonry';
  mat.colorNode = Fn(() => podiumStreetColor())();
  mat.emissiveNode = Fn(() => podiumShopGlow())();
  _podiumMasonry = mat;
  return mat;
}

export {
  cityUniforms,
  WALL_KINDS,
  createCurtainWallMaterial,
  createRetailPodiumMaterial,
  createPodiumMasonryMaterial,
  createCarPaintMaterial,
  createTreeMaterial,
  createParkPavingMaterial,
  createParkWallMaterial,
  createIronFenceMaterial,
  createParkLampGlobeMaterial,
  createParkLampPoolMaterial,
  createTunnelShadeMaterial,
  createMarbleAshlarMaterial,
  createTreeGrateMaterial,
  createRoadSurfaceMaterial,
  createRoadPaintMaterial,
  createLaneStripeMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createWaterMaterial,
  createParkLawnMaterial,
  createContactShadowMaterial,
  createCarFlareMaterial
};
