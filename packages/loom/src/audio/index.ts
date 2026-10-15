// Waterbending audio: fully procedural soundscape, bending SFX, foley and adaptive music (Web Audio, no samples).
//   const audio = AudioEngine.create();
//   button.onclick = () => audio.resume();      // first user gesture
//   each frame: audio.update(dt, state);  on gameplay: audio.event({ type: 'splash', pos, size, speed });
export type { Surface, V3, SceneId, AudioState, AudioEvent, Volumes, AudioEngineOptions, DebugCall, CallSpecies } from './types';
export { AudioEngine } from './engine';
