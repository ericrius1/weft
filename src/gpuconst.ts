// WebGPU flag values (spec constants), usable before we know the browser has WebGPU at all — touching the
// GPUBufferUsage global at module scope would throw a ReferenceError instead of showing a friendly message.
export const BUF = { MAP_READ: 0x1, MAP_WRITE: 0x2, COPY_SRC: 0x4, COPY_DST: 0x8, INDEX: 0x10, VERTEX: 0x20, UNIFORM: 0x40, STORAGE: 0x80, INDIRECT: 0x100, QUERY_RESOLVE: 0x200 } as const;
export const TEX = { COPY_SRC: 0x1, COPY_DST: 0x2, TEXTURE_BINDING: 0x4, STORAGE_BINDING: 0x8, RENDER_ATTACHMENT: 0x10 } as const;
export const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 } as const;
export const MAP = { READ: 0x1, WRITE: 0x2 } as const;
