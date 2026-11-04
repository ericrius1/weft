// The sprite clouds (skyclouds.ts; Boulder's cloudpuffs.wgsl and cloudlayers.wgsl, by way of Drake's port to loom):
// not a ray-marched volume but each cloud a fixed cluster of soft, lit sprites at fixed places in the world — drifting
// with the wind, never re-forming as the camera moves — composited over the scene in the order the CPU sorted them
// (back to front), premultiplied. Three kinds of sprite:
//   puffs    cumulus, fractus, towering cumulus, cumulonimbus: a soft ball with its rim eaten into lumps, lit as one
//            body — the side toward the light bright, the side away and the flat base in the cloud's own shade (darker
//            the thicker the cloud), a silver rim against the light
//   lenses   lenticular caps and wave clouds: an ellipsoid ray-traced per pixel (the chord through it is the density),
//            smooth and laminar — a cap over a peak frayed at its rim, Boulder's long wave clouds banded
//   virga    rain hanging from a big cloud's base: streaked sheets fading out before the ground
// and the decks (skyclouds_layer.wgsl) drawn per pixel round them (fsLayers: the ones beyond the puffs first, the ones
// in front after): where the view crosses each slab its density, lit as a two-stream slab — far off one sample, close
// up marched through so a deck has tops to fly out over and a base to come up through — clipped by the scene so a ridge
// cuts across a deck and a hillside climbs into one.
// Lit in loom's world: its key light at the sprite's own height (the sun reddening at golden hour, the moon after dusk:
// keyAltAt) through any deck above, the sky's light (the irradiance harmonics) and the air in front (the aerial froxels
// and the low mist), found once per sprite corner, not per pixel. Painted as much as SC.misc.z asks: a firmer silhouette
// and a clearer light/shade split than Boulder's photographic heaps (0), for stylized worlds. The shadow entries draw the
// same sprites and decks, facing the light, into the clouds' shadow target (skyclouds_shadow.wgsl hands it to loom's map).
#include "./env"
#include "weft/fullscreen"

struct Puff {
  pos: vec3f, r: f32,         // centre (virga: the top of the sheet), radius (lens: its bounding radius)
  off: vec3f, base: f32,      // puff: where it sits on its cloud (over the cloud's half-size; y 0 base .. 1 top); lens:
                              // its semi-axes (m); virga: x its length (m). base: the cloud's flat base (world y)
  seed: f32, alpha: f32, dark: f32, kind: f32,   // kind 0 puff, 1 lens (dark: 1 a smooth wave cloud), 2 virga
  ax: vec4f,                  // lens: the cosine and sine of its yaw, its optical depth through the middle; puff: x a flat
                              // top (world y; 0 none: an anvil's); w how much it moves with the wind between listings
}
struct Layer {
  a: vec4f,   // x base (m), y thickness (m), z cover (0..1), w optical depth at full density
  b: vec4f,   // x the noise's tile (m), y lumpy (0 sheet .. 1 cells), z streak (fibres), w a 22-degree halo
  c: vec4f,   // xy the drift so far (m, in its wind's frame, wrapped to the tile), z the band's edge (m along the wind), w its feather (0: no band)
  d: vec4f,   // x drawn after the puffs (1) or before, y its own offset into the noise, z diffuse brightness, w patches (1: the Highland's look)
  e: vec4f,   // xy its wind's direction (unit, x east, z south), z -, w on
}
struct SkyCloudU {
  wind: vec4f,      // xy the wind's direction, zw the drift since the puffs were listed (m)
  misc: vec4f,      // x the eye in a heap (the veil: 0..1), y how overcast overhead, z how painted (0 Boulder's soft heaps .. 1 firm), w night
  tint: vec4f,      // rgb the painted shade's lean (lilac in the day's shadows), w its share
  L: array<Layer, 8>,
}
@group(2) @binding(0) var<uniform> SC: SkyCloudU;
@group(2) @binding(1) var cloudNoise: texture_2d<f32>;
@group(2) @binding(2) var sceneDepth: texture_depth_2d;
@group(2) @binding(3) var<storage, read> puffs: array<Puff>;
#include "./skyclouds_layer"

// (a phone's decks: no fine detail, no relief tap)
override RICH: f32 = 1.0;
// (fsLayers: the decks beyond the puffs (0) or in front of them (1))
override FRONT: f32 = 0.0;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) wp: vec3f,
  @location(2) @interpolate(flat) ii: u32,
  @location(3) vz: f32,
  @location(4) right: vec3f,
  @location(5) up: vec3f,
  @location(6) key: vec3f,      // the key light at the sprite (irradiance: sun or moon, reddened by the air at its height)
  @location(7) amb: vec3f,      // the sky's light on it (as its top sees it; at least a little of the clear sky's)
  @location(8) ap: vec4f,       // the air in front: in-scattered light, transmittance
  @location(9) fog: vec4f,      // the valley's mist in front: its colour, its share
  @location(10) keyD: vec3f,    // what the deck above scatters of the key light on the way down
}

// a sprite where the wind has carried it since it was listed (the list is drawn up every few frames; this between)
fn drifted(i: u32) -> Puff {
  var p = puffs[i];
  p.pos += vec3f(SC.wind.z, 0.0, SC.wind.w) * p.ax.w;
  return p;
}

