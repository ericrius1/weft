// Native GPU-compressed KTX2 v2.0 texture loader (BC7 desktop, ASTC mobile, ETC2 fallback, plus uncompressed RGBA).
// Zero external dependencies: parses the Khronos KTX2 v2.0 binary container directly, optionally inflates zlib
// supercompression (scheme 3) via native DecompressionStream, and uploads every mip & array layer straight to the GPU
// with exact block-aligned layout (4x lower VRAM and upload bandwidth than RGBA8, zero 2D-canvas decode stalls).
import type { Kit } from './kit';
import { compressedBlock, type Texture } from './resources';
import { inflate } from './assets';
import { loadImageTexture, type ImageTextureOptions } from './images';

/** KTX2 v2.0 12-byte magic identifier */
export const KTX2_MAGIC = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

export type CompressedFamily = 'bc7' | 'astc' | 'etc2';

export interface Ktx2Level {
  width: number;
  height: number;
  depth: number;
  bytesPerRow: number;
  rowsPerImage: number;
  copyWidth: number;
  copyHeight: number;
  data: Uint8Array;
}

export interface Ktx2Image {
  format: GPUTextureFormat;
  vkFormat: number;
  width: number;
  height: number;
  depth: number;
  layers: number;
  faces: number;
  supercompression: number;
  levels: Ktx2Level[];
}

export interface Ktx2TextureOptions {
  label?: string;
  /** keep at most this many pixels a side: skips top mips larger than `max` before GPU allocation/upload */
  max?: number;
}

/** Vulkan VkFormat -> WebGPU GPUTextureFormat mapping for hardware-compressed & common uncompressed formats */
const VK_TO_WGPU: Record<number, GPUTextureFormat> = {
  // Uncompressed
  37: 'rgba8unorm',
  43: 'rgba8unorm-srgb',
  97: 'rgba16float',
  // BC (Desktop D3D/Vulkan/Metal)
  131: 'bc1-rgba-unorm',
  132: 'bc1-rgba-unorm-srgb',
  135: 'bc2-rgba-unorm',
  136: 'bc2-rgba-unorm-srgb',
  137: 'bc3-rgba-unorm',
  138: 'bc3-rgba-unorm-srgb',
  139: 'bc4-r-unorm',
  140: 'bc4-r-snorm',
  141: 'bc5-rg-unorm',
  142: 'bc5-rg-snorm',
  143: 'bc6h-rgb-ufloat',
  144: 'bc6h-rgb-float',
  145: 'bc7-rgba-unorm',
  146: 'bc7-rgba-unorm-srgb',
  // ETC2 (Android / WebGL2 fallback)
  147: 'etc2-rgb8unorm',
  148: 'etc2-rgb8unorm-srgb',
  149: 'etc2-rgb8a1unorm',
  150: 'etc2-rgb8a1unorm-srgb',
  151: 'etc2-rgba8unorm',
  152: 'etc2-rgba8unorm-srgb',
  // ASTC (Apple Silicon / iOS / modern Android)
  157: 'astc-4x4-unorm',
  158: 'astc-4x4-unorm-srgb',
  161: 'astc-5x5-unorm',
  162: 'astc-5x5-unorm-srgb',
  165: 'astc-6x6-unorm',
  166: 'astc-6x6-unorm-srgb',
  171: 'astc-8x8-unorm',
  172: 'astc-8x8-unorm-srgb',
};

const WGPU_TO_VK: Record<string, number> = Object.fromEntries(
  Object.entries(VK_TO_WGPU).map(([vk, wg]) => [wg, Number(vk)]),
);

function readU64LE(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  return hi * 4294967296 + lo;
}

function writeU64LE(dv: DataView, off: number, value: number) {
  const hi = Math.floor(value / 4294967296);
  const lo = value - hi * 4294967296;
  dv.setUint32(off, lo >>> 0, true);
  dv.setUint32(off + 4, hi >>> 0, true);
}

/** Check whether a GPU device supports sampling a given WebGPU texture format. */
export function supportsTextureFormat(kit: Pick<Kit, 'features'>, format: GPUTextureFormat): boolean {
  if (format.startsWith('bc')) return kit.features.has('texture-compression-bc');
  if (format.startsWith('astc')) return kit.features.has('texture-compression-astc');
  if (format.startsWith('etc2') || format.startsWith('eac')) return kit.features.has('texture-compression-etc2');
  return true;
}

/** Pick the highest-quality native compressed texture family supported by this GPU (null if uncompressed only). */
export function bestCompressedFormat(kit: Pick<Kit, 'features'>): CompressedFamily | null {
  if (kit.features.has('texture-compression-bc')) return 'bc7';
  if (kit.features.has('texture-compression-astc')) return 'astc';
  if (kit.features.has('texture-compression-etc2')) return 'etc2';
  return null;
}

