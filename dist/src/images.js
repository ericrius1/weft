/** an image's bytes decoded as they are (no colour-space conversion, alpha not premultiplied) */
export function bitmapOf(blob) {
    return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
export async function loadBitmap(url, init) {
    const r = await fetch(url, init);
    if (!r.ok)
        throw new Error(`${url}: ${r.status}`);
    return bitmapOf(await r.blob());
}
/** one texture of the bitmaps (more than one: a 2D array, one a layer; all the first one's size) */
export function textureFromBitmaps(kit, bitmaps, o = {}) {
    const w = bitmaps[0].width, h = bitmaps[0].height;
    const make = (label, mw, mh) => kit.texture({
        label, format: o.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', size: [mw, mh, bitmaps.length],
        mips: o.mips ? 'full' : 1, view: bitmaps.length > 1 ? '2d-array' : undefined,
    });
    const t = make(o.label ?? 'image', w, h);
    bitmaps.forEach((b, i) => kit.queue.copyExternalImageToTexture({ source: b }, { texture: t.gpu, origin: [0, 0, i] }, [w, h, 1]));
    if (o.mips)
        generateMips(kit, t);
    let k = 0;
    const cap = o.max ?? Infinity;
    while (o.mips && Math.max(w, h) >> k > cap)
        k++;
    if (!k)
        return t;
    const fit = make(t.label, w >> k, h >> k);
    const enc = kit.device.createCommandEncoder({ label: `${t.label}.fit` });
    for (let i = 0; i < bitmaps.length; i++)
        enc.copyTextureToTexture({ texture: t.gpu, mipLevel: k, origin: [0, 0, i] }, { texture: fit.gpu, origin: [0, 0, i] }, [w >> k, h >> k, 1]);
    kit.queue.submit([enc.finish()]);
    generateMips(kit, fit);
    t.gpu.destroy();
    kit.textures.delete(t);
    return fit;
}
/** an image as a texture (`label` defaults to its URL) */
export async function loadImageTexture(kit, url, o = {}, init) {
    return textureFromBitmaps(kit, [await loadBitmap(url, init)], { label: url, ...o });
}
/** images as one 2D array texture, a layer each */
export async function loadImageArray(kit, urls, o = {}, init) {
    return textureFromBitmaps(kit, await Promise.all(urls.map((u) => loadBitmap(u, init))), o);
}
// (a tiny pipeline made synchronously the first time a format's asked for: the kit's own compile asynchronously, so a
// one-off run right after making one would draw nothing. The common formats are compiled in the background the first
// time any is, so a later first use of another — a texture arriving as you come somewhere — doesn't wait for its
// compile, tens of ms with the page held)
const pipeSets = new WeakMap();
const modules = new WeakMap();
const warmed = new WeakSet();
const pipesOf = (dev) => { let m = pipeSets.get(dev); if (!m)
    pipeSets.set(dev, (m = new Map())); return m; };
const MIP_FORMATS = ['rgba8unorm', 'rgba8unorm-srgb', 'rgba16float', 'bgra8unorm', 'r8unorm', 'rg8unorm'];
function mipDesc(dev, format) {
    let module = modules.get(dev);
    if (!module) {
        module = dev.createShaderModule({
            label: 'weft.mips',
            code: `@group(0) @binding(0) var src: texture_2d<f32>; @group(0) @binding(1) var smp: sampler;
      struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> O { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); var o: O; o.p = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o; }
      @fragment fn fs(i: O) -> @location(0) vec4f { return textureSampleLevel(src, smp, i.uv, 0.0); }`,
        });
        modules.set(dev, module);
    }
    return {
        label: `weft.mips.${format}`, layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    };
}
/** compile the mip pipelines of the common formats in the background (generateMips does it the first time) */
export function warmMips(kit) {
    const dev = kit.device, pipes = pipesOf(dev);
    if (warmed.has(dev))
        return;
    warmed.add(dev);
    for (const f of MIP_FORMATS) {
        if (pipes.has(f))
            continue;
        void dev.createRenderPipelineAsync(mipDesc(dev, f)).then((p) => { if (!pipes.has(f))
            pipes.set(f, p); }, () => { });
    }
}
/** fill every mip of every layer from the one above, box-filtered, now (render passes: the format must be renderable) */
export function generateMips(kit, t) {
    const dev = kit.device, pipes = pipesOf(dev);
    let pipe = pipes.get(t.format);
    if (!pipe)
        pipes.set(t.format, pipe = dev.createRenderPipeline(mipDesc(dev, t.format)));
    warmMips(kit);
    const enc = dev.createCommandEncoder({ label: `${t.label}.mips` });
    for (let l = 0; l < t.layers; l++) {
        for (let m = 1; m < t.mips; m++) {
            const src = t.gpu.createView({ dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
            const dst = t.gpu.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
            const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: kit.samplers.linear }] });
            const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
            pass.setPipeline(pipe);
            pass.setBindGroup(0, bg);
            pass.draw(3);
            pass.end();
        }
    }
    kit.queue.submit([enc.finish()]);
}
/** a small constant texture (layers > 1: a 2D array) */
export function solidTexture(kit, rgba, layers = 1, label = 'solid') {
    const t = kit.texture({ label, format: 'rgba8unorm', size: [4, 4, layers], view: layers > 1 ? '2d-array' : undefined });
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++)
        px.set(rgba, i * 4);
    for (let l = 0; l < layers; l++)
        t.write(px, { layer: l });
    return t;
}
//# sourceMappingURL=images.js.map