// the air between the eye and a point: loom's aerial perspective, and its low mist (env.wgsl applyAtmosphere's parts)
fn airTo(p: vec3f, o: ptr<function, VOut>) {
  (*o).ap = aerial(p);
  let f = heightFog(p);
  let dir = normalize(p - frame.camPos);
  let mu = dot(dir, world.sunDir);
  var fc = lighting.fogColor.rgb * 0.9 + lighting.sunRad.rgb * (0.05 * henyeyGreenstein(mu, 0.6) + 0.01) * PI;
  fc += lighting.moonRad.rgb * 0.2;
  (*o).fog = vec4f(fc, f);
}
fn applyAir(col: vec3f, i: VOut) -> vec3f { return mix(col * i.ap.a + i.ap.rgb, i.fog.rgb, i.fog.a); }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = drifted(ii);
  var quad = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = quad[vi];
  let toCam = normalize(frame.camPos - p.pos);
  var r = cross(vec3f(0.0, 1.0, 0.0), toCam);
  r = select(normalize(r), vec3f(1.0, 0.0, 0.0), length(r) < 1e-4);
  var u = cross(toCam, r);
  var o: VOut;
  if (p.kind > 1.5) {
    // virga: a sheet turned to the camera about the vertical, hanging from its top
    u = vec3f(0.0, 1.0, 0.0);
    o.wp = p.pos + r * c.x * p.r + u * (c.y - 1.0) * 0.5 * p.off.x;
  } else if (p.kind > 0.5) {
    o.wp = p.pos + (r * c.x + u * c.y) * p.r;
  } else {
    // (turned by its own fixed angle, so neighbours don't look stamped)
    let a = p.seed * TAU;
    let ca = cos(a); let sa = sin(a);
    let r2 = r * ca + u * sa;
    u = -r * sa + u * ca;
    r = r2;
    o.wp = p.pos + (r * c.x + u * c.y) * p.r;
  }
  // (the quad drawn slid toward the eye, to the near side of its ball, and shrunk to cover the same view: the scene's
  // depth test then keeps every part of the ball in front of a hillside; the shading keeps the plane through its centre)
  let D = length(frame.camPos - p.pos);
  let slide = select(clamp(D - 2.0, 0.0, p.r * select(0.9, 1.0, p.kind > 0.5)), 0.0, p.kind > 1.5);
  o.pos = frame.viewProj * vec4f(frame.camPos + (o.wp - frame.camPos) * ((D - slide) / max(D, 1e-3)), 1.0);
  o.uv = c;
  o.ii = ii;
  o.vz = dot(o.wp - frame.camPos, frame.camFwd);
  o.right = r; o.up = u;
  // the light at the sprite (one value over it: it changes over kilometres, not across a puff)
  let K = keyAltAt(p.pos.y) * PI;
  let over = decksOver(p.pos, -1);
  o.key = K * over.x;
  o.keyD = K * (over.y - over.x);
  let shapeN = select(vec3f(0.0, 1.0, 0.0), normalize(p.off + vec3f(0.0, 0.35, 0.0)), p.kind < 0.5);
  let clearUp = shIrradiance(vec3f(0.0, 1.0, 0.0));
  o.amb = max(shIrradiance(normalize(shapeN + vec3f(0.0, 0.8, 0.0))), clearUp * 0.3);
  airTo(select(p.pos, o.wp, p.kind > 1.5), &o);
  return o;
}

fn noiseAt(uv: vec2f) -> vec4f { return textureSampleLevel(cloudNoise, samp_repeat, uv, 0.0); }

// the scene's distance along the view axis behind a pixel (the sky: far beyond everything)
fn sceneZ(px: vec2f) -> f32 {
  let d = textureLoad(sceneDepth, vec2i(px), 0);
  return select(linearDepth(d), 1e9, d <= 0.0);
}

// the painted shade: the side away from the light leans toward the sky's colour (lilac-grey by day), never mud; under
// the moon the whole cloud pewter (moonlit heaps read as grey shapes against the stars, not as day's white)
fn paintShade(col: vec3f, shadeK: f32) -> vec3f {
  let l = luminance(col);
  let lean = mix(col, SC.tint.rgb * l / max(luminance(SC.tint.rgb), 1e-3), SC.tint.w * shadeK);
  let night = SC.misc.w;
  return mix(lean, vec3f(0.78, 0.84, 1.0) * luminance(lean) * 0.5, night * 0.85);
}