/** Parse a KTX2 v2.0 binary container into ready-to-upload mip levels (supports raw scheme 0 and zlib scheme 3). */
export async function parseKtx2(bytes: ArrayBuffer | Uint8Array): Promise<Ktx2Image> {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 80) throw new Error('ktx2: buffer shorter than 80-byte header');
  for (let i = 0; i < 12; i++) {
    if (u8[i] !== KTX2_MAGIC[i]) throw new Error('ktx2: invalid magic identifier');
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const vkFormat = dv.getUint32(12, true);
  const format = VK_TO_WGPU[vkFormat];
  if (!format) throw new Error(`ktx2: unsupported vkFormat ${vkFormat}`);
  const width = dv.getUint32(20, true);
  const height = Math.max(1, dv.getUint32(24, true));
  const depth = Math.max(1, dv.getUint32(28, true));
  const layers = Math.max(1, dv.getUint32(32, true));
  const faces = Math.max(1, dv.getUint32(36, true));
  const levelCount = Math.max(1, dv.getUint32(40, true));
  const supercompression = dv.getUint32(44, true);
  if (supercompression !== 0 && supercompression !== 3) {
    throw new Error(`ktx2: unsupported supercompressionScheme ${supercompression} (expected 0=none or 3=zlib)`);
  }
  const indexEnd = 80 + levelCount * 24;
  if (u8.byteLength < indexEnd) throw new Error('ktx2: truncated level index');

  const blk = compressedBlock(format);
  const levels: Ktx2Level[] = [];
  for (let m = 0; m < levelCount; m++) {
    const off = 80 + m * 24;
    const byteOffset = readU64LE(dv, off);
    const byteLength = readU64LE(dv, off + 8);
    if (byteOffset + byteLength > u8.byteLength) throw new Error(`ktx2: mip ${m} out of bounds`);
    const slice = u8.subarray(byteOffset, byteOffset + byteLength);
    const data = supercompression === 3 ? await inflate(slice) : slice;
    const lw = Math.max(1, width >> m);
    const lh = Math.max(1, height >> m);
    const ld = Math.max(1, depth >> m);
    const blocksX = Math.ceil(lw / blk.bw);
    const blocksY = Math.ceil(lh / blk.bh);
    const bytesPerRow = blocksX * blk.bytes;
    const rowsPerImage = blocksY;
    const copyWidth = blocksX * blk.bw;
    const copyHeight = blocksY * blk.bh;
    const need = bytesPerRow * rowsPerImage * ld * layers * faces;
    if (data.byteLength < need) {
      throw new Error(`ktx2: mip ${m} short data (${data.byteLength} < ${need} bytes for ${lw}x${lh} ${format})`);
    }
    levels.push({ width: lw, height: lh, depth: ld, bytesPerRow, rowsPerImage, copyWidth, copyHeight, data });
  }
  return { format, vkFormat, width, height, depth, layers, faces, supercompression, levels };
}

