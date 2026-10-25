import { isLandsdNullTexel } from './hk-gltf-frame.js';

// Digit1 pixel probe. The omit/mip/flipY cuts left the MSI pale fraction
// unchanged, so this file only classifies a measured pixel. It does not drop
// triangles. The page view is whatever `?at=` actually frames after teleport.
// The locked view is the chase pose on that coordinate, which is the camera
// the earlier CPU pick used.

export const HENDERSON_BUILDING_ID = 'B347491569901063A0';

// The full chase set decodes to about 4.5 GB of albedo. On a memory-capped
// headless GPU process that kills the WebGPU instance before a pixel can be
// read. These are the LandsD buildings the Digit1 rays hit on that full set:
// Henderson on the centre look, and the two nearer masses on the side samples.
// The eye-height building that contains the camera is not one of them.
export const DIGIT1_PROBE_BUILDINGS = Object.freeze([
  HENDERSON_BUILDING_ID,
  'B345831577701063A0',
  'B345471572201063A0'
]);

// Centre pair from the CPU pick, plus a band across the mid-look slab.
export const DIGIT1_PROBE_SAMPLES = Object.freeze([
  [0, 0.22],
  [0, 0.36],
  [0, 0.08],
  [0, 0],
  [0, 0.5],
  [-0.14, 0.22],
  [0.14, 0.22],
  [-0.28, 0.36],
  [0.28, 0.36],
  [0, -0.08]
]);

export const DIGIT1_PROBE_EXPERIMENTS = Object.freeze([
  'baseline',
  'hideHenderson',
  'magentaHenderson',
  'hideLandsd'
]);

export function filterDigit1ProbeBuildings(buildings, enabled) {
  const list = buildings || [];
  if (!enabled) return list;
  const allow = new Set(DIGIT1_PROBE_BUILDINGS);
  return list.filter((entry) => {
    const name = String(entry?.name || '');
    const file = String(entry?.file || '');
    for (const id of allow) {
      if (name === id || file.includes(id)) return true;
    }
    return false;
  });
}

export function isDigit1CentreSample(ndc) {
  return !!ndc && ndc[0] === 0 && (ndc[1] === 0.22 || ndc[1] === 0.36);
}

export function parseDigit1ProbeRequest(href) {
  let probe = '';
  let at = null;
  try {
    const params = new URL(href || 'http://local/', 'http://local/').searchParams;
    probe = params.get('probe') || '';
    const raw = params.get('at') || '';
    if (raw) {
      const [x, z, heading] = raw.split(',').map(Number);
      if ([x, z, heading].every(Number.isFinite)) at = { x, z, heading };
    }
  } catch {
    probe = '';
  }
  return { enabled: probe === 'digit1' || probe === '1', at };
}

// Person chase at rest. Matches CameraSystem preset `chase` with pitch 0.09,
// zoom 1, and no speed lag: cameras.js look-up bias 1.55 plus the person's
// cameraTargetOffset.y 1.55.
export function digit1ChasePose(at, {
  pitch = 0.09,
  chaseDistance = 4.3,
  chaseHeight = 1.95,
  lookAhead = 5.2,
  cameraTargetY = 1.55,
  lookUpBias = 1.55
} = {}) {
  const dist = chaseDistance;
  const height = chaseHeight + Math.sin(pitch) * dist * 0.85;
  const horiz = Math.cos(pitch) * dist;
  const heading = at.heading;
  const y = Number.isFinite(at.y) ? at.y : 0;
  return {
    cam: {
      x: at.x - Math.sin(heading) * horiz,
      y: Math.max(0.65, y + height),
      z: at.z - Math.cos(heading) * horiz
    },
    look: {
      x: at.x + Math.sin(heading) * lookAhead,
      y: y + cameraTargetY + lookUpBias,
      z: at.z + Math.cos(heading) * lookAhead
    },
    fov: 56
  };
}