fn puffColor(p: Puff, i: VOut, z: f32) -> vec4f {
  let r = length(i.uv);
  if (r > 1.0) { return vec4f(0.0); }
  let paint = SC.misc.z;
  // its shape: a soft ball, the rim eaten into lumps (the puff's own noise: the same lumps every frame), and the billows
  let s = vec2f(p.seed * 0.41, p.seed * 0.73);
  let n = noiseAt(i.uv * 0.42 + s).r;
  let n2 = noiseAt(i.uv * 0.29 + s.yx * 1.3 + 0.5).b;
  // (always nothing at the sprite's edge: no circle shows round a big one; painted, a firmer edge round each lump)
  let e = r + (n - 0.5) * 0.75 + (n2 - 0.5) * 0.3 * r;
  let m = smoothstep(1.0, mix(0.4, 0.66, paint), e) * (0.82 + 0.18 * n) * smoothstep(1.0, 0.8, r);
  if (m < 0.004) { return vec4f(0.0); }
  // the flat base: nothing below it (and an anvil's flat top: nothing above)
  var baseK = smoothstep(p.base - 1.0, p.base + p.r * 0.3, i.wp.y);
  if (p.ax.x > 0.0) { baseK *= 1.0 - smoothstep(p.ax.x - p.r * 0.25, p.ax.x + 1.0, i.wp.y); }
  // soft against the scene (a hillside going up into a cloud), and fading as the lens comes up to it
  let soft = sat((z - i.vz) / max(p.r * 0.5, 1.0));
  let near = sat((i.vz - p.r * 0.25) / max(p.r * 1.2, 1.0));
  let a = m * 0.96 * baseK * soft * near * p.alpha;
  if (a < 0.002) { return vec4f(0.0); }
  // the normal: the ball's (bumped by its lumps), bent toward where the puff sits on the cloud
  let toCam = normalize(frame.camPos - i.wp);
  let zz = sqrt(max(1.0 - r * r, 0.0));
  let nb = normalize(i.right * (i.uv.x + (n - 0.5) * 0.5) + i.up * (i.uv.y + (n - 0.5) * 0.5) + toCam * (zz + 0.15));
  let shapeN = normalize(p.off + vec3f(0.0, 0.35, 0.0));
  let N = normalize(nb * 0.55 + shapeN);
  let L = world.lightDir;
  // in the cloud's own shade: the far side from the light and toward the base (deeper in a thick cloud)
  let toward = dot(normalize(p.off + vec3f(0.0, 0.05, 0.0)), L);
  let open = sat(0.3 + 0.65 * toward + 0.55 * p.off.y);
  // (and a thick cloud's base, seen from below, gets only what filters down through it)
  let deep = p.dark * (1.0 - sat(p.off.y * 1.6)) * sat(0.25 - N.y * 0.9);
  let shade = mix(0.28, 1.0, open * open) * (1.0 - p.dark * (1.0 - open) * 0.8) * (1.0 - 0.8 * deep);
  var t = sat((dot(N, L) + 0.35) / 1.35);
  // (painted: the terminator drawn as one soft edge — lit, and in shade — not a long photographic roll-off)
  t = mix(t, smoothstep(0.3, 0.62, t) * 0.85 + t * 0.15, paint);
  let lit = t * shade * (0.78 + 0.4 * n2);
  let S = i.key;
  // the sky's light from above, the ground's from below (the base greyer, darker under a big one)
  let amb = i.amb * mix(0.62, 1.1, sat(p.off.y * 1.4 + 0.15)) * (0.88 + 0.2 * n2) * (1.0 - 0.45 * p.dark * (1.0 - sat(p.off.y))) * (1.0 - 0.5 * deep);
  // the silver rim: light through the thin edges against the light (and a cloud against the sun glows through)
  let mu = dot(-toCam, L);
  let rim = henyeyGreenstein(mu, 0.6) * (pow(1.0 - m, 1.2) * 1.6 + 0.22) * (1.0 - 0.6 * p.dark) + henyeyGreenstein(mu, 0.2) * 0.1;
  // (light scattered on through the cloud: its shaded side is grey, never dark; a thick one's gets less of the sky's)
  let ambK = PI * 0.5 * (1.0 - 0.35 * p.dark * (1.0 - open));
  var col = vec3f(0.94) * (S * (lit * (0.42 + 0.1 * p.dark) + 0.07) + i.keyD * 0.2 * shade + amb * ambK) + S * rim * 0.35;
  col = paintShade(col, (1.0 - sat(lit * 2.2)) * paint);
  return vec4f(applyAir(col, i) * a, a);
}

