import { fitGarments } from './garment.js';
export const VBYTES = 24;
/** the bones a rig's arrays hold (HeroRig.bones, .dq): a body's own and what's added after them (Drake's robe adds
 *  its chains' segments: 220). A project's GPU buffer may hold fewer (Boulder's, Seven Havens', San Francisco's:
 *  160): it uploads `dq.subarray(0, nBones * 8)` and checks its own limit (loadHero's `maxBones`) */
export const MAX_BONES = 220;
export const CORE = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'uarmL', 'farmL', 'handL', 'clavR', 'uarmR', 'farmR', 'handR',
    'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR'];
async function gunzipIfNeeded(buf) {
    const b0 = new Uint8Array(buf, 0, 2);
    if (b0[0] === 0x1f && b0[1] === 0x8b)
        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return buf;
}
/** a DNC1 file read (from bytes already fetched): `name` is for its errors */
export async function parseHero(bytes, name = 'hero', maxBones = MAX_BONES) {
    const buf = await gunzipIfNeeded(bytes);
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'DNC1')
        throw new Error(`${name}: not a DNC1 character file`);
    const hl = dv.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl)));
    if (header.stride !== VBYTES)
        throw new Error(`${name}: stride ${header.stride}`);
    const vOff = 12 + hl, vBytes = header.verts * header.stride;
    const verts = new Uint8Array(buf.slice(vOff, vOff + vBytes));
    const idx = new Uint32Array(buf.slice(vOff + vBytes, vOff + vBytes + header.indices * 4));
    const bones = header.bones.map((b) => ({ name: b.name, head: b.head, tail: b.tail, up: b.up }));
    const index = {};
    bones.forEach((b, i) => { index[b.name] = i; });
    for (const n of CORE)
        if (index[n] === undefined)
            throw new Error(`${name}: missing bone ${n}`);
    const chains = {};
    for (const [k, v] of Object.entries(header.chains ?? {}))
        chains[k] = v.map((p) => [p[0], p[1], p[2]]);
    const a = { header, bones, index, chains, verts, idx };
    // (the clothes under the hips hung from the hips' hanging frame: garment.ts)
    fitGarments(a);
    if (bones.length > maxBones)
        throw new Error(`${name}: ${bones.length} bones > ${maxBones}`);
    return a;
}
export async function loadHero(url, o = {}) {
    const r = await (o.fetch ?? fetch)(url);
    if (!r.ok)
        throw new Error(`${url}: ${r.status}`);
    return parseHero(await r.arrayBuffer(), url, o.maxBones ?? MAX_BONES);
}
//# sourceMappingURL=asset.js.map