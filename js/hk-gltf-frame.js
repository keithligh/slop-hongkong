import {
  BLOCKS,
  HK_CORE_WORLD,
  HK_GLTF_CAP,
  HK_GLTF_SHEET,
  HK_GLTF_SHEETS,
  HK_GLTF_STREET_HALF,
  HK_GLTF_STREET_REACH,
  HK_GLTF_TEX_NEAR,
  HK_STREET_EYE,
  HK_STREET_NEAR,
  ISLAND_BOUNDS,
  blockInHkCore,
  hkCoreProject,
  hkFootprintHeight
} from './city-config.js';

// LandsD individualised glTF (Open3Dhk, EPSG:2326). Node matrices are column-major:
// X = HK1980 easting, Y = HKPD, Z = −northing. Local glTF Z is up; the node swaps it onto Y.
// Inverse Transverse Mercator matches LandsD explanatory notes (worked example, page C9).
// WGS84 is the published small-area shift: latitude −5.5″, longitude +8.8″ (about a metre
// against the Geodetic Survey API on the 11-SW-9B terrain centre, checked 2026-10-24).

const A_HK = 6378388;
const E2_HK = 6.722670022e-3;
const E4_HK = E2_HK * E2_HK;
const GRID_N0 = 819069.8;
const GRID_E0 = 836694.05;
const PHI0 = (22 + 18 / 60 + 43.68 / 3600) * Math.PI / 180;
const LAM0 = (114 + 10 / 60 + 42.8 / 3600) * Math.PI / 180;
const M0 = 2468395.728;
const A0 = 1 - E2_HK / 4 - (3 * E4_HK) / 64;
const A2 = (3 / 8) * (E2_HK + E4_HK / 4);
const A4 = (15 * E4_HK) / 256;
const SHEET_RE = /^[0-9]{1,2}-[NS][EW]-[0-9]{1,2}[A-D]$/i;
const HK_GLTF_MIN_SPAN = 8;

function meridian(phi) {
  return A_HK * (A0 * phi - A2 * Math.sin(2 * phi) + A4 * Math.sin(4 * phi));
}

export function hk80GridToHk80Geog(easting, northing) {
  const target = M0 + (northing - GRID_N0);
  let phi = PHI0;
  for (let i = 0; i < 30; i++) {
    const deriv = A_HK * (A0 - 2 * A2 * Math.cos(2 * phi) + 4 * A4 * Math.cos(4 * phi));
    phi += (target - meridian(phi)) / deriv;
  }
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const nu = A_HK / Math.sqrt(1 - E2_HK * s * s);
  const rho = (A_HK * (1 - E2_HK)) / (1 - E2_HK * s * s) ** 1.5;
  const psi = nu / rho;
  const dE = easting - GRID_E0;
  const x = dE / nu;
  const lat = phi - (t / rho) * (dE * dE) / (2 * nu);
  const lam = LAM0 + x / c - (x ** 3) / (6 * c) * (psi + 2 * t * t);
  return { lat: (lat * 180) / Math.PI, lon: (lam * 180) / Math.PI };
}

export function hk80GridToWgs84(easting, northing) {
  const hk = hk80GridToHk80Geog(easting, northing);
  return { lat: hk.lat - 5.5 / 3600, lon: hk.lon + 8.8 / 3600 };
}

export function hkpdToSidewalkY(hkpd, minHkpd, sidewalk = ISLAND_BOUNDS.sidewalkHeight) {
  return (hkpd - minHkpd) + sidewalk;
}

export function hk80ToWorld(easting, northing, hkpd, minHkpd = hkpd) {
  const { lat, lon } = hk80GridToWgs84(easting, northing);
  const [x, z] = hkCoreProject(lon, lat);
  return [x, hkpdToSidewalkY(hkpd, minHkpd), z];
}

function localMatrix(node) {
  if (node.matrix && node.matrix.length === 16) return node.matrix;
  const t = node.translation || [0, 0, 0];
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}

function mulMat4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function applyMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

