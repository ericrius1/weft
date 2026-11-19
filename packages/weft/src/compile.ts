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

interface Queued {
  rec: AnyPipelineRecord;
  start: () => Promise<unknown>;
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
  urgent: boolean;
}

export class SerialCompiler implements Compiler {
  readonly holding = false;
  /** compiles asked of the GPU so far, made on the spot, and promoted via urge() */
  readonly stats = { compiled: 0, now: 0, urged: 0 };
  private queue: Queued[] = [];
  private busy = false;
  /** `frames`: frames waited between compiles (1) */
  constructor(private kit: Kit, private frames = 1) {}

  compile(rec: AnyPipelineRecord, start: () => Promise<unknown>): Promise<unknown> {
    return new Promise((ok, fail) => {
      this.queue.push({ rec, start, ok, fail, urgent: false });
      if (!this.busy) void this.pump();
    });
  }

  /** promote a queued pipeline (e.g. a site the camera is approaching) ahead of background compiles */
  urge(rec: AnyPipelineRecord) {
    const i = this.queue.findIndex((q) => q.rec === rec);
    if (i < 0 || this.queue[i].urgent) return;
    const [item] = this.queue.splice(i, 1);
    item.urgent = true;
    const at = this.queue.findIndex((q) => !q.urgent);
    if (at < 0) this.queue.push(item);
    else this.queue.splice(at, 0, item);
    this.stats.urged++;
  }

  private async pump() {
    this.busy = true;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      for (let i = 0; i < this.frames; i++) await nextFrame();
      this.stats.compiled++;
      try {
        item.ok(await item.start());
      } catch (e) {
        item.fail(e);
      }
    }
    this.busy = false;
  }

  now(rec: AnyPipelineRecord) {
    if (rec._pipe) return;
    const m = this.kit.moduleNow(rec.shader);
    if (!m) return;
    this.stats.now++;
    rec.pipeline = rec.makeNow(m);
  }
}