fn lensColor(p: Puff, i: VOut, z: f32) -> vec4f {
  let ro = frame.camPos;
  let rd = normalize(i.wp - ro);
  let cs = p.ax.x; let sn = p.ax.y;
  let q = vec3f(cs * (ro.x - p.pos.x) + sn * (ro.z - p.pos.z), ro.y - p.pos.y, -sn * (ro.x - p.pos.x) + cs * (ro.z - p.pos.z)) / p.off;
  let d = vec3f(cs * rd.x + sn * rd.z, rd.y, -sn * rd.x + cs * rd.z) / p.off;
  let A = dot(d, d); let B = dot(q, d); let C = dot(q, q) - 1.0;
  let disc = B * B - A * C;
  if (disc <= 0.0) { return vec4f(0.0); }
  let sq = sqrt(disc);
  let t1 = (-B + sq) / A;
  if (t1 <= 0.0) { return vec4f(0.0); }
  let ta = max((-B - sq) / A, 0.0);
  let zr = z / max(dot(rd, frame.camFwd), 1e-4);
  let chord = clamp(min(t1, zr) - ta, 0.0, t1 - ta);
  // densest in the middle, laminar bands through it (the stacked look of a wave cloud), faint streaks along it; thin
  // toward the rim (soft), the rim frayed a little
  let mid = q + d * (0.5 * (ta + t1));
  let wob = noiseAt(vec2f(mid.x * 0.16 + p.seed, mid.z * 0.5 + p.seed * 2.0));
  let streak = noiseAt(vec2f(mid.z * 0.08 + p.seed, mid.x * 0.6)).a;
  var core: f32;
  var sigma: f32;
  if (p.dark > 0.5) {
    // (a wave cloud kilometres long, Boulder's: its rim soft, its middle dense, the bands and streaks stronger)
    core = sat(1.0 - dot(mid, mid) * (0.85 + 0.35 * wob.r));
    let band = 0.75 + 0.25 * sin(mid.y * 7.0 + p.seed * 40.0 + wob.b * 3.0);
    sigma = p.ax.z / (2.0 * p.off.y) * (0.03 + 1.4 * pow(core, 1.5)) * band * (0.65 + 0.7 * streak);
  } else {
    // (a cap over a peak, a few hundred metres: its outline frayed, its edge torn by the wind, never a ruled ellipse —
    // and nothing at all at the ellipsoid's own rim)
    let e0 = q + d * ta;
    let em = vec2f(e0.x * p.off.x, e0.z * p.off.z);
    let rag = noiseAt(em / 900.0 + vec2f(p.seed * 3.1, p.seed * 1.7)).r;
    let rag2 = noiseAt(em / 330.0 + vec2f(-p.seed, p.seed)).b;
    core = sat(1.0 - dot(mid, mid) * (0.85 + 0.35 * wob.r) - (rag - 0.45) * 0.8 - (rag2 - 0.5) * 0.3);
    let band = 0.82 + 0.18 * sin(mid.y * 7.0 + p.seed * 40.0 + wob.b * 3.0);
    sigma = p.ax.z / (2.0 * p.off.y) * 1.4 * pow(core, 1.6) * band * (0.85 + 0.3 * streak);
  }
  // (fading as the eye comes up to it, as the puffs do)
  let near = sat((ta - 20.0) / 120.0) + select(0.0, 1.0, ta <= 0.0) * 0.35;
  let a = (1.0 - exp(-sigma * chord)) * p.alpha * sat(near);
  if (a < 0.002) { return vec4f(0.0); }
  // the light: the entry point's normal, the underside in the lens's own shade, silver where it's thin
  let e = q + d * ta;
  let nl = e / p.off;
  let N = normalize(vec3f(cs * nl.x - sn * nl.z, nl.y, sn * nl.x + cs * nl.z));
  let L = world.lightDir;
  // the light through it: from below, what its thickness over the point lets down; from the side and above, what its
  // surface sends back toward the light's side
  let tauV = p.ax.z * sqrt(max(1.0 - e.x * e.x - e.z * e.z, 0.0)) * (0.3 + 0.7 * core);
  let R = 0.113 * tauV / (1.0 + 0.113 * tauV);
  let muS = max(L.y, 0.03);
  let under = max(1.0 - R - exp(-0.28 * tauV / muS), 0.0) * muS * 1.5 * (0.8 + 0.4 * streak);
  var side = sat(dot(N, L) * 0.6 + 0.4);
  side = mix(side, smoothstep(0.35, 0.6, side) * 0.85 + side * 0.15, SC.misc.z);
  let lit = mix(side, under, sat(-N.y * 1.6));
  let S = i.key + i.keyD * 0.5;
  let mu = dot(rd, L);
  let tauMid = sigma * (t1 - ta);
  let rim = henyeyGreenstein(mu, 0.65) * exp(-tauMid * 0.35) * 1.4 + henyeyGreenstein(mu, 0.2) * 0.08;
  var col = vec3f(0.95) * (S * (lit * 0.42 + 0.06) + i.amb * PI * 0.5 * (0.6 + 0.4 * N.y)) + S * rim * 0.35;
  col = paintShade(col, (1.0 - sat(lit * 2.2)) * SC.misc.z);
  return vec4f(applyAir(col, i) * a, a);
}

fn virgaColor(p: Puff, i: VOut, z: f32) -> vec4f {
  let v = (1.0 - i.uv.y) * 0.5;
  let x = i.uv.x;
  let streak = noiseAt(vec2f(v * 0.12 + p.seed, x * 0.55 + p.seed * 3.0)).a;
  let fall = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.25, 1.0, v + (streak - 0.5) * 0.35));
  let soft = sat((z - i.vz) / max(p.r * 0.5, 1.0));
  // (a sheet: seen from underneath it is edge-on, and gone)
  let side = 1.0 - smoothstep(0.55, 0.9, abs(normalize(frame.camPos - i.wp).y));
  let a = pow(max(1.0 - x * x, 0.0), 2.0) * fall * (0.45 + 0.6 * streak) * 0.24 * p.alpha * soft * side;
  if (a < 0.002) { return vec4f(0.0); }
  let L = world.lightDir;
  let toCam = normalize(frame.camPos - i.wp);
  let col = ((i.key + i.keyD * 0.5) * (0.05 + 0.5 * henyeyGreenstein(dot(-toCam, L), 0.55)) + i.amb * PI * 0.45) * (1.0 - 0.45 * p.dark);
  return vec4f(applyAir(col, i) * a, a);
}

