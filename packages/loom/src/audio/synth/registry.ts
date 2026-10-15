// Renderer registry + the bank manifest (what is pre-rendered at startup, in priority order).
import type { Rendered, Rng } from './dsp';
import * as W from './water';
import * as I from './ice';
import * as F from './foley';
import * as N from './nature';
import * as CL from './cloud';
import * as S from './celestial';
import * as CB from './combat';
import * as MO from './motor';
import * as TOY from './toy';
import * as SM from './smash';
import { ir } from './ir';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Renderer = (p: any, rng: Rng, sr: number) => Rendered;

export const RENDERERS: Record<string, Renderer> = {
  // water
  drop: W.drop, slap: W.slap, splash: W.splash, plop: W.plop, bubbleRise: W.bubbleRise, draw: W.draw, whip: W.whip, wave: W.wave,
  lap: W.lap, riverBody: W.riverBody, riverDetail: W.riverDetail, fallsRoar: W.fallsRoar, fallsMist: W.fallsMist,
  underwaterBed: W.underwaterBed, gurgle: W.gurgle, slosh: W.slosh, stream: W.stream, noiseLoop: W.noiseLoop,
  plunge: W.plunge, breath: W.breath, uwKnock: W.uwKnock, uwSwell: W.uwSwell,
  // ice
  freeze: I.freeze, iceCrack: I.iceCrack, shatter: I.shatter, melt: I.melt,
  // foley
  step: F.step, jumpWhoosh: F.jumpWhoosh, bodyThump: F.bodyThump, flurry: F.flurry, ui: F.ui, lanternHit: F.lanternHit, lanternRise: F.lanternRise, flutter: F.flutter, flyWhoosh: F.flyWhoosh,
  // nature
  thrush: N.thrush, chickadee: N.chickadee, chickadeeCall: N.chickadeeCall, woodpecker: N.woodpecker, raven: N.raven, hawk: N.hawk, eagle: N.eagle,
  loonWail: N.loonWail, loonTremolo: N.loonTremolo, loonYodel: N.loonYodel, owl: N.owl, wolf: N.wolf,
  dipper: N.dipper, kingfisher: N.kingfisher, robin: N.robin, warbler: N.warbler,
  chorusFrog: N.chorusFrog, toad: N.toad, greenFrog: N.greenFrog, cricketChirp: N.cricketChirp, cricketBed: N.cricketBed, rustle: N.rustle,
  osprey: N.osprey, merganser: N.merganser, goose: N.goose, elk: N.elk, elkAlarm: N.elkAlarm, marmot: N.marmot, dipperCall: N.dipperCall,
  kinglet: N.kinglet, sparrow: N.sparrow, junco: N.junco, pika: N.pika,
  // clouds
  condense: CL.condense, cloudShimmer: CL.cloudShimmer,
  // Starthread: the score's instruments, the glove's magic
  harp: S.harp, celesta: S.celesta, glass: S.glass, choir: S.choir, pad: S.pad, sub: S.sub,
  zing: S.zing, thrum: S.thrum, rush: S.rush, pop: S.pop, boing: S.boing, shimmer: S.shimmer, rayCall: S.rayCall, motor: S.motor,
  // Stormbreak: guns, explosions, missiles, the jet, the lock tone, plasma, armour, thunder
  cannon: CB.cannon, explosion: CB.explosion, missileLaunch: CB.missileLaunch, jetLoop: CB.jetLoop, lockTone: CB.lockTone, boltZap: CB.boltZap, armourHit: CB.armourHit, thunder: CB.thunder,
  // the toybox band and paint (Fauve)
  marimba: TOY.marimba, pluckBass: TOY.pluckBass, kick: TOY.kick, snap: TOY.snap, shaker: TOY.shaker, squish: TOY.squish,
  // things breaking (Smithereens)
  knock: SM.knock, crumble: SM.crumble, splinter: SM.splinter, clang: SM.clang, rumble: SM.rumble, laserLoop: SM.laserLoop, holeLoop: SM.holeLoop, incoming: SM.incoming,
  // engines and tyres (Rainline)
  engineLoop: MO.engineLoop, squealLoop: MO.squealLoop, sprayLoop: MO.sprayLoop, roofRain: MO.roofRain, gearShift: MO.gearShift, backfire: MO.backfire,
  // reverbs
  ir,
};

export interface BankItem {
  key: string;            // bank key (variants are appended to the list under this key)
  kind: string;           // renderer
  params: object;
  variants: number;
  /** max sample rate for this item (rendered at min(ctx rate, sr)) */
  sr?: number;
}

