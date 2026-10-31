export type Surface = 'grass' | 'rock' | 'gravel' | 'snow' | 'ice' | 'water' | 'wood' | 'sand';
export type V3 = [number, number, number];
export type SceneId = 'lake' | 'river';
export interface AudioState {
    scene: SceneId;
    hour: number;
    nightness: number;
    wind: number;
    camPos: V3;
    camFwd: V3;
    camUp: V3;
    playerPos: V3;
    playerSpeed: number;
    wadeDepth: number;
    heldWater: number;
    waterSpeed: number;
    waterCentroid: V3;
    iceAmount: number;
    bending: boolean;
    distToShore: number;
    waterfallPos: V3 | null;
    riverDist: number;
    riverSpeed: number;
    musicIntensity: number;
    /** 0..1 how far the listener's view is under the water (eased by the renderer; ~0.5 with the lens at the surface) */
    underwater: number;
    /** m the listener is below the water's surface (< 0 above it): the deep is darker and quieter */
    depth?: number;
    /** nearest point on the river centreline (river scene); the rapids are then heard from that direction */
    riverNearest?: V3 | null;
    /** nearest shoreline point (lake); the lapping is then biased towards it */
    shoreNearest?: V3 | null;
    /** a distant creek / falls feeding the lake (lake scene); defaults to a point ~300 m away */
    distantFallsPos?: V3 | null;
    /** air temperature in °C (crickets chirp slower when cold); derived from hour/forest when omitted */
    temperatureC?: number;
    /** player is flying */
    flying?: boolean;
    /** flight speed, m/s */
    flySpeed?: number;
    /** m above the ground under the player */
    altitude?: number;
    /** 0..1 tree density around the listener (forest birds, wind in trees, forest reverb vs open-valley echo) */
    forest?: number;
    /** m, height of the falls at waterfallPos (taller = louder, deeper, wider mist) */
    waterfallHeight?: number;
    /** 0..1 how far into a cloud the listener is (the world softens; an airy hush) */
    cloud?: number;
    /** 0..1 water being drawn out of a cloud (a condensation shimmer), and where it gathers */
    cloudDraw?: number;
    cloudDrawPos?: V3 | null;
    /** something burning: where, how big (0..1, more for a blaze), a dragon's breath of fire (0..1) and where it roars */
    fire?: {
        pos: V3;
        level: number;
        breath: number;
        breathPos: V3;
    } | null;
}
export type AudioEvent = {
    type: 'draw';
    pos: V3;
    amount: number;
} | {
    type: 'splash';
    pos: V3;
    size: number;
    speed: number;
} | {
    type: 'whip';
    pos: V3;
    speed: number;
} | {
    type: 'launch';
    pos: V3;
    amount: number;
} | {
    type: 'freeze';
    pos: V3;
    amount: number;
} | {
    type: 'shatter';
    pos: V3;
    amount: number;
} | {
    type: 'melt';
    pos: V3;
    amount: number;
} | {
    type: 'swirlStart' | 'swirlStop';
    pos: V3;
} | {
    type: 'wave';
    pos: V3;
    size: number;
} | {
    type: 'iceCrack';
    pos: V3;
} | {
    type: 'footstep';
    pos: V3;
    surface: Surface;
    speed: number;
} | {
    type: 'jump';
    pos: V3;
} | {
    type: 'land';
    pos: V3;
    surface: Surface;
    impact: number;
} | {
    type: 'fishJump';
    pos: V3;
} | {
    type: 'birdTakeoff';
    pos: V3;
    count: number;
} | {
    type: 'uiOpen';
} | {
    type: 'uiClose';
} | {
    type: 'uiClick';
} | {
    type: 'sceneChange';
    scene: SceneId;
}
/** a floating paper spirit lantern knocked out by water/ice: papery thump + doused-flame sizzle + an in-key chime; amount 0..1 */
 | {
    type: 'lanternHit';
    pos: V3;
    amount: number;
}
/** a lantern re-lighting and floating back up: quiet airy shimmer */
 | {
    type: 'lanternRise';
    pos: V3;
}
/** take-off / landing whooshes */
 | {
    type: 'flyStart';
} | {
    type: 'flyStop';
}
/** flying low over water: send every ~0.2 s while skimming (spray + rush follow pos while they keep coming) */
 | {
    type: 'skim';
    pos: V3;
    speed: number;
}
/** air bubbles under water (her breath, her strokes, a plunge): a burble at pos, amount 0..1 */
 | {
    type: 'bubbles';
    pos: V3;
    amount: number;
}
/** water drawn out of a cloud: a glassy swell of condensing drops at pos */
 | {
    type: 'cloudDraw';
    pos: V3;
    amount: number;
}
/** a dragon's roar (size 0..1; pitch > 1: a cry of pain, higher and sharper) */
 | {
    type: 'dragonRoar';
    pos: V3;
    size: number;
    pitch?: number;
}
/** one of a dragon's wingbeats (size 0..1: a cruising stroke .. a hover's heavy push) */
 | {
    type: 'wingbeat';
    pos: V3;
    size: number;
}
/** a fire drowned by a mass of water: the crash, a great hiss of steam, the sputter (amount 0..1) */
 | {
    type: 'douse';
    pos: V3;
    amount: number;
}
/** the score: start the next piece now, or rest a while (a scene's cue — logged with the rest, so a film's offline
 *  sound follows it) */
 | {
    type: 'music';
    action: 'start' | 'rest';
    secs?: number;
}
/** a positional animal call from the game's wildlife simulation (unknown species are ignored) */
 | {
    type: 'call';
    species: CallSpecies | (string & {});
    pos: V3;
};
export type CallSpecies = 'junco' | 'raven' | 'eagle' | 'osprey' | 'loon' | 'merganser' | 'goose' | 'elk' | 'elkAlarm' | 'marmot' | 'dipper' | 'owl' | 'thrush' | 'chickadee' | 'kinglet' | 'sparrow' | 'pika';
export interface Volumes {
    master: number;
    music: number;
    ambience: number;
    sfx: number;
}
export interface AudioEngineOptions {
    /** the sounds to pre-render at startup (a game's own list; default: the full Starthread bank) */
    bank?: import('./synth/registry').BankItem[];
    /** render into this context instead of creating a realtime AudioContext (e.g. an OfflineAudioContext for tests) */
    context?: BaseAudioContext;
    /** deterministic seed for all procedural content */
    seed?: number;
    /** 'worker' (default for realtime) renders sounds in a Web Worker; 'sync' renders on the calling thread (offline tests) */
    synth?: 'worker' | 'sync';
    /** skip the master compressor/limiter/soft-clip (measurement only) */
    bypassMaster?: boolean;
    /** spontaneous wildlife calls (default true) */
    wildlife?: boolean;
    /** generative music (default true) */
    music?: boolean;
}
export type DebugCall = 'thrush' | 'chickadee' | 'chickadeeCall' | 'woodpecker' | 'raven' | 'hawk' | 'eagle' | 'loonWail' | 'loonTremolo' | 'loonYodel' | 'owl' | 'wolf' | 'dipper' | 'kingfisher' | 'robin' | 'warbler' | 'chorusFrog' | 'toad' | 'greenFrog' | 'osprey' | 'merganser' | 'goose' | 'elk' | 'elkAlarm' | 'marmot' | 'dipperCall' | 'kinglet' | 'sparrow' | 'junco' | 'pika';
//# sourceMappingURL=types.d.ts.map