// (each draw over the scene writes its light, and its opacity into the cover: what the sun's shafts are cut by)
struct COut { @location(0) c: vec4f, @location(1) t: vec4f }
fn cout(c: vec4f) -> COut { return COut(c, vec4f(0.0, 0.0, 0.0, c.a)); }

@fragment fn fs(i: VOut) -> COut {
  let p = drifted(i.ii);
  let z = sceneZ(i.pos.xy);
  var o: vec4f;
  if (p.kind > 1.5) { o = virgaColor(p, i, z); } else if (p.kind > 0.5) { o = lensColor(p, i, z); } else { o = puffColor(p, i, z); }
  if (o.a < 0.002) { discard; }
  return cout(o);
}

// ------------------------------------------------------------------ the decks (skyclouds_layer.wgsl)
// the pixel's footprint on a deck at a distance along the view: across it, and along it, stretched by how edge-on the
// deck is seen there (against the shell's own up, which tilts toward the camera with the earth's curve)
fn footprint(ro: vec3f, rd: vec3f, t: f32) -> mat2x2f {
  let p = ro + rd * t;
  let px = t * 2.0 / (frame.proj[1][1] * frame.res.y);
  let hd = normalize(rd.xz + vec2f(1e-6, 0.0));
  let up = normalize(vec3f(p.x - ro.x, p.y + EARTH_M, p.z - ro.z));
  return mat2x2f(vec2f(-hd.y, hd.x) * px, hd * (px / max(abs(dot(rd, up)), 0.02)));
}

struct Hit { col: vec3f, a: f32, t: f32 }

// how far past where the view enters a deck it's marched through (m); out to NEAR_FADE the march gives way to the one
// sample the far deck is drawn with
const NEAR_M = 4000.0;
const NEAR_FADE = vec2f(2200.0, 3600.0);
const MARCH = 28;   // (a phone's, RICH 0: half as many)

// a deck's cells in height, close up: a thick cell fills the slab, rounded over its top; a thin one is a lens sat a
// little above the base (k: its share of the deck's depth at h, 0 base .. 1 top; over the column's mean, so the
// column's whole optical depth stays the deck's, as its far sample has it). rag: the base's and the tops' own
// unevenness there — a deck's underside is ragged, never a ruled plane
fn columnShape(h: f32, d: f32, rag: f32) -> f32 {
  let top = 0.42 + 0.58 * saturate(d) - 0.14 * rag;
  let bot = 0.12 * (1.0 - saturate(d * 1.3)) + 0.2 * rag * rag;
  let k = smoothstep(bot, bot + 0.14, h) * (1.0 - smoothstep(top - 0.24, top, h));
  return k / max(top - bot - 0.19, 0.2);
}

// a deck's look at a point in it (or its stretch's middle): diffuse through it (seen from below, below 1) or off its top
// (0), darker where it thickens toward the light (the cells' relief), its silver lining where it's thin, a halo, the
// clear sky's light and the ground's; then the air in front. Per unit of opacity.
fn lightLayer(k: i32, ro: vec3f, rd: vec3f, p: vec3f, dens: f32, below: f32, gx: vec2f, gy: vec2f) -> vec3f {
  let l = SC.L[k];
  let L = world.lightDir;
  let over = decksOver(p, k);
  let S = keyAltAt(p.y) * PI * over.y;
  let tauV = dens * l.a.w;
  let aV = max(1.0 - exp(-tauV), 1e-3);
  let muS = max(L.y, 0.03);
  let R = 0.113 * tauV / (1.0 + 0.113 * tauV);
  let diff = mix(R, max(1.0 - R - exp(-0.28 * tauV / muS), 0.0), below) * muS / PI * l.d.z;
  var relief = 1.0;
  if (RICH > 0.5) {
    let toL = normalize(L.xz + vec2f(1e-5, 0.0));
    let ds = layerDensityG(k, p.xz + toL * l.b.x * mix(0.012, 0.035, l.b.y), gx, gy, false);
    relief = exp(-max(ds - dens, 0.0) * mix(1.5, 3.5, l.b.y)) * (0.8 + 0.4 * smoothstep(0.0, 0.25, dens - ds));
  }
  let mu = dot(rd, L);
  // (under another deck the light is diffuse: no silver)
  let single = (0.7 * henyeyGreenstein(mu, 0.8) + 0.3 * henyeyGreenstein(mu, 0.3)) * exp(-tauV * 0.45) * over.x / max(over.y, 1e-3);
  // (the 22-degree halo, red on the inside)
  var halo = vec3f(0.0);
  if (l.b.w > 0.0) {
    let th = (vec3f(acos(clamp(mu, -1.0, 1.0))) - vec3f(0.3820, 0.3845, 0.3880)) / vec3f(0.010, 0.011, 0.013);
    halo = exp(-th * th) * l.b.w * 0.05 * exp(-tauV);
  }
  let clearUp = shIrradiance(vec3f(0.0, 1.0, 0.0));
  let ground = 0.18 * (S * muS / PI * (1.0 - R) + clearUp);
  let amb = mix(clearUp * (0.35 + 0.65 * R), clearUp * (1.0 - R) * 0.8 + ground * R, below);
  var col = S * (diff / aV * relief + single + halo) + amb * mix(1.0, relief, 0.5);
  col = paintShade(col, (1.0 - relief) * 0.6 * SC.misc.z);
  // (the air in front: under a lid it's in the lid's shade, not glowing as the open sky's sunlit air does)
  let ap = aerial(p);
  return col * ap.a + ap.rgb * (1.0 - 0.8 * SC.misc.y * below);
}

