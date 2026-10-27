# Changelog

## 0.1.1

- `Texture.readTexel(x, y)`: one texel back to the CPU without stalling the frame, staging buffers pooled so it can
  run every frame (picking, the depth under a cursor). Depth formats, which WebGPU only copies whole, are read by a
  one-thread compute.
- `Capture`: frames read back from the swapchain — `grab()` for screenshots (headless Chrome doesn't composite a
  WebGPU canvas into page screenshots), `step(dt)` / `blob()` for films rendered at a fixed step.
- `filmSink({ dir })` (from `@ericrius1/weft/vite`): a dev/preview-server middleware that writes a film's posted
  frames, soundtrack and metadata to disk.
- Profiler: a second `kit.run` in a frame resolved its timestamps to an offset WebGPU rejects (not a multiple of 256
  bytes), taking the frame's whole submit down; it now resolves from the 32-query block the range starts in.
- Draws skip `setPipeline` / `setBindGroup` when the pass already has that pipeline or group (consecutive draws with
  one pipeline, the frame group, shared groups). A draw's own `encode` callback resets the tracking.
- The package build (and so `npm publish`) runs from PowerShell and cmd too: `dist` is cleared with Node, not `rm -rf`.

## 0.1.0

- First release: the kit, the Vite plugin, the shader library.
