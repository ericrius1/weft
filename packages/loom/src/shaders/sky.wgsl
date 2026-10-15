// The sky (loom; from waterbending): the atmosphere LUT, the sun disc, stars and the Milky Way, the moon with its phase
// and a cloud deck. Drawn as a fullscreen triangle wherever nothing else wrote depth.
#include "./env"
#include "weft/fullscreen"

/** a game's own sky features (constellations, a meteor shower…): its sky shader includes this one and defines them
 *  in skyExtra (this generic sky has none) */
fn rotAround(v: vec3f, k: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

fn starField(d: vec3f) -> vec3f {
  let rd = rotAround(d, world.pole, -world.starRot);
  var acc = vec3f(0.0);
  for (var l = 0; l < 3; l++) {
    let sc = 140.0 * pow(1.9, f32(l));
    let g = rd * sc;
    let cell = floor(g);
    let h = hash13(cell + vec3f(f32(l) * 31.0));
    let thr = 0.94 + f32(l) * 0.015;
    if (h > thr) {
      let jit = vec3f(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 5.1)) - 0.5;
      let c = cell + 0.5 + jit * 0.6;
      let dist = length(g - c);
      let b = pow((h - thr) / (1.0 - thr), 4.0) * 2.5;
      let tw = 0.7 + 0.3 * sin(frame.time * (1.5 + h * 7.0) + h * 100.0);
      let temp = hash13(cell + 9.9);
      let col = mix(vec3f(1.0, 0.72, 0.5), vec3f(0.68, 0.8, 1.0), temp);
      acc += col * b * tw * exp(-dist * dist * 22.0);
    }
  }
  // Milky Way: a dusty band with dark lanes
  let gp = normalize(vec3f(0.45, 0.35, -0.82));
  let bd = dot(rd, gp);
  let band = exp(-bd * bd * 9.0);
  let ang = vec2f(atan2(rd.z, rd.x) * 2.5, rd.y * 5.0);
  let neb = fbm(ang * 1.7, 5);
  let dust = smoothstep(0.45, 0.7, fbm(ang * 3.1 + 9.0, 4));
  acc += mix(vec3f(0.5, 0.55, 0.7), vec3f(0.75, 0.62, 0.5), neb) * band * smoothstep(0.3, 0.75, neb) * (1.0 - dust * 0.8) * 0.06;
  acc += vec3f(0.8, 0.85, 1.0) * band * band * 0.012;
  return acc;
}

// the high deck: env.wgsl's cirrus
fn clouds(d: vec3f, base: vec3f) -> vec4f { return cirrus(d, base); }

@fragment
fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let wp4 = frame.invViewProj * vec4f(i.uv.x * 2.0 - 1.0, 1.0 - i.uv.y * 2.0, 0.0001, 1.0);
  let d = normalize(wp4.xyz / wp4.w - frame.camPos);
  var col = skyRadiance(vec3f(d.x, max(d.y, -0.015), d.z));
  // (no stars through an overcast)
  let night = world.nightness * (1.0 - sat(world.sky.x * 1.4));
  if (night > 0.01 && d.y > -0.05) {
    let vis = clamp(1.0 - luminance(col) * 60.0, 0.0, 1.0) * night;
    col += starField(d) * vis * 0.04;
  }
  // sun disc with limb darkening (only the transmittance-coloured disc; the glow is in the LUT)
  let mu = dot(d, world.sunDir);
  let sunR = 0.0093;
  let ca = cos(sunR);
  if (mu > ca && frame.user.x < 0.5) {
    let r = sqrt(max(0.0, 1.0 - (1.0 - mu) / (1.0 - ca)));
    col += lighting.sunRad.rgb * 2400.0 * (0.4 + 0.6 * pow(r, 0.45));
  }
  // moon with phase and maria
  let mm = dot(d, world.moonDir);
  let moonR = 0.0098;
  if (mm > cos(moonR * 1.2)) {
    let mx = normalize(cross(world.moonDir, vec3f(0.0, 1.0, 0.0)));
    let my = cross(mx, world.moonDir);
    let a = dot(d - world.moonDir, mx) / moonR;
    let b = dot(d - world.moonDir, my) / moonR;
    let rr = a * a + b * b;
    if (rr < 1.0) {
      let z = sqrt(1.0 - rr);
      let nrm = normalize(mx * a + my * b - world.moonDir * z);
      let lit = smoothstep(-0.05, 0.12, dot(nrm, world.sunDir));
      let maria = 0.6 + 0.4 * fbm(vec2f(a, b) * 2.5 + 4.0, 4);
      col = mix(col, vec3f(0.95, 0.93, 0.88) * 0.35 * maria * max(lit, 0.015) + col * 0.4, smoothstep(1.0, 0.9, rr));
    }
  }
  col += vec3f(0.55, 0.65, 0.9) * 0.0025 * pow(max(mm, 0.0), 1800.0) * night;
  let c = clouds(d, col);
  col = mix(col, c.rgb, c.a);
  return vec4f(col, 1.0);
}
