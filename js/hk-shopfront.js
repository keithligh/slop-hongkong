// Gap-fill shopfront for the two-storey retail belt. LandsD photographs stay on
// the individualised meshes. This atlas is only the procedural podium that
// remains where no mesh occupies the cell: granite plinth, dark shop mouth,
// tile fascia, and a second storey of mouth plus a painted sign. No curtain
// pane runs down to the pavement.
//
// UV matches the shader: u = fract(along * HK_SHOP_BAY / HK_SHOP_BAYS),
// v = y / belt, row 0 at the pavement (DataTexture flipY false).

export const HK_SHOP_BAY = 0.227;
export const HK_SHOP_BAYS = 4;

const PLINTH = [72, 68, 62];
const PIER = [84, 78, 72];
const MOUTH = [26, 22, 20];
const TILE = [176, 104, 58];
const SIGN = [
  [148, 40, 34],
  [28, 96, 70]
];
const COPING = [132, 78, 46];

function fract(value) {
  return value - Math.floor(value);
}

function bayOf(along) {
  const scaled = along * HK_SHOP_BAY;
  let bay = fract(scaled);
  if (bay < 0) bay += 1;
  return { bay, index: Math.floor(scaled) };
}

/**
 * sRGB bytes for one shopfront texel. `along` is metres along the street
 * (world x or z, same choice as the shader). `y` is world height.
 */
export function shopfrontAlbedo(along, y, belt = 8.02) {
  const { bay, index } = bayOf(along);
  const pier = bay < 0.16 || bay > 0.84;
  const sign = SIGN[((index % SIGN.length) + SIGN.length) % SIGN.length];
  if (!(belt > 0) || y >= belt) return COPING;
  if (y < 1.15) return PLINTH;
  if (y < 3.35) return pier ? PIER : MOUTH;
  if (y < 4.55) return TILE;
  if (y < 7.05) return pier ? sign : MOUTH;
  return COPING;
}

export function shopfrontImage(width, height, belt = 8.02) {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const worldY = ((row + 0.5) / height) * belt;
    for (let col = 0; col < width; col++) {
      const u = (col + 0.5) / width;
      const along = (u * HK_SHOP_BAYS) / HK_SHOP_BAY;
      const rgb = shopfrontAlbedo(along, worldY, belt);
      const i = (row * width + col) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return data;
}
