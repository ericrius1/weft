// the checks' shared groups: a tint shared as group 1 (where the lab's tonemap keeps its own bindings) and as group 3
// (where weft's painter, mip chain and texture viewer keep theirs)
struct Tint { color: vec4f }
@group(1) @binding(0) var<uniform> envTint: Tint;
@group(3) @binding(0) var<uniform> tint: Tint;
@group(3) @binding(1) var tintTex: texture_2d<f32>;