// Chase frustum in the same frame as digit1ChasePose. aspect is width/height.
// ndc x/y are -1..1 when the point is inside that view and in front.
export function projectChaseNdc(pose, point, aspect = 16 / 9) {
  const cam = pose.cam;
  const look = pose.look;
  const zx = cam.x - look.x;
  const zy = cam.y - look.y;
  const zz = cam.z - look.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  const zax = zx / zl;
  const zay = zy / zl;
  const zaz = zz / zl;
  let xx = zaz;
  let xy = 0;
  let xz = -zax;
  const xl = Math.hypot(xx, xz) || 1;
  xx /= xl;
  xz /= xl;
  const yx = zay * xz - zaz * xy;
  const yy = zaz * xx - zax * xz;
  const yz = zax * xy - zay * xx;
  const dx = point.x - cam.x;
  const dy = point.y - cam.y;
  const dz = point.z - cam.z;
  const camX = dx * xx + dy * xy + dz * xz;
  const camY = dx * yx + dy * yy + dz * yz;
  const camZ = dx * zax + dy * zay + dz * zaz;
  const depth = -camZ;
  const tanV = Math.tan(((pose.fov || 56) * Math.PI) / 360);
  const tanH = tanV * aspect;
  if (!(depth > 1e-4)) return { depth, ndcX: Infinity, ndcY: Infinity };
  return {
    depth,
    ndcX: (camX / depth) / tanH,
    ndcY: (camY / depth) / tanV
  };
}

export function ndcToReadPixel(ndcX, ndcY, width, height, origin) {
  const x = clampInt(Math.round(((ndcX + 1) / 2) * (width - 1)), 0, width - 1);
  const v = origin === 'bottom' ? (ndcY + 1) / 2 : (1 - ndcY) / 2;
  const y = clampInt(Math.round(v * (height - 1)), 0, height - 1);
  return { x, y };
}