// the deck along [s0, s1] of the view drawn as one sample: its density at the stretch's middle, its opacity by the
// stretch's length to the scene (z: the distance along the view to whatever's there)
fn farLayer(k: i32, ro: vec3f, rd: vec3f, z: f32, s0: f32, s1: f32, inDeck: bool) -> Hit {
  var o: Hit;
  o.a = 0.0;
  let l = SC.L[k];
  if (z <= s0 || s1 <= s0) { return o; }
  // (from inside a deck — fog — what's seen is the deck round the eye: its light and density there, alike for every
  // far ray)
  let mid = 0.5 * (s0 + min(s1, z));
  let tm = select(mid, min(mid, s0 + 150.0), inDeck);
  let p = ro + rd * tm;
  let g = footprint(ro, rd, tm);
  let dens = layerDensityG(k, p.xz, g[0], g[1], RICH > 0.5);
  if (dens <= 0.002) { return o; }
  let sigma = dens * l.a.w / max(l.a.y, 1.0);
  var a = 1.0 - exp(-sigma * clamp(min(s1, z) - s0, 0.0, s1 - s0));
  // (thinning into the haze toward the horizon, where a deck's far edge would turn to a hard line — judged where it
  // turns opaque: a lid seen edge-on far off is grey to the horizon, not thinned to the clear sky by its long chord)
  let dh = max(abs(l.a.x - ro.y), 50.0);
  let tH = sqrt(2.0 * EARTH_M * dh + dh * dh);
  let tv = select(min(s0 + 1.0 / max(sigma, 1e-7), tm), tm, l.d.w > 0.5);
  a *= 1.0 - smoothstep(0.45, 1.0, tv / (tH + 20000.0));
  if (a <= 0.002) { return o; }
  // (from below what comes through, from above what the tops send back: eased across the deck's middle as the eye
  // climbs through it)
  let below = 1.0 - smoothstep(l.a.x + l.a.y * 0.25, l.a.x + l.a.y * 0.75, ro.y);
  o.col = lightLayer(k, ro, rd, p, dens, below, g[0], g[1]) * a;
  o.a = a;
  o.t = s0;
  return o;
}

// the deck close to the eye marched through, its cells in height (columnShape); lit once at the steps' opacity-weighted
// middle, by how deep into the deck that is from its top
fn nearLayer(k: i32, ro: vec3f, rd: vec3f, z: f32, s0: f32, s1: f32) -> Hit {
  var o: Hit;
  o.a = 0.0;
  let l = SC.L[k];
  let e = min(s1, z);
  if (e <= s0) { return o; }
  let len = e - s0;
  var tau = 0.0;
  var wsum = 0.0;
  var pw = vec3f(0.0);
  var dw = 0.0;
  // (steps closer together near the eye: (i / n)^1.7 along the stretch)
  var tPrev = s0;
  let steps = select(MARCH / 2, MARCH, RICH > 0.5);
  for (var i = 1; i <= steps; i++) {
    let u = f32(i) / f32(steps);
    let t1 = s0 + len * pow(u, 1.7);
    let dt = t1 - tPrev;
    let t = 0.5 * (tPrev + t1);
    tPrev = t1;
    let p = ro + rd * t;
    let g = footprint(ro, rd, t);
    let d = layerDensityG(k, p.xz, g[0], g[1], RICH > 0.5);
    if (d <= 0.002) { continue; }
    let h = (p.y + dot(p.xz - ro.xz, p.xz - ro.xz) / (2.0 * EARTH_M) - l.a.x) / max(l.a.y, 1.0);
    // (the rag: a finer octave of the deck's noise than its cells, a few hundred metres across)
    let rs = l.b.x * 0.045;
    let rq = (layerFrame(k, p.xz) - l.c.xy) / rs;
    let rag = textureSampleGrad(cloudNoise, samp_repeat, rq + vec2f(0.71, 0.29), layerFrame(k, g[0]) / rs, layerFrame(k, g[1]) / rs).g;
    let sd = d * l.a.w / max(l.a.y, 1.0) * columnShape(h, d, rag) * dt;
    if (sd <= 0.0) { continue; }
    // (what this step adds to what's seen, behind what's in front of it: where the light is judged)
    let w = exp(-tau) * (1.0 - exp(-sd));
    wsum += w; pw += p * w; dw += d * w;
    tau += sd;
    if (tau > 9.0) { break; }
  }
  if (wsum <= 1e-4) { return o; }
  let a = 1.0 - exp(-tau);
  if (a <= 0.002) { return o; }
  let p = pw / wsum;
  let dens = dw / wsum;
  let below = smoothstep(0.2, 0.85, (l.a.x + l.a.y - p.y - dot(p.xz - ro.xz, p.xz - ro.xz) / (2.0 * EARTH_M)) / max(l.a.y, 1.0));
  let g = footprint(ro, rd, length(p - ro));
  o.col = lightLayer(k, ro, rd, p, dens, below, g[0], g[1]) * a;
  o.a = a;
  o.t = s0;
  return o;
}

