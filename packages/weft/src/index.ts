// weft — a thin WebGPU kit: passes over named resources, WGSL as the single definition.
export { createKit, Kit, View, AutoResolution, WebGPUUnavailable, type KitOptions, type HdrState, type FrameTime, type RunEntry } from './kit';
export { defineShader, sourceLine, type Shader, type StructDef, type Vec2, type Vec3, type Vec4, type Mat3, type Mat4 } from './shader';
export { StructView, StructArray, type DeepPartial } from './struct';
export { UniformBuffer, StorageBuffer, Texture, TexView, PingPong, Ref, RunAction, type TextureDesc, type StorageOptions } from './resources';
export { Compute, RenderPass, Draw, RawItem, type ComputeOptions, type RenderPassOptions, type DrawOptions, type BlendMode, type RunItem,
  type PassItem, type DrawEncoder, type Compiler, type PipelineRecord, type AnyPipelineRecord } from './passes';
export { DrawBundle } from './bundle';
export { BindError, SharedGroup, type Bindable, type SamplerName } from './binder';
export { Camera } from './camera';
export { Input, PAD, type Device } from './input';
export * from './math';
export { Painter, Atlas, atlasOf, hex, withAlpha, scaleColor, type Color, type Sprite, type PainterOptions } from './painter';
export { MipChain } from './mipgen';
export { MeshBuilder, packColor, VERTEX_BYTES, type GpuMesh } from './mesh';
export { blueNoise, blueNoiseTexture } from './bluenoise';
export { Capture } from './capture';
export { Fulldome, type FulldomeOptions } from './dome';
export { domeLayout, domeDirection, tileWeights, viewBasis, type DomeLayout, type DomeOptions } from './domelayout';