export function boundsFromGltf(doc) {
  const nodes = doc.nodes || [];
  const worlds = new Array(nodes.length);
  function worldOf(index, parent) {
    if (worlds[index]) return worlds[index];
    const node = nodes[index] || {};
    const m = parent ? mulMat4(parent, localMatrix(node)) : localMatrix(node).slice();
    worlds[index] = m;
    for (const child of node.children || []) worldOf(child, m);
    return m;
  }
  const scene = (doc.scenes || [])[doc.scene || 0] || { nodes: [] };
  for (const index of scene.nodes || []) worldOf(index, null);

  let name = '';
  for (const node of nodes) {
    if (node.name) {
      name = node.name;
      break;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minH = Infinity;
  let maxH = -Infinity;
  let any = false;
  nodes.forEach((node, index) => {
    if (node.mesh == null) return;
    const mesh = (doc.meshes || [])[node.mesh];
    const m = worlds[index] || localMatrix(node);
    for (const prim of mesh?.primitives || []) {
      const acc = (doc.accessors || [])[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      const [x0, y0, z0] = acc.min;
      const [x1, y1, z1] = acc.max;
      const corners = [
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1],
        [x1, y0, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1]
      ];
      for (const [x, y, z] of corners) {
        const placed = applyMat4(m, x, y, z);
        const [wx, , wz] = hk80ToWorld(placed[0], -placed[2], placed[1]);
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
        minH = Math.min(minH, placed[1]);
        maxH = Math.max(maxH, placed[1]);
        any = true;
      }
    }
  });
  if (!any) throw new Error(`no POSITION bounds in ${name || 'gltf'}`);
  return {
    name,
    minX,
    maxX,
    minZ,
    maxZ,
    minH,
    maxH,
    span: Math.max(maxX - minX, maxZ - minZ)
  };
}

export function isBuildingGltf(filePath) {
  const norm = String(filePath).replace(/\\/g, '/');
  const file = norm.split('/').pop() || '';
  if (!file.toLowerCase().endsWith('.gltf')) return false;
  const upper = norm.toUpperCase();
  return upper.includes('/BUILDING/') || upper.startsWith('BUILDING/') || file.toUpperCase().startsWith('BUILDING_');
}

export function assertSheetAllowed(sheet) {
  const id = String(sheet || '').trim().toUpperCase();
  if (!SHEET_RE.test(id)) throw new Error(`bad sheet ${sheet}`);
  return id;
}

export function chooseCentralSheet(reports) {
  if (!reports?.length) throw new Error('no sheet reports');
  const first = reports[0];
  if (first.overlap > 0) {
    return {
      sheet: first.sheet,
      reason: `${first.sheet} has ${first.overlap} BUILDING glTF models overlapping Central`
    };
  }
  const fallback = reports.find((report) => report.sheet === '11-SW-9A' && report !== first);
  if (first.sheet === '11-SW-9B' && fallback) {
    return {
      sheet: '11-SW-9A',
      reason: `11-SW-9B has ${first.buildingFiles} BUILDING glTF files and ${first.overlap} overlapping Central. Using 11-SW-9A (${fallback.buildingFiles} BUILDING files, ${fallback.overlap} overlapping).`
    };
  }
  return {
    sheet: first.sheet,
    reason: `${first.sheet} has no Central BUILDING overlap`
  };
}

function intersectsCore(entry, core) {
  return entry.maxX >= core.minX && entry.minX <= core.maxX && entry.maxZ >= core.minZ && entry.minZ <= core.maxZ;
}

export function boxClosestDistance(box, eye) {
  if (!box || !eye) return Infinity;
  const x = Math.max(box.minX, Math.min(eye.x, box.maxX));
  const z = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
  return Math.hypot(x - eye.x, z - eye.z);
}

export function footprintOverlapRatio(block, mesh, margin = 2) {
  if (!block || !mesh) return 0;
  const minX = Math.max(block.minX, mesh.minX - margin);
  const maxX = Math.min(block.maxX, mesh.maxX + margin);
  const minZ = Math.max(block.minZ, mesh.minZ - margin);
  const maxZ = Math.min(block.maxZ, mesh.maxZ + margin);
  const iw = maxX - minX;
  const iz = maxZ - minZ;
  if (iw <= 0 || iz <= 0) return 0;
  const blockArea = Math.max(1, (block.maxX - block.minX) * (block.maxZ - block.minZ));
  const meshArea = Math.max(1, (mesh.maxX - mesh.minX) * (mesh.maxZ - mesh.minZ));
  return (iw * iz) / Math.min(blockArea, meshArea);
}

export function gltfCoversFootprint(block, meshes, margin = 2) {
  if (!block || !meshes?.length) return false;
  return meshes.some((mesh) => footprintOverlapRatio(block, mesh, margin) >= 0.15);
}

// 0 keeps the file's native edge (LandsD facade JPEGs are 4096). Off-chase masses may drop to 2048.
export const HK_GLTF_FAR_TEX = 2048;

function chaseAxes(eye) {
  const heading = Number.isFinite(eye?.heading) ? eye.heading : HK_STREET_EYE.heading;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  return { x: eye?.x ?? HK_STREET_EYE.x, z: eye?.z ?? HK_STREET_EYE.z, fx, fz, sx: -fz, sz: fx };
}

// Along / side of the mesh box in the Des Voeux look frame. Side 0 is the look ray.
export function gltfBoxChase(entry, eye = HK_STREET_EYE) {
  const { x, z, fx, fz, sx, sz } = chaseAxes(eye);
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minSide = Infinity;
  let maxSide = -Infinity;
  const xs = [entry?.minX, entry?.maxX];
  const zs = [entry?.minZ, entry?.maxZ];
  for (const px of xs) {
    for (const pz of zs) {
      const dx = px - x;
      const dz = pz - z;
      const along = dx * fx + dz * fz;
      const side = dx * sx + dz * sz;
      if (along < minAlong) minAlong = along;
      if (along > maxAlong) maxAlong = along;
      if (side < minSide) minSide = side;
      if (side > maxSide) maxSide = side;
    }
  }
  return { minAlong, maxAlong, minSide, maxSide };
}

// The person chase, not a radius. A facade whose box crosses the look corridor
// is on screen at eye height: The Henderson sits on this ray past 120 m, and a
// mip chain there is the brown smear. Masses behind the camera do not qualify.
export function gltfInStreetChase(entry, eye = HK_STREET_EYE, reach = HK_GLTF_STREET_REACH, half = HK_GLTF_STREET_HALF) {
  if (!entry || !Number.isFinite(entry.minX)) return false;
  const { minAlong, maxAlong, minSide, maxSide } = gltfBoxChase(entry, eye);
  return maxAlong >= -12 && minAlong <= reach && maxSide >= -half && minSide <= half;
}

// Native photo: the 120 m disc (a glance off the ray still hits the colonnade)
// or the chase corridor past that disc.
export function gltfStreetPhoto(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  if (!entry) return false;
  if (boxClosestDistance(entry, eye) <= near) return true;
  return gltfInStreetChase(entry, eye);
}

export function gltfTextureMaxEdge(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  if (!entry) return HK_GLTF_FAR_TEX;
  return gltfStreetPhoto(entry, eye, near) ? 0 : HK_GLTF_FAR_TEX;
}

// A native chase photograph is the chart the mesh actually uses. FME packs
// that chart into a sub-rectangle (Bank of China Tower _001 is u ≤ 0.125,
// v ≤ 0.49 of a 4096² file; the Bank of China Building flank _002 is the
// left half) and fills the rest with flat gutter. Repeat wrap plus a kernel
// that can see that gutter is the flank tear. Two mip levels cannot minification-
// filter a midfar wall, so the same charts alias into grain and stripes.
// The chase sampler crops a sub-rectangle, clamps, and builds a mip chain
// that does not average gutter into the photograph. A repeating primitive
// (UVs outside the image) stays repeating. Off-look masses still keep a
// downscaled mip chain and anisotropy 16.
// LandsD null-fill triangles stay omitted. The sample uses glTF v = 0 as the
// first image row, the same row flipY false uploads.

export function clampLandsdAnisotropy(requested, limit = 16) {
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.min(16, limit) : 16;
  const ask = Number.isFinite(requested) ? requested : 1;
  return Math.max(1, Math.min(Math.floor(ask), Math.floor(cap)));
}

// CPU sheet used only to classify padding. 256 on a 4096 atlas averaged a
// chart edge into the grey fill and dropped real south-lot faces (B34475).
// 1024 keeps that edge. The GPU upload is a different path. Pale padding
// is still a hole. Consensus stays corners-null or centroid-null.
export const NULL_FILL_EDGE = 1024;

export function nullFillSampleSize(width, height, edge = NULL_FILL_EDGE) {
  const w0 = width | 0;
  const h0 = height | 0;
  const cap = Number.isFinite(edge) && edge > 0 ? edge : NULL_FILL_EDGE;
  if (!(w0 > 0) || !(h0 > 0)) return { w: 0, h: 0 };
  const scale = Math.min(1, cap / Math.max(w0, h0));
  return {
    w: Math.max(1, Math.round(w0 * scale)),
    h: Math.max(1, Math.round(h0 * scale))
  };
}

// LandsD atlas padding. A texel this flat is not a facade photograph.
export function isLandsdNullTexel(r, g, b) {
  if (r <= 3 && g <= 3 && b <= 3) return true;
  if (Math.abs(r - 128) <= 2 && Math.abs(g - 128) <= 2 && Math.abs(b - 128) <= 2) return true;
  if (Math.abs(r - 136) <= 4 && Math.abs(g - 138) <= 4 && Math.abs(b - 137) <= 4) return true;
  return false;
}

// Gutter for mip filtering only. The 128 and 136 fills are the published null
// charts. RGB(60, 60, 60) is the flat unused field on FME atlases whose mesh
// UVs never leave the photographed strip (Bank of China Tower _001, measured
// 2026-10-25). Near-black stays a photograph: a window is not padding, and
// dropping it here would open the glass in the mip. Triangle omission still
// uses isLandsdNullTexel, so this does not punch new holes.
export function isLandsdAtlasGutter(r, g, b) {
  if (Math.abs(r - 128) <= 2 && Math.abs(g - 128) <= 2 && Math.abs(b - 128) <= 2) return true;
  if (Math.abs(r - 136) <= 4 && Math.abs(g - 138) <= 4 && Math.abs(b - 137) <= 4) return true;
  if (Math.abs(r - 60) <= 2 && Math.abs(g - 60) <= 2 && Math.abs(b - 60) <= 2) return true;
  return false;
}

// A chase primitive that uses one sub-rectangle of the atlas. Full-bleed
// charts (both axes cover the image) and repeating charts (UVs outside the
// image) are not crops: cropping those would either do nothing or cut a tile.
// A full-bleed primitive can still be a stack of smaller face charts. Those
// are grouped by groupLandsdOnEyeCharts, not by this rect.
export function landsdChartWrap(minU, minV, maxU, maxV) {
  if (![minU, minV, maxU, maxV].every(Number.isFinite)) return 'clamp';
  if (minU < -0.002 || minV < -0.002 || maxU > 1.002 || maxV > 1.002) return 'repeat';
  return 'clamp';
}

export function landsdChartRect(minU, minV, maxU, maxV) {
  if (landsdChartWrap(minU, minV, maxU, maxV) !== 'clamp') return null;
  const u0 = Math.max(0, minU);
  const v0 = Math.max(0, minV);
  const u1 = Math.min(1, maxU);
  const v1 = Math.min(1, maxV);
  const du = u1 - u0;
  const dv = v1 - v0;
  if (!(du > 0.01 && dv > 0.01)) return null;
  if (du >= 0.9 && dv >= 0.9) return null;
  return { u0, v0, u1, v1 };
}

// Digit1 actually samples these three atlases. Each one is full-bleed, so
// the primitive rect above is null, while the hit face is a small chart
// with a one-pixel gutter into the next chart. The fixture exemplars are
// not in this list: tower _001 is the left strip, flank _002 is the left half.
export const LANDSD_ON_EYE_CHARTS = Object.freeze([
  'B346831557701063A0_002',
  'B346831557701063A0_003',
  'B345471572201063A0_001'
]);

// Ray hits at ?at=-1.4,29.3,1.29. Primitive bounds cover the JPEG, so
// landsdChartRect is null. The face is the triangle the ray landed on.
export const LANDSD_ON_EYE_HITS = Object.freeze({
  B346831557701063A0_002: Object.freeze({
    primitive: Object.freeze({ minU: 0, minV: 0, maxU: 1, maxV: 0.9980000257492065 }),
    face: Object.freeze({
      minU: 0.8590679168701172,
      minV: 0.5014269351959229,
      maxU: 0.9172242283821106,
      maxV: 0.7400000095367432
    })
  }),
  B346831557701063A0_003: Object.freeze({
    primitive: Object.freeze({
      minU: 0,
      minV: 0.0009999871253967285,
      maxU: 1,
      maxV: 0.9990000128746033
    }),
    face: Object.freeze({
      minU: 0.5049999952316284,
      minV: 0.0009999871253967285,
      maxU: 0.9210000038146973,
      maxV: 0.125
    })
  }),
  B345471572201063A0_001: Object.freeze({
    primitive: Object.freeze({
      minU: 0.00026535987854003906,
      minV: 0,
      maxU: 1,
      maxV: 0.996999979019165
    }),
    face: Object.freeze({
      minU: 0.7569730281829834,
      minV: 0.3320434093475342,
      maxU: 0.7739664912223816,
      maxV: 0.4330368638038635
    })
  })
});

export function isLandsdOnEyeChart(name) {
  return LANDSD_ON_EYE_CHARTS.includes(name);
}

// 16 px on a 4096 atlas. Faces that share a cell share one crop.
const ON_EYE_QUANTUM = 1 / 256;

// Pad the cropped face by the anisotropy kernel so a sample on the chart
// edge replicates the photograph instead of the next chart.
export const LANDSD_ON_EYE_PAD = 16;
export const LANDSD_ON_EYE_ATLAS = 4096;

// Group triangles of a full-bleed primitive by the chart each face uses.
// The map key is a 1/256 cell so faces of one chart share a crop. The crop
// is the tight union of those faces, not the cell: rounding out to the cell
// would pull the one-pixel gutter, and the chart beside it, into the bitmap.
// A primitive that is already one sub-rectangle, or that repeats, returns
// null so the existing crop path keeps it. Triangles too small to be a
// chart (or the collapsed UV cluster) stay in `rest` on the original image.
export function groupLandsdOnEyeCharts(minU, minV, maxU, maxV, triangles) {
  if (landsdChartWrap(minU, minV, maxU, maxV) !== 'clamp') return null;
  if (landsdChartRect(minU, minV, maxU, maxV)) return null;
  const groups = new Map();
  const rest = [];
  const list = triangles || [];
  for (let i = 0; i < list.length; i++) {
    const tri = list[i];
    const face = landsdChartRect(tri.minU, tri.minV, tri.maxU, tri.maxV);
    if (!face) {
      rest.push(i);
      continue;
    }
    const x0 = Math.floor(face.u0 / ON_EYE_QUANTUM);
    const y0 = Math.floor(face.v0 / ON_EYE_QUANTUM);
    const x1 = Math.ceil(face.u1 / ON_EYE_QUANTUM);
    const y1 = Math.ceil(face.v1 / ON_EYE_QUANTUM);
    const key = `${x0},${y0},${x1},${y1}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        rect: { u0: face.u0, v0: face.v0, u1: face.u1, v1: face.v1 },
        triangles: []
      };
      groups.set(key, group);
    } else {
      if (face.u0 < group.rect.u0) group.rect.u0 = face.u0;
      if (face.v0 < group.rect.v0) group.rect.v0 = face.v0;
      if (face.u1 > group.rect.u1) group.rect.u1 = face.u1;
      if (face.v1 > group.rect.v1) group.rect.v1 = face.v1;
    }
    group.triangles.push(i);
  }
  if (!groups.size) return null;
  return { groups: [...groups.values()], rest };
}

// Shelf-pack chart bitmaps into 4096 atlases. Each slot is the chart plus
// `pad` pixels of replicated edge on every side. A slot that cannot fit
// the atlas is null; the caller leaves that face on the original image.
export function packLandsdChartBins(rects, atlasSize = LANDSD_ON_EYE_ATLAS, pad = LANDSD_ON_EYE_PAD) {
  const size = atlasSize | 0;
  const gutter = Math.max(0, pad | 0);
  const order = (rects || []).map((rect, index) => ({
    index,
    width: Math.max(1, rect.width | 0),
    height: Math.max(1, rect.height | 0)
  }));
  order.sort((a, b) => b.height - a.height || a.index - b.index);
  const placed = new Array((rects || []).length);
  let atlas = 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const item of order) {
    const slotW = item.width + gutter * 2;
    const slotH = item.height + gutter * 2;
    if (slotW > size || slotH > size) {
      placed[item.index] = null;
      continue;
    }
    if (x > 0 && x + slotW > size) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    if (y > 0 && y + slotH > size) {
      atlas += 1;
      x = 0;
      y = 0;
      rowH = 0;
    }
    placed[item.index] = {
      atlas,
      x,
      y,
      width: slotW,
      height: slotH,
      pad: gutter,
      contentX: x + gutter,
      contentY: y + gutter,
      contentWidth: item.width,
      contentHeight: item.height
    };
    x += slotW;
    if (slotH > rowH) rowH = slotH;
  }
  return placed;
}

export function remapLandsdChartUv(u, v, rect) {
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  if (!(du > 0) || !(dv > 0)) return [u, v];
  let uu = (u - rect.u0) / du;
  let vv = (v - rect.v0) / dv;
  if (uu < 0) uu = 0;
  else if (uu > 1) uu = 1;
  if (vv < 0) vv = 0;
  else if (vv > 1) vv = 1;
  return [uu, vv];
}

// Pixel crop of a chart. v = 0 is the first file row, the same row flipY false
// uploads, so y grows down the file with v.
export function landsdChartPixels(rect, width, height) {
  const w = width | 0;
  const h = height | 0;
  if (!(w > 0) || !(h > 0) || !rect) return null;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(rect.u0 * w)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(rect.v0 * h)));
  const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil(rect.u1 * w)));
  const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil(rect.v1 * h)));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

export function landsdGutterFraction(src, width, height, stride = 1) {
  const step = Math.max(1, stride | 0);
  let n = 0;
  let g = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      n++;
      if (isLandsdAtlasGutter(src[i], src[i + 1], src[i + 2])) g++;
    }
  }
  return n ? g / n : 0;
}

// One mip down. Gutter texels do not enter the average, so a street-angle
// sample of a chart stays the photograph instead of the flat fill beside it.
// A block that is only gutter stays gutter.
export function landsdGutterMip(src, width, height) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(height - 1, y * 2);
    const y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x0 + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (const yy of [y0, y1]) {
        for (const xx of [x0, x1]) {
          const i = (yy * width + xx) * 4;
          const R = src[i];
          const G = src[i + 1];
          const B = src[i + 2];
          if (isLandsdAtlasGutter(R, G, B)) continue;
          r += R;
          g += G;
          b += B;
          a += src[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (!n) {
        const i = (y0 * width + x0) * 4;
        out[o] = src[i];
        out[o + 1] = src[i + 1];
        out[o + 2] = src[i + 2];
        out[o + 3] = src[i + 3];
      } else {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return { data: out, width: w, height: h };
}

// Copy photograph texels one pixel into neighbouring gutter, `radius` times.
// Interior texels are unchanged. The anisotropic kernel at a chart edge then
// hits the photograph instead of the fill.
export function landsdDilateGutter(src, width, height, radius = 2) {
  let cur = new Uint8ClampedArray(src);
  const passes = Math.max(0, radius | 0);
  for (let p = 0; p < passes; p++) {
    const next = new Uint8ClampedArray(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (!isLandsdAtlasGutter(cur[o], cur[o + 1], cur[o + 2])) continue;
        let copied = false;
        for (let dy = -1; dy <= 1 && !copied; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const i = (yy * width + xx) * 4;
            if (isLandsdAtlasGutter(cur[i], cur[i + 1], cur[i + 2])) continue;
            next[o] = cur[i];
            next[o + 1] = cur[i + 1];
            next[o + 2] = cur[i + 2];
            next[o + 3] = cur[i + 3];
            copied = true;
            break;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

// glTF v = 0 is the first row of the file (the top). flipY false uploads that
// row to texture v = 0. Row (1-v) is the other side of the chart.
export function landsdAlbedoRow(v, height) {
  if (!(height > 0)) return 0;
  let vv = v % 1;
  if (vv < 0) vv += 1;
  return Math.min(height - 1, (vv * height) | 0);
}

function texelIsNull(rgb) {
  return !!(rgb && isLandsdNullTexel(rgb[0], rgb[1], rgb[2]));
}

// Drop a triangle when every corner is padding, or when the face centre is.
// A photographed centre stays. A missing sample stays (the mesh is not deleted).
// The centre test is what removes a padding face that only shares a corner with a chart.
export function landsdNullFillTriangles(index, sampleVertex, sampleCentroid) {
  const kept = [];
  let dropped = 0;
  const src = index || [];
  for (let t = 0; t + 2 < src.length; t += 3) {
    const a = src[t];
    const b = src[t + 1];
    const c = src[t + 2];
    const ca = sampleVertex(a);
    const cb = sampleVertex(b);
    const cc = sampleVertex(c);
    const cornersNull = texelIsNull(ca) && texelIsNull(cb) && texelIsNull(cc);
    const centroidNull = sampleCentroid ? texelIsNull(sampleCentroid(a, b, c)) : false;
    if (cornersNull || centroidNull) {
      dropped++;
      continue;
    }
    kept.push(a, b, c);
  }
  return { index: kept, dropped };
}

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function componentBytes(type) {
  if (type === 5120 || type === 5121) return 1;
  if (type === 5122 || type === 5123) return 2;
  if (type === 5125 || type === 5126) return 4;
  return 0;
}

function readComponent(view, offset, type) {
  switch (type) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: {
      const unknown = type;
      throw new Error(`gltf component ${unknown}`);
    }
  }
}

function readAccessor(doc, index, buffers) {
  const acc = doc.accessors[index];
  const view = doc.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const bytes = componentBytes(acc.componentType);
  if (!buf || !bytes) throw new Error('gltf accessor buffer');
  const data = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const comps = COMPS[acc.type];
  if (!comps) throw new Error(`gltf accessor ${acc.type}`);
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || comps * bytes;
  const out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    const base = start + i * stride;
    for (let c = 0; c < comps; c++) out[i * comps + c] = readComponent(data, base + c * bytes, acc.componentType);
  }
  return out;
}

// World triangles for one LandsD building, sidewalk-snapped the same way the
// mounted mesh is. Used to test look rays past the box cap, where a hollow
// shell's bounds are not a facade. Returns null when the file has no positions.
export function bakeGltfWorldTriangles(doc, buffers, sidewalk = ISLAND_BOUNDS.sidewalkHeight) {
  if (!doc) return null;
  const nodes = doc.nodes || [];
  const worlds = new Array(nodes.length);
  function worldOf(index, parent) {
    if (worlds[index]) return worlds[index];
    const node = nodes[index] || {};
    const m = parent ? mulMat4(parent, localMatrix(node)) : localMatrix(node).slice();
    worlds[index] = m;
    for (const child of node.children || []) worldOf(child, m);
    return m;
  }
  const scene = (doc.scenes || [])[doc.scene || 0] || { nodes: [] };
  for (const index of scene.nodes || []) worldOf(index, null);
  const parts = [];
  let minH = Infinity;
  nodes.forEach((node, index) => {
    if (node.mesh == null) return;
    const mesh = (doc.meshes || [])[node.mesh];
    const m = worlds[index] || localMatrix(node);
    for (const prim of mesh?.primitives || []) {
      if (prim.attributes?.POSITION == null) continue;
      const pos = readAccessor(doc, prim.attributes.POSITION, buffers);
      const count = pos.length / 3;
      const placed = new Float64Array(pos.length);
      for (let i = 0; i < count; i++) {
        const p = applyMat4(m, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        const [x, , z] = hk80ToWorld(p[0], -p[2], p[1]);
        placed[i * 3] = x;
        placed[i * 3 + 1] = p[1];
        placed[i * 3 + 2] = z;
        if (p[1] < minH) minH = p[1];
      }
      let indexData;
      if (prim.indices != null) indexData = readAccessor(doc, prim.indices, buffers);
      else {
        indexData = new Float64Array(count);
        for (let i = 0; i < count; i++) indexData[i] = i;
      }
      parts.push({ placed, indexData });
    }
  });
  if (!parts.length || !Number.isFinite(minH)) return null;
  const shift = sidewalk - minH;
  const floats = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    const { placed, indexData } = part;
    for (let i = 1; i < placed.length; i += 3) placed[i] += shift;
    for (let t = 0; t + 2 < indexData.length; t += 3) {
      for (const id of [indexData[t], indexData[t + 1], indexData[t + 2]]) {
        const x = placed[id * 3];
        const y = placed[id * 3 + 1];
        const z = placed[id * 3 + 2];
        floats.push(x, y, z);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  if (floats.length < 9) return null;
  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    triangles: Float32Array.from(floats)
  };
}

export function gltfAlbedoSampler(entry, eye = HK_STREET_EYE, near = HK_GLTF_TEX_NEAR) {
  const maxEdge = gltfTextureMaxEdge(entry, eye, near);
  // Chase photographs pack to the UV chart and mip without the gutter.
  // mipLevels is intentionally unset: a two-level stop is the grain. Off-look
  // masses (maxEdge 2048) keep a downscaled chain and do not take this path.
  if (maxEdge === 0) {
    return {
      maxEdge: 0,
      mipmaps: true,
      chartMips: true,
      anisotropy: 16,
      minFilter: 'mipmap',
      wrap: 'clamp'
    };
  }
  return { maxEdge, mipmaps: true, anisotropy: 16, minFilter: 'mipmap' };
}

function bankOfChinaPins() {
  const pins = [];
  for (const block of BLOCKS) {
    if (block?.name === 'Bank of China Tower' && block.height === 303.3) pins.push(block);
  }
  return pins;
}

// The tower footprint crosses the south edge of 11-SW-9C into 11-SW-14A.
// A bounds pass of that sheet's BUILDING glTF (2026-10-25) found one mesh on the
// plate. 9C and 8D still do not contain it. Mid-band canyon hits are not in this box.
export const HK_GLTF_PIN_SHEETS = Object.freeze(['11-SW-14A']);

export const HK_BOC_PHOTO_CHART = Object.freeze({
  sheet: '11-SW-14A',
  id: 'B346831557701063A0',
  file: 'BUILDING/B346831557701063A0/B346831557701063A0.gltf',
  minX: 148.4,
  maxX: 216.9,
  minZ: 144.1,
  maxZ: 212.6,
  minH: 7.1,
  maxH: 373,
  span: 68.5
});

// Digit1 mid-band plates. Live picks from the Des Voeux eye, heading 1.29.
// Cut #36 (2026-10-25) bounds-tested BUILDING glTF against these points.
// HK1980 of the hits is about E 834589–834649, N 815701–815734, inside 11-SW-9C.
export const HK_DIGIT1_MIDBAND_HITS = Object.freeze([
  Object.freeze({ name: 'right_midfar', x: 84.9, y: 14.7, z: 77.3 }),
  Object.freeze({ name: 'right_midfar_up', x: 80.9, y: 18.3, z: 71.1 }),
  Object.freeze({ name: 'left_midfar', x: 141.2, y: 21.6, z: 44.1 })
]);

// No entry until a LandsD BUILDING mesh contains the hits. An empty list is the miss.
export const HK_MIDBAND_PHOTO_CHARTS = Object.freeze([]);

// Closest BUILDING mesh on each sheet whose rectangle is within 200 m of a hit.
// Id radius 280 m. A mesh that contained a hit would carry an id point on that
// building, so an id farther than the longest sheet mesh (~185 m on 8D) cannot
// hide a cover. Sheet-wide GENERIC / TERRAIN / VEGETATION tiles are not buildings:
// their boxes are the whole of 11-SW-9C and are not a facade.
export const HK_DIGIT1_MIDBAND_HUNT = Object.freeze([
  Object.freeze({
    sheet: '11-SW-9C',
    buildingGltf: 73,
    idRadiusM: 280,
    tested: 41,
    closestM: 25.5,
    closestId: 'B345471572201063A0',
    minX: 12.9,
    maxX: 55.4,
    minZ: 49.8,
    maxZ: 95.7
  }),
  Object.freeze({
    sheet: '11-SW-8D',
    buildingGltf: 781,
    idRadiusM: 280,
    tested: 18,
    closestM: 67.5,
    closestId: 'B344751569101063A0',
    minX: -66.9,
    maxX: 13.4,
    minZ: 29.2,
    maxZ: 102.1
  }),
  Object.freeze({
    sheet: '11-SW-14A',
    buildingGltf: 204,
    idRadiusM: 280,
    tested: 15,
    closestM: 80.1,
    closestId: 'B345371559501063A0',
    minX: -8.6,
    maxX: 61.9,
    minZ: 154.0,
    maxZ: 222.8
  }),
  Object.freeze({
    sheet: '11-SW-13B',
    buildingGltf: 342,
    idRadiusM: 280,
    tested: 8,
    closestM: 155.7,
    closestId: 'B343871555501063A0',
    minX: -128.9,
    maxX: -43.1,
    minZ: 165.9,
    maxZ: 273.5
  })
]);

// Sheets named by the cut, eliminated on the 1:1000 grid (NW corner, 750 × 600 m).
// Distance is the closest hit to the sheet rectangle. None was downloaded.
export const HK_DIGIT1_MIDBAND_GRID_ELIMINATED = Object.freeze([
  Object.freeze({ sheet: '11-SW-9D', minM: 601 }),
  Object.freeze({ sheet: '11-SW-9A', minM: 466 }),
  Object.freeze({ sheet: '11-SW-9B', minM: 760 }),
  Object.freeze({ sheet: '11-SW-14B', minM: 615 }),
  Object.freeze({ sheet: '11-SW-13A', minM: 846 }),
  Object.freeze({ sheet: '11-SW-15A', minM: 1357 }),
  Object.freeze({ sheet: '11-SW-10D', minM: 2101 }),
  Object.freeze({ sheet: '11-SW-12C', minM: 2444 }),
  Object.freeze({ sheet: '11-SW-8C', minM: 839 })
]);

// Closest non-BUILDING feature that is not a sheet-wide tile. Not a photograph to pin.
export const HK_DIGIT1_MIDBAND_NOT_BUILDING = Object.freeze({
  sheet: '11-SW-9C',
  id: 'I346541564803063A0',
  kind: 'INFRASTRUCTURE',
  closestM: 18.7,
  minX: 87.4,
  maxX: 238.6,
  minZ: 95.8,
  maxZ: 172.8
});

export function hkGltfBoxContains(box, x, z, pad = 0) {
  if (!box || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  return x >= box.minX - pad && x <= box.maxX + pad && z >= box.minZ - pad && z <= box.maxZ + pad;
}

export function digit1MidbandChartsCover(charts = HK_MIDBAND_PHOTO_CHARTS, hits = HK_DIGIT1_MIDBAND_HITS, pad = 0) {
  const list = charts || [];
  if (!list.length || !hits?.length) return false;
  return hits.every((hit) => list.some((box) => hkGltfBoxContains(box, hit.x, hit.z, pad)));
}

export function isGltfPinSheet(sheet) {
  return HK_GLTF_PIN_SHEETS.includes(String(sheet || '').trim().toUpperCase());
}

// A pin sheet contributes the photograph that covers the plate. The rest of
// that zip stays out of the cap so a nearer Admiralty block cannot drop a
// Des Voeux face.
export function filterPinSheetBuildings(buildings, pins = null) {
  const pinBoxes = pins || bankOfChinaPins();
  return (buildings || []).filter((entry) =>
    pinBoxes.some((pin) => footprintOverlapRatio(pin, entry, 2) >= 0.15)
  );
}

export function planGltfManifest(manifest, {
  cap = HK_GLTF_CAP,
  minSpan = HK_GLTF_MIN_SPAN,
  core = HK_CORE_WORLD,
  eye = HK_STREET_EYE,
  pins = null
} = {}) {
  const buildings = Array.isArray(manifest?.buildings) ? manifest.buildings : [];
  let skippedSpeck = 0;
  let skippedOutside = 0;
  const masses = [];
  for (const entry of buildings) {
    if (!(entry.span >= minSpan)) {
      skippedSpeck++;
      continue;
    }
    if (!intersectsCore(entry, core)) {
      skippedOutside++;
      continue;
    }
    masses.push({ ...entry, dist: boxClosestDistance(entry, eye) });
  }
  const pinBoxes = pins || bankOfChinaPins();
  const pinned = [];
  const rest = [];
  for (const entry of masses) {
    if (pinBoxes.some((pin) => footprintOverlapRatio(pin, entry, 2) >= 0.15)) pinned.push(entry);
    else rest.push(entry);
  }
  // Street faces first. A nearer Sheung Wan block behind the camera must not
  // take the cap slot of a facade on the Des Voeux look.
  const byChase = (a, b) => {
    const pa = gltfStreetPhoto(a, eye) ? 0 : 1;
    const pb = gltfStreetPhoto(b, eye) ? 0 : 1;
    return pa - pb || a.dist - b.dist || (b.span - a.span);
  };
  pinned.sort(byChase);
  rest.sort(byChase);
  const selected = pinned.concat(rest).slice(0, cap).map(({ dist, ...entry }) => entry);
  return {
    sheet: manifest?.sheet || '',
    reason: manifest?.reason || '',
    selected,
    skippedSpeck,
    skippedOutside,
    skippedCap: Math.max(0, masses.length - selected.length)
  };
}

export function hiddenExtrudeIds(blocks, meshes, {
  margin = 2,
  eye = HK_STREET_EYE,
  near = HK_STREET_NEAR
} = {}) {
  const list = meshes || [];
  const killNear = list.some((mesh) => boxClosestDistance(mesh, eye) <= near);
  const ids = [];
  for (const block of blocks) {
    if (block.park > 0.6 || block.median) continue;
    if (!blockInHkCore(block)) continue;
    if (!(hkFootprintHeight(block) > 0)) continue;
    const nearField = killNear && boxClosestDistance(block, eye) <= near;
    if (nearField || gltfCoversFootprint(block, list, margin)) ids.push(block.id);
  }
  return ids;
}

export function resolveHkGltfRequest(href, { configured = HK_GLTF_SHEET, sheets = HK_GLTF_SHEETS, cap = HK_GLTF_CAP } = {}) {
  let sheetQuery = '';
  let capQuery = '';
  try {
    const params = new URL(href || 'http://local/', 'http://local/').searchParams;
    sheetQuery = params.get('gltf') || '';
    capQuery = params.get('gltfCap') || '';
  } catch {
    sheetQuery = '';
  }
  let n = cap;
  if (capQuery) {
    const parsed = Number(capQuery);
    if (Number.isFinite(parsed) && parsed > 0) n = parsed;
  }
  const clamped = Math.min(800, Math.floor(n));
  const query = sheetQuery.trim();
  if (query) {
    if (!SHEET_RE.test(query)) return null;
    const sheet = query.toUpperCase();
    return { sheet, sheets: [sheet], cap: clamped };
  }
  const list = (Array.isArray(sheets) && sheets.length ? sheets : (configured ? [configured] : []))
    .map((id) => String(id || '').trim().toUpperCase())
    .filter((id) => SHEET_RE.test(id));
  if (!list.length) return null;
  return { sheet: list[0], sheets: list, cap: clamped };
}

export function formatGltfLog(info) {
  return `[gltf] sheet ${info.sheet} loaded ${info.loaded} skipped ${info.skipped} ` +
    `(speck ${info.skippedSpeck} outside ${info.skippedOutside} cap ${info.skippedCap}); ` +
    `extrudes hidden ${info.hidden}; ` +
    `transform EPSG:2326 HK1980 grid → WGS84 (−5.5″ lat, +8.8″ lon) → Central ENU; ` +
    `y snaps min HKPD to sidewalk ${info.sidewalk}m; ` +
    `street eye ${HK_STREET_EYE.x},${HK_STREET_EYE.z} hides procedural within ${HK_STREET_NEAR}m when a LandsD mesh is inside that disc`;
}

export { HK_GLTF_MIN_SPAN };