// the stretch of the ray inside a deck's slab: (enter, leave), leave < enter when it misses
fn slabSpan(k: i32, ro: vec3f, rd: vec3f) -> vec2f {
  let l = SC.L[k];
  let lo = shellHits(ro, rd, l.a.x);
  let hi = shellHits(ro, rd, l.a.x + l.a.y);
  if (ro.y < l.a.x) {
    // below: in through the base, out through the top
    if (lo.y <= 0.0) { return vec2f(1.0, 0.0); }
    return vec2f(select(lo.x, lo.y, lo.x <= 0.0), select(hi.x, hi.y, hi.x <= 0.0));
  }
  if (ro.y > l.a.x + l.a.y) {
    // above: in through the top (looking down), out through the base or the top again
    if (hi.x <= 0.0) { return vec2f(1.0, 0.0); }
    return vec2f(hi.x, select(hi.y, lo.x, lo.x > 0.0));
  }
  // inside
  return vec2f(0.0, select(hi.y, lo.x, lo.x > 0.0));
}

fn shadeLayer(k: i32, ro: vec3f, rd: vec3f, z: f32) -> Hit {
  var o: Hit;
  o.a = 0.0;
  let l = SC.L[k];
  let span = slabSpan(k, ro, rd);
  let patches = l.d.w > 0.5;
  // (out to 600 km — the Highland's patches to 400)
  if (span.y <= span.x || span.x > select(6.0e5, 4.0e5, patches) || z <= span.x) { return o; }
  let inDeck = ro.y > l.a.x && ro.y < l.a.x + l.a.y;
  // far off, one sample (the Highland's patches always: they stand far over everything)
  let near = select(1.0 - smoothstep(NEAR_FADE.x, NEAR_FADE.y, span.x), 0.0, patches);
  if (near <= 0.0) { return farLayer(k, ro, rd, z, span.x, span.y, inDeck); }
  // close, marched through: its first NEAR_M, and past that (looking along the deck, through a gap) the one sample
  let m = min(span.y, span.x + NEAR_M);
  var o2 = nearLayer(k, ro, rd, z, span.x, m);
  if (span.y > m) {
    let b = farLayer(k, ro, rd, z, m, span.y, false);
    o2.col = o2.col + (1.0 - o2.a) * b.col;
    o2.a = 1.0 - (1.0 - o2.a) * (1.0 - b.a);
  }
  o2.t = span.x;
  if (near >= 1.0) { return o2; }
  let f = farLayer(k, ro, rd, z, span.x, span.y, inDeck);
  o.col = mix(f.col, o2.col, near);
  o.a = mix(f.a, o2.a, near);
  o.t = span.x;
  return o;
}

// the decks drawn on one side of the puffs (FRONT), nearest first over one another
@fragment fn fsLayers(i: FullscreenOut) -> COut {
  let ro = frame.camPos;
  let rd = viewRay(i.uv);
  let z = sceneZ(i.pos.xy) / max(dot(rd, frame.camFwd), 1e-4);
  var hits: array<Hit, 8>;
  var n = 0;
  for (var k = 0; k < MAX_LAYERS; k++) {
    if (!layerOn(k) || SC.L[k].d.x != FRONT) { continue; }
    let h = shadeLayer(k, ro, rd, z);
    if (h.a > 0.002) { hits[n] = h; n++; }
  }
  if (n == 0) { discard; }
  for (var a = 1; a < n; a++) {
    var b = a;
    while (b > 0 && hits[b - 1].t > hits[b].t) { let t = hits[b]; hits[b] = hits[b - 1]; hits[b - 1] = t; b--; }
  }
  var C = vec3f(0.0);
  var T = 1.0;
  for (var k = 0; k < n; k++) { C += T * hits[k].col; T *= 1.0 - hits[k].a; }
  return cout(vec4f(C, 1.0 - T));
}

// the decks in the cloud shadow map (a texel of loom's map plane, the light's ray through it, where it crosses each
// deck; blurred by the sun's disc over the slant up to it: a low sun's deck shadows are soft and glide); alpha the
// lowest deck's top that has any cloud there (what's in a deck — a hillside in a stratus — is under it)
@fragment fn fsLayersShadow(i: FullscreenOut) -> @location(0) vec4f {
  if (world.lightDir.y <= 0.01) { discard; }
  let L = cloudLightDir();
  let A = vec3f(world.cloudMap.x + i.uv.x * world.cloudMap.z, world.cloudMap.w, world.cloudMap.y + i.uv.y * world.cloudMap.z);
  var t = 1.0;
  var low = 6e4;
  for (var k = 0; k < MAX_LAYERS; k++) {
    if (!layerOn(k)) { continue; }
    let l = SC.L[k];
    let mid = l.a.x + l.a.y * 0.5;
    let q = A + L * ((mid - A.y) / L.y);
    let pen = max(mid, 1.0) / L.y * 0.0093;
    let d = layerDensity(k, q.xz, clamp(log2(pen * 512.0 / l.b.x), 1.0, 7.0), false);
    if (d > 0.01) {
      t *= exp(-0.28 * d * l.a.w / L.y);
      low = min(low, l.a.x + l.a.y);
    }
  }
  if (t >= 0.999) { discard; }
  return vec4f(t, t, t, low);
}