/** Encode raw mip level buffers into a minimal KTX2 v2.0 container (no Khronos DFD; for internal build tools, packers, and tests). */
export function encodeKtx2(opts: {
  format: GPUTextureFormat;
  width: number;
  height: number;
  depth?: number;
  layers?: number;
  faces?: number;
  levels: Uint8Array[];
  supercompression?: 0 | 3;
  uncompressedByteLengths?: number[];
}): Uint8Array {
  const vkFormat = WGPU_TO_VK[opts.format];
  if (vkFormat === undefined) throw new Error(`ktx2: cannot encode unsupported format ${opts.format}`);
  const levelCount = opts.levels.length;
  if (levelCount < 1) throw new Error('ktx2: at least one mip level required');
  const supercompression = opts.supercompression ?? 0;
  const headerAndIndex = 80 + levelCount * 24;
  // Align first level to 16 bytes (satisfies KTX2 alignment for all 8/16-byte compressed blocks)
  let cursor = Math.ceil(headerAndIndex / 16) * 16;
  const offsets: number[] = [];
  for (let m = 0; m < levelCount; m++) {
    offsets.push(cursor);
    cursor = Math.ceil((cursor + opts.levels[m].byteLength) / 16) * 16;
  }
  const out = new Uint8Array(cursor);
  out.set(KTX2_MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(12, vkFormat, true);
  dv.setUint32(16, 1, true); // typeSize
  dv.setUint32(20, opts.width, true);
  dv.setUint32(24, opts.height, true);
  dv.setUint32(28, opts.depth ?? 0, true);
  dv.setUint32(32, opts.layers && opts.layers > 1 ? opts.layers : 0, true);
  dv.setUint32(36, opts.faces ?? 1, true);
  dv.setUint32(40, levelCount, true);
  dv.setUint32(44, supercompression, true);
  for (let m = 0; m < levelCount; m++) {
    const off = 80 + m * 24;
    const len = opts.levels[m].byteLength;
    const rawLen = opts.uncompressedByteLengths?.[m] ?? len;
    writeU64LE(dv, off, offsets[m]);
    writeU64LE(dv, off + 8, len);
    writeU64LE(dv, off + 16, supercompression === 0 ? len : rawLen);
    out.set(opts.levels[m], offsets[m]);
  }
  return out;
}

/** Upload a KTX2 binary container straight into a GPU Texture (respecting `max` mip trim for mobile VRAM). */
export async function textureFromKtx2(kit: Kit, bytes: ArrayBuffer | Uint8Array, o: Ktx2TextureOptions = {}): Promise<Texture> {
  const img = await parseKtx2(bytes);
  if (img.depth > 1) {
    throw new Error(`ktx2: 3D textures (depth=${img.depth}) are not supported`);
  }
  if (!supportsTextureFormat(kit, img.format)) {
    throw new Error(`ktx2: GPU does not support texture format '${img.format}'`);
  }
  const blk = compressedBlock(img.format);
  let skip = 0;
  const cap = o.max ?? Infinity;
  // WebGPU requires a compressed texture's top mip dimensions to be exact multiples of its block size:
  // only trim to the next mip when that mip stays block-aligned.
  while (skip < img.levels.length - 1 && Math.max(img.levels[skip].width, img.levels[skip].height) > cap) {
    const next = img.levels[skip + 1];
    if (blk.bw > 1 && (next.width % blk.bw !== 0 || next.height % blk.bh !== 0)) break;
    skip++;
  }
  const top = img.levels[skip];
  if (blk.bw > 1 && (top.width % blk.bw !== 0 || top.height % blk.bh !== 0)) {
    throw new Error(`ktx2: top mip ${top.width}x${top.height} is not a multiple of ${img.format} block size ${blk.bw}x${blk.bh}`);
  }
  const mips = img.levels.length - skip;
  const totalLayers = img.layers * img.faces;
  const view: GPUTextureViewDimension | undefined = img.faces === 6
    ? (img.layers > 1 ? 'cube-array' : 'cube')
    : (totalLayers > 1 ? '2d-array' : undefined);
  const tex = kit.texture({
    label: o.label ?? 'ktx2',
    format: img.format,
    size: [top.width, top.height, totalLayers],
    mips,
    view,
    usage: ['sample', 'copy-dst'],
  });
  for (let m = 0; m < mips; m++) {
    const lv = img.levels[skip + m];
    const layerBytes = lv.bytesPerRow * lv.rowsPerImage;
    for (let l = 0; l < totalLayers; l++) {
      const slice = lv.data.subarray(l * layerBytes, (l + 1) * layerBytes);
      kit.queue.writeTexture(
        { texture: tex.gpu, mipLevel: m, origin: [0, 0, l] },
        slice as GPUAllowSharedBufferSource,
        { bytesPerRow: lv.bytesPerRow, rowsPerImage: lv.rowsPerImage },
        [lv.copyWidth, lv.copyHeight, 1],
      );
    }
  }
  return tex;
}

/** Fetch and upload a KTX2 texture from `url`. */
export async function loadKtx2Texture(kit: Kit, url: string, o: Ktx2TextureOptions = {}, init?: RequestInit): Promise<Texture> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return textureFromKtx2(kit, await r.arrayBuffer(), { label: url, ...o });
}

/** Load a native compressed KTX2 variant matching this GPU (`bc7`/`astc`/`etc2`) when provided in `variants`,
 *  falling back seamlessly to `loadImageTexture(kit, fallbackUrl, opts)` if unavailable or unsupported. */
export async function loadCompressedOrImageTexture(
  kit: Kit,
  fallbackUrl: string,
  variants: Partial<Record<CompressedFamily, string>> | null | undefined,
  o: ImageTextureOptions = {},
  init?: RequestInit,
): Promise<Texture> {
  const fam = bestCompressedFormat(kit);
  const ktxUrl = fam ? variants?.[fam] : undefined;
  if (ktxUrl) {
    try {
      const tex = await loadKtx2Texture(kit, ktxUrl, { label: o.label ?? ktxUrl, max: o.max }, init);
      if (o.srgb !== undefined) {
        const isSrgb = tex.format.endsWith('-srgb');
        if (isSrgb !== o.srgb) {
          kit.warnOnce?.(`ktx2:srgb:${ktxUrl}`, `ktx2: ${ktxUrl} format '${tex.format}' disagrees with requested srgb=${o.srgb}`);
        }
      }
      return tex;
    } catch { /* fall back to standard image texture */ }
  }
  return loadImageTexture(kit, fallbackUrl, o, init);
}