const surfaces = ['grass', 'rock', 'gravel', 'snow', 'ice', 'water', 'wood', 'sand', 'wade'] as const;
/** the score's pitch collection (D major with the raised fourth: D lydian / B minor), and the notes each voice has */
export const SCALE_PCS = [2, 4, 6, 7, 8, 9, 11, 1];
const inScale = (lo: number, hi: number) => { const r: number[] = []; for (let m = lo; m <= hi; m++) if (SCALE_PCS.includes(((m % 12) + 12) % 12)) r.push(m); return r; };
export const HARP_NOTES = inScale(43, 86);
export const CELESTA_NOTES = inScale(71, 98);
export const CHOIR_NOTES = inScale(50, 76);
export const PAD_NOTES = inScale(45, 71);
export const SUB_NOTES = inScale(26, 45);
export const GLASS_NOTES = inScale(62, 86);

/** startup bank, in priority order */
export const BANK: BankItem[] = [
  // realtime noise for wind etc. (needed first)
  { key: 'noise.pink', kind: 'noiseLoop', params: { color: 'pink' }, variants: 1, sr: 48000 },
  { key: 'noise.brown', kind: 'noiseLoop', params: { color: 'brown' }, variants: 1, sr: 16000 },
  { key: 'noise.white', kind: 'noiseLoop', params: { color: 'white', secs: 4 }, variants: 1, sr: 48000 },
  // reverbs
  { key: 'ir.valley', kind: 'ir', params: { kind: 'valley' }, variants: 1 },
  { key: 'ir.forest', kind: 'ir', params: { kind: 'forest' }, variants: 1 },
  { key: 'ir.echoLake', kind: 'ir', params: { kind: 'echoLake' }, variants: 1 }, // convolver IRs must match the context rate
  { key: 'ir.echoRiver', kind: 'ir', params: { kind: 'echoRiver' }, variants: 1 },
  { key: 'ir.hall', kind: 'ir', params: { kind: 'hall' }, variants: 1 },
  // splashes (diving in, landing in the sea)
  { key: 'splash.drop', kind: 'splash', params: { size: 0.0 }, variants: 4 },
  { key: 'splash.s', kind: 'splash', params: { size: 0.22 }, variants: 3 },
  { key: 'splash.m', kind: 'splash', params: { size: 0.48 }, variants: 3 },
  { key: 'splash.l', kind: 'splash', params: { size: 0.75 }, variants: 3 },
  { key: 'slap', kind: 'slap', params: { size: 0.5 }, variants: 3 },
  { key: 'drop', kind: 'drop', params: {}, variants: 6 },
  // the glove's magic
  { key: 'mg.zing', kind: 'zing', params: {}, variants: 3, sr: 44100 },
  { key: 'mg.thrum', kind: 'thrum', params: { midi: 38 }, variants: 2, sr: 32000 },
  { key: 'mg.thrumHi', kind: 'thrum', params: { midi: 45 }, variants: 2, sr: 32000 },
  { key: 'mg.zip', kind: 'rush', params: { up: 1, dur: 0.8 }, variants: 2, sr: 32000 },
  { key: 'mg.fling', kind: 'rush', params: { up: 1, dur: 1.3 }, variants: 2, sr: 32000 },
  { key: 'mg.pop', kind: 'pop', params: {}, variants: 3, sr: 44100 },
  { key: 'mg.boing', kind: 'boing', params: {}, variants: 2, sr: 44100 },
  { key: 'mg.shimmer', kind: 'shimmer', params: {}, variants: 2, sr: 44100 },
  { key: 'mg.home', kind: 'shimmer', params: { dur: 3.5, root: 81 }, variants: 2, sr: 44100 },
  { key: 'mg.ray', kind: 'rayCall', params: { pitch: 1 }, variants: 2, sr: 22050 },
  { key: 'mg.rayHi', kind: 'rayCall', params: { pitch: 1.35 }, variants: 2, sr: 22050 },
  { key: 'loop.motor', kind: 'motor', params: {}, variants: 1, sr: 22050 },
  // footsteps
  ...surfaces.map((s) => ({ key: `step.${s}`, kind: 'step', params: { surface: s }, variants: 6 })),
  { key: 'jump', kind: 'jumpWhoosh', params: {}, variants: 3, sr: 32000 },
  { key: 'thump', kind: 'bodyThump', params: { heavy: 0.6 }, variants: 3, sr: 24000 },
  { key: 'plop', kind: 'plop', params: { size: 0.35 }, variants: 3 },
  { key: 'bubbles', kind: 'bubbleRise', params: {}, variants: 2, sr: 24000 },
  { key: 'bubbles.s', kind: 'bubbleRise', params: { n: 14, dur: 0.6 }, variants: 3, sr: 24000 },
  { key: 'uw.plunge', kind: 'plunge', params: {}, variants: 2, sr: 32000 },
  { key: 'uw.breath', kind: 'breath', params: {}, variants: 3, sr: 32000 },
  { key: 'ui.open', kind: 'ui', params: { kind: 'open' }, variants: 1 },
  { key: 'ui.close', kind: 'ui', params: { kind: 'close' }, variants: 1 },
  { key: 'ui.click', kind: 'ui', params: { kind: 'click' }, variants: 3 },
  // flight
  { key: 'loop.flutter', kind: 'flutter', params: {}, variants: 1, sr: 24000 },
  { key: 'fly.up', kind: 'flyWhoosh', params: { dir: 'up' }, variants: 2, sr: 32000 },
  { key: 'fly.down', kind: 'flyWhoosh', params: { dir: 'down' }, variants: 2, sr: 32000 },
  // ambience loops
  { key: 'loop.lapCalm', kind: 'lap', params: { choppy: 0 }, variants: 1, sr: 32000 },
  { key: 'loop.lapChoppy', kind: 'lap', params: { choppy: 1 }, variants: 1, sr: 32000 },
  { key: 'loop.rustle', kind: 'rustle', params: {}, variants: 1, sr: 32000 },
  { key: 'loop.riverBody', kind: 'riverBody', params: {}, variants: 1, sr: 24000 },
  { key: 'loop.riverDetail', kind: 'riverDetail', params: {}, variants: 1, sr: 44100 },
  { key: 'loop.fallsRoar', kind: 'fallsRoar', params: {}, variants: 1, sr: 32000 },
  { key: 'loop.fallsMist', kind: 'fallsMist', params: {}, variants: 1, sr: 44100 },
  { key: 'loop.underwater', kind: 'underwaterBed', params: {}, variants: 1, sr: 12000 },
  { key: 'loop.uwSwell', kind: 'uwSwell', params: {}, variants: 1, sr: 16000 },
  { key: 'uw.knock', kind: 'uwKnock', params: {}, variants: 4, sr: 16000 },
  { key: 'loop.crickets', kind: 'cricketBed', params: {}, variants: 1, sr: 16000 },
  { key: 'cricket.field', kind: 'cricketChirp', params: { kind: 'field' }, variants: 4, sr: 16000 },
  { key: 'cricket.tree', kind: 'cricketChirp', params: { kind: 'tree' }, variants: 3, sr: 16000 },
  // the score (last: it starts after the world's sounds are in)
  ...HARP_NOTES.map((m) => ({ key: `harp.${m}`, kind: 'harp', params: { midi: m }, variants: 1, sr: 24000 })),
  ...CELESTA_NOTES.map((m) => ({ key: `celesta.${m}`, kind: 'celesta', params: { midi: m }, variants: 1, sr: 32000 })),
  ...PAD_NOTES.map((m) => ({ key: `pad.${m}`, kind: 'pad', params: { midi: m, dur: 8 }, variants: 1, sr: 12000 })),
  ...SUB_NOTES.map((m) => ({ key: `sub.${m}`, kind: 'sub', params: { midi: m, dur: 7 }, variants: 1, sr: 4000 })),
  ...CHOIR_NOTES.map((m) => ({ key: `choir.${m}`, kind: 'choir', params: { midi: m, dur: 7 }, variants: 1, sr: 16000 })),
  ...GLASS_NOTES.map((m) => ({ key: `glass.${m}`, kind: 'glass', params: { midi: m, dur: 6 }, variants: 1, sr: 22050 })),
];

/** sample-rate ceilings for on-demand renders */
export const LIVE_SR: Record<string, number> = {
  thrush: 32000, chickadee: 32000, chickadeeCall: 32000, woodpecker: 24000, raven: 16000, hawk: 24000, eagle: 24000,
  loonWail: 16000, loonTremolo: 16000, loonYodel: 16000, owl: 12000, wolf: 12000, dipper: 32000, kingfisher: 24000,
  robin: 24000, warbler: 32000, chorusFrog: 16000, toad: 16000, greenFrog: 12000, flurry: 24000,
  osprey: 24000, merganser: 16000, goose: 16000, elk: 16000, elkAlarm: 16000, marmot: 24000, dipperCall: 32000, kinglet: 32000, sparrow: 32000, junco: 32000, pika: 24000,
};