function clampInt(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export function isPaleRgb(rgb) {
  if (!rgb || rgb.length < 3) return false;
  const [r, g, b] = rgb;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return luma >= 165 && chroma <= 42;
}

export function isMagentaRgb(rgb) {
  if (!rgb || rgb.length < 3) return false;
  const [r, g, b] = rgb;
  return r >= 180 && b >= 180 && g <= 110 && r > g + 50 && b > g + 50;
}

export function isSolidWhiteRgb(rgb) {
  return !!rgb && rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250;
}

// padding: LandsD atlas null fill. photo: a map texel that is not fill.
// solid-white: a map texel that is white, or an untextured material whose
// stand-in is white. untextured: no albedo map.
export function classifyTexel(rgb, mapPresent) {
  if (!mapPresent) {
    if (isSolidWhiteRgb(rgb)) return 'solid-white';
    return 'untextured';
  }
  if (!rgb) return 'unsampled';
  if (isLandsdNullTexel(rgb[0], rgb[1], rgb[2])) return 'padding';
  if (isSolidWhiteRgb(rgb)) return 'solid-white';
  return 'photo';
}

export function channelDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

// gpu-row is the row omit uses (glTF v = 0 = first file row). flipped-row is
// the opposite sample the previous omit used. neither means the GPU albedo
// matches neither CPU sample.
export function rowAgreement(gpuRgb, cpuGpuRow, cpuFlippedRow) {
  const gpu = channelDistance(gpuRgb, cpuGpuRow) <= 28;
  const flipped = channelDistance(gpuRgb, cpuFlippedRow) <= 28;
  if (!gpuRgb) return 'unread';
  if (gpu && !flipped) return 'gpu-row';
  if (flipped && !gpu) return 'flipped-row';
  if (gpu && flipped) return 'both';
  return 'neither';
}

export function formatGpuSurface(gpu) {
  if (!gpu || gpu.miss || gpu.mesh === 'none') return 'none';
  const id = gpu.buildingId || gpu.footprint || '';
  return [gpu.source, gpu.mesh, id, gpu.material, gpu.map ? 'map' : 'no-map', gpu.class]
    .filter((part) => part)
    .join(' ');
}

// The presented frame is the post-graded image. The lit pass is the scene
// before that grade. A sample is pale when the image that would be screenshotted
// is pale, and the lit pass only when that image was not read.
export function shownColor(bucket) {
  if (!bucket) return null;
  if (bucket.presented?.rgb) return bucket.presented;
  if (bucket.lit?.rgb) return bucket.lit;
  return null;
}

function isPaleBucket(bucket) {
  return shownColor(bucket)?.pale === true;
}

function paleSamples(view) {
  return (view?.samples || []).filter((sample) => isPaleBucket(sample.baseline));
}

function hendersonCovers(sample) {
  const id = sample.baseline?.gpu?.buildingId || sample.baseline?.ray?.buildingId || '';
  return id === HENDERSON_BUILDING_ID || sample.magentaHenderson?.magenta === true;
}

function painterOf(sample) {
  if (sample.magentaHenderson?.magenta === true) {
    const gpu = sample.baseline?.gpu || {};
    return formatGpuSurface({
      ...gpu,
      source: gpu.source || 'landsd',
      mesh: gpu.mesh || 'HkGltfBuilding',
      buildingId: HENDERSON_BUILDING_ID
    });
  }
  const behind = sample.hideLandsd?.gpu;
  if (sample.baseline?.gpu?.source === 'landsd' && isPaleBucket(sample.hideLandsd) && behind && !behind.miss) {
    return formatGpuSurface(behind);
  }
  return formatGpuSurface(sample.baseline?.gpu);
}

export function judgeDigit1Premise(report) {
  const view = report?.page;
  if (!view?.samples?.length) {
    return {
      premise: 'INCONCLUSIVE',
      painter: '',
      reason: report?.reason || 'no page samples',
      paleCount: 0
    };
  }
  const pale = paleSamples(view);
  const centres = view.samples.filter((sample) => isDigit1CentreSample(sample.ndc));
  const readable = view.samples.filter((sample) => shownColor(sample.baseline)?.rgb);
  const live = readable.filter((sample) => {
    const rgb = shownColor(sample.baseline).rgb;
    return rgb[0] !== 0 || rgb[1] !== 0 || rgb[2] !== 0;
  });
  if (!readable.length || !live.length) {
    const rays = centres.map((sample) => {
      const ray = sample.baseline?.ray;
      const surface = ray && ray.mesh && ray.mesh !== 'none' ? ray : sample.baseline?.gpu;
      return `${sample.ndc.join(',')}: ${formatGpuSurface(surface)}`;
    }).join(' || ');
    return {
      premise: 'INCONCLUSIVE',
      painter: rays,
      reason: 'The chase was drawn, but the pixel readback failed. The raycast names are not a colour verdict.',
      paleCount: 0
    };
  }
  if (!pale.length) {
    const described = centres.map((sample) => {
      const shown = shownColor(sample.baseline);
      const colour = shown?.rgb ? shown.rgb.join(',') : 'unread';
      return `${sample.ndc.join(',')}: ${formatGpuSurface(sample.baseline?.gpu)} ${colour}`;
    }).join(' || ');
    return {
      premise: 'REJECTED',
      painter: described || 'none',
      reason: 'The Digit1 grid has no pale lit pixel. LandsD padding is not painting these samples.',
      paleCount: 0
    };
  }
  const confirmed = pale.every((sample) => {
    const klass = sample.baseline?.gpu?.class;
    const magenta = sample.magentaHenderson?.magenta === true;
    const cleared = !isPaleBucket(sample.hideHenderson);
    return hendersonCovers(sample) && klass === 'padding' && magenta && cleared;
  });
  if (confirmed) {
    return {
      premise: 'CONFIRMED',
      painter: `${HENDERSON_BUILDING_ID} LandsD atlas padding`,
      reason: 'Pale pixels are Henderson triangles whose GPU albedo is padding. A magenta unlit material replaces them, and hiding that building clears the pale pixel.',
      paleCount: pale.length
    };
  }
  const names = [];
  for (const sample of pale) {
    const name = painterOf(sample);
    if (!names.includes(name)) names.push(name);
  }
  const classes = [...new Set(pale.map((sample) => sample.baseline?.gpu?.class || 'unknown'))];
  return {
    premise: 'REJECTED',
    painter: names.join(' || ') || 'unknown',
    reason: `Pale pixels are not Henderson atlas padding (classes ${classes.join(', ')}). Hiding or recolouring ${HENDERSON_BUILDING_ID} does not account for every pale sample.`,
    paleCount: pale.length
  };
}
