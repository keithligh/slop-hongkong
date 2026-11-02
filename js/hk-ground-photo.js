import * as THREE from 'three/webgpu';
import {
  Fn,
  dot,
  dFdx,
  dFdy,
  float,
  floor,
  length,
  max,
  mix,
  pow,
  uniform,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import {
  HK_GROUND_PHOTO_MAG_FULL,
  HK_GROUND_PHOTO_MAG_NONE,
  HK_GROUND_PHOTO_RADIUS,
  HK_GROUND_PHOTO_SHARPEN
} from './hk-ground-tiles-frame.js';

// The LandsD tile photograph as captured, read with a Catmull-Rom filter and a
// one-texel unsharp where the ground is magnified (underfoot, right kerb). The
// only signal is the tile's own texels: nothing is synthesized and no second
// texture is bound.
export function createGroundPhotoMaterial(map, width, height, tuning = {}) {
  const sharpen = uniform(Number.isFinite(tuning.sharpen) ? tuning.sharpen : HK_GROUND_PHOTO_SHARPEN);
  const radius = uniform(Number.isFinite(tuning.radius) ? tuning.radius : HK_GROUND_PHOTO_RADIUS);
  const size = vec2(width, height);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    alphaTest: 0.5,
    depthWrite: true
  });
  material.name = 'hkGroundTilePhoto';
  material.userData.hkGroundPhoto = { width, height, sharpen: sharpen.value, radius: radius.value };

  const sample = (st) => texture(map, st);

  material.colorNode = Fn(() => {
    const st = uv();
    const texelPos = st.mul(size);
    const footprint = max(length(dFdx(texelPos)), length(dFdy(texelPos)));
    const magnified = float(1).sub(smoothstep(HK_GROUND_PHOTO_MAG_FULL, HK_GROUND_PHOTO_MAG_NONE, footprint));

    const p = texelPos.sub(0.5);
    const centre = floor(p).add(0.5);
    const f = p.sub(floor(p));
    const f2 = f.mul(f);
    const f3 = f2.mul(f);
    const w0 = f3.mul(-0.5).add(f2).sub(f.mul(0.5));
    const w1 = f3.mul(1.5).sub(f2.mul(2.5)).add(1);
    const w2 = f3.mul(-1.5).add(f2.mul(2)).add(f.mul(0.5));
    const w3 = f3.mul(0.5).sub(f2.mul(0.5));
    const w12 = w1.add(w2);
    const t0 = centre.sub(1).div(size);
    const t12 = centre.add(w2.div(w12)).div(size);
    const t3 = centre.add(2).div(size);

    const cr = sample(vec2(t12.x, t12.y)).mul(w12.x.mul(w12.y))
      .add(sample(vec2(t0.x, t12.y)).mul(w0.x.mul(w12.y)))
      .add(sample(vec2(t3.x, t12.y)).mul(w3.x.mul(w12.y)))
      .add(sample(vec2(t12.x, t0.y)).mul(w12.x.mul(w0.y)))
      .add(sample(vec2(t12.x, t3.y)).mul(w12.x.mul(w3.y)));
    const crWeight = w12.x.mul(w12.y)
      .add(w0.x.mul(w12.y))
      .add(w3.x.mul(w12.y))
      .add(w12.x.mul(w0.y))
      .add(w12.x.mul(w3.y));
    const reconstructed = cr.div(crWeight);

    const px = vec2(1, 0).div(size).mul(radius);
    const py = vec2(0, 1).div(size).mul(radius);
    const around = sample(st.add(px)).add(sample(st.sub(px))).add(sample(st.add(py))).add(sample(st.sub(py))).mul(0.25);
    const plain = sample(st);
    const toPerceptual = (c) => pow(max(c, vec4(0.0001)), vec4(1 / 2.2));
    const base = toPerceptual(reconstructed);
    const lumaWeights = vec3(0.2126, 0.7152, 0.0722);
    const detail = dot(base.rgb.sub(toPerceptual(around).rgb), lumaWeights);
    const sharp = vec4(pow(max(base.rgb.add(vec3(detail.mul(sharpen))), vec3(0)), vec3(2.2)), 1);
    const photo = mix(plain, sharp, magnified);
    return vec4(photo.rgb, plain.a);
  })();

  return material;
}
