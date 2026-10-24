// Mid-band energy of a facade crop. A 1px box blur minus a 4px box blur
// keeps shop-sign edges and drops both single-pixel alias dirt and flat fill.
// Higher energy is more resolved detail, not a brighter frame.

export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function boxBlur(src, width, height, radius) {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / span;
      const leave = x - radius;
      const enter = x + radius + 1;
      sum -= src[y * width + Math.min(width - 1, Math.max(0, leave))];
      sum += src[y * width + Math.min(width - 1, Math.max(0, enter))];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      const leave = y - radius;
      const enter = y + radius + 1;
      sum -= tmp[Math.min(height - 1, Math.max(0, leave)) * width + x];
      sum += tmp[Math.min(height - 1, Math.max(0, enter)) * width + x];
    }
  }
  return out;
}

// rect is inclusive-exclusive pixel bounds in the PNG (top-left origin).
export function facadeEnergy(image, rect) {
  const { width, height, data } = image;
  const x0 = Math.max(0, rect?.x0 ?? 0);
  const y0 = Math.max(0, rect?.y0 ?? 0);
  const x1 = Math.min(width, rect?.x1 ?? width);
  const y1 = Math.min(height, rect?.y1 ?? height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 8) throw new Error(`facade crop ${w}x${h}`);
  const luma = new Float64Array(w * h);
  let mean = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4;
      const yv = luminance(data[i], data[i + 1], data[i + 2]);
      luma[y * w + x] = yv;
      mean += yv;
    }
  }
  mean /= luma.length;
  const fine = boxBlur(luma, w, h, 1);
  const coarse = boxBlur(luma, w, h, 4);
  let energy = 0;
  for (let i = 0; i < luma.length; i++) {
    const band = fine[i] - coarse[i];
    energy += band * band;
  }
  return {
    width: w,
    height: h,
    mean,
    energy: energy / luma.length
  };
}
