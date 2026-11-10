// What the last pass writes to the canvas, SDR or HDR (kit.hdr says which). Either way the canvas takes colour in its
// colour space with that space's transfer function: sRGB's, which Display P3 shares (extended past 1 and below 0 on an
// HDR canvas). A Display P3 canvas also takes P3 primaries; on an HDR canvas, values past 1 are brighter than SDR
// white, up to the display's headroom. So: tone-map the linear scene to [0, 1] (SDR) or [0, peak] (HDR), then
//   override P3: bool = false;    // constants: { P3: kit.hdr.colorSpace === 'display-p3' ? 1 : 0 }
//   return vec4f(canvasEncode(mapped, P3), 1.0);

// linear → the sRGB transfer, extended to every real value (sign-mirrored below 0, the same curve past 1)
fn srgbEncode(c: vec3f) -> vec3f {
  let a = abs(c);
  let e = select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, a * 12.92, a <= vec3f(0.0031308));
  return sign(c) * e;
}

// linear Rec.709 (sRGB) primaries → linear Display P3 primaries
fn srgbToP3(c: vec3f) -> vec3f {
  return mat3x3f(vec3f(0.8224621, 0.0331941, 0.0170827), vec3f(0.1775380, 0.9668058, 0.0723974), vec3f(0.0, 0.0, 0.9105199)) * c;
}

// a linear Rec.709 colour as the canvas wants it
fn canvasEncode(linear: vec3f, p3: bool) -> vec3f {
  var c = linear;
  if (p3) { c = srgbToP3(c); }
  return srgbEncode(c);
}
