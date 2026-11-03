// A compile scheduler (kit.compiler) that asks the GPU for one pipeline at a time, a frame apart. WebKit (Safari, and
// every browser on an iPhone or iPad) compiles pipelines one by one on Apple's shader compiler, and while it does its
// GPU process answers nothing else: asked for a hundred at once — a world built while another is already showing — it
// showed no frame for ten seconds on an iPhone 16e. One at a time with a frame between, the frames get through between
// compiles. Nothing is held back (`holding` is false: kit.ready() waits for them all, as it would without it); one
// needed before its turn (read on the spot) is made then.
//   const was = kit.compiler; kit.compiler = new SerialCompiler(kit);
//   ...build...; await kit.ready(); kit.compiler = was;
// (Boulder's util/compile.ts is the fuller one: build, first frame and background phases, parking.)
import type { Kit } from './kit';
import type { AnyPipelineRecord, Compiler } from './passes';

/** a frame's turn: the next animation frame, or a moment where there are none (a worker, a hidden page) */
const nextFrame = () => new Promise<void>((r) => {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(r, 16); return; }
  // (a hidden page gets no animation frames: the timeout keeps the queue moving there)
  const t = setTimeout(r, 100);
  requestAnimationFrame(() => { clearTimeout(t); r(); });
});

export class SerialCompiler implements Compiler {
  readonly holding = false;
  /** compiles asked of the GPU so far, and made on the spot */
  readonly stats = { compiled: 0, now: 0 };
  private chain: Promise<unknown> = Promise.resolve();
  /** `frames`: frames waited between compiles (1) */
  constructor(private kit: Kit, private frames = 1) {}

  compile(_rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown> {
    const p = this.chain.then(async () => { for (let i = 0; i < this.frames; i++) await nextFrame(); }).then(() => { this.stats.compiled++; return start(); });
    this.chain = p.catch(() => {});
    return p;
  }

  now(rec: AnyPipelineRecord) {
    if (rec._pipe) return;
    const m = this.kit.moduleNow(rec.shader);
    if (!m) return;
    this.stats.now++;
    rec.pipeline = rec.makeNow(m);
  }
}