// ------------------------------------------------------------------ the inside of a heap round the eye
// (SC.misc.x: how far in, from the puffs round it — clouds.ts insideHeaps): the light in a cloud's body as its puffs
// have it, toward its middle; the puffs themselves fade as the lens comes up to them, so flying into a cumulus goes
// white rather than the cloud vanishing round you
@fragment fn fsVeil(i: FullscreenOut) -> COut {
  let veil = SC.misc.x;
  if (veil <= 0.002) { discard; }
  let ro = frame.camPos;
  let L = world.lightDir;
  let S = keyAltAt(ro.y) * PI;
  let amb = shIrradiance(vec3f(0.0, 1.0, 0.0));
  let rd = viewRay(i.uv);
  // (a cloud's inside is luminous, the light scattered all through it: brighter overhead and toward the light, a
  // glow round the sun)
  let glow = henyeyGreenstein(dot(rd, L), 0.5) * 0.3;
  let up = 0.82 + 0.28 * sat(rd.y * 0.5 + 0.5);
  var col = vec3f(0.95) * (S * (0.3 + 0.3 * sat(L.y + 0.3) + glow) + amb * PI * 0.7) * up;
  // (white more than the light's own colour: the low sun's gold is in the glow toward it, not a tan over everything)
  col = mix(vec3f(luminance(col)), col, 0.45) + S * glow * 0.4;
  col = paintShade(col, 0.25 * SC.misc.z);
  // (inside a heap the eye sees some tens of metres: what's near — the dragon under you — shows through, the rest is
  // white)
  let z = sceneZ(i.pos.xy) / max(dot(rd, frame.camFwd), 1e-4);
  let a = veil * (1.0 - exp(-z / 45.0));
  return cout(vec4f(col * a, a));
}

// ------------------------------------------------------------------ into the cloud shadow map
// The map is loom's (env.wgsl cloudTransmittance): a plane at world.cloudMap.w over world.cloudMap's window, each texel
// the key light's ray through that point of it (cloudLightDir: its elevation held at >= 4 degrees). Each sprite is drawn
// as a disc facing that light, slid along the light onto the plane: the texels whose rays pass through it. Colour: the
// transmittance (multiplied in); alpha the lowest cloud on the ray (min).
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) wp: vec3f,
  @location(2) @interpolate(flat) ii: u32,
}

@vertex fn vsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  let p = drifted(ii);
  var quad = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = quad[vi];
  var o: SOut;
  let L = cloudLightDir();
  let e1 = normalize(cross(L, vec3f(0.0, 0.0, 1.0)) + vec3f(1e-5, 0.0, 0.0));
  let e2 = cross(e1, L);
  // (a puff's shadow is its core; virga casts none)
  let r = select(p.r * 0.8, p.r, p.kind > 0.5);
  o.wp = p.pos + (e1 * c.x + e2 * c.y) * r;
  let hit = o.wp.xz + L.xz / L.y * (world.cloudMap.w - o.wp.y);
  let uv = (hit - world.cloudMap.xy) / world.cloudMap.z;
  o.pos = select(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.5, 1.0), vec4f(2.0, 2.0, 0.5, 1.0), p.kind > 1.5);
  o.uv = c;
  o.ii = ii;
  return o;
}

@fragment fn fsShadow(i: SOut) -> @location(0) vec4f {
  let p = drifted(i.ii);
  var t = 1.0;
  var low = p.pos.y - p.r * 0.6;
  if (p.kind > 0.5) {
    // the lens: the chord along the light's ray through it
    let L = cloudLightDir();
    let cs = p.ax.x; let sn = p.ax.y;
    let q = vec3f(cs * (i.wp.x - p.pos.x) + sn * (i.wp.z - p.pos.z), i.wp.y - p.pos.y, -sn * (i.wp.x - p.pos.x) + cs * (i.wp.z - p.pos.z)) / p.off;
    let d = vec3f(cs * L.x + sn * L.z, L.y, -sn * L.x + cs * L.z) / p.off;
    let A = dot(d, d); let B = dot(q, d); let C = dot(q, q) - 1.0;
    let disc = B * B - A * C;
    if (disc <= 0.0) { discard; }
    let chord = 2.0 * sqrt(disc) / A;
    t = exp(-0.28 * p.ax.z / (2.0 * p.off.y) * chord * p.alpha);
    low = p.pos.y - p.off.y;
  } else {
    let r = length(i.uv);
    if (r > 1.0) { discard; }
    t = 1.0 - smoothstep(1.0, 0.25, r) * 0.82 * p.alpha * select(1.0, 1.15, p.dark > 0.5);
  }
  return vec4f(t, t, t, low);
}
