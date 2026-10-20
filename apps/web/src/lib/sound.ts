import { useCallback } from 'react';
import { usePrefs } from '../store/prefs.ts';

/*
 * The sounds of the instrument (docs/design.md, "Suoni"): synthesized with
 * WebAudio at the moment they play, no files. Off by default (`sounds` in the
 * preferences). Never while the window is hidden or not in the foreground,
 * never more than one every 120 ms, always quiet.
 */

export type SoundName = 'click' | 'lever' | 'question' | 'done';

/** At most one sound in this window of time. */
export const SOUND_THROTTLE_MS = 120;

/** Overall level: these are details, not alerts. */
const MASTER = 0.22;

let ctx: AudioContext | null = null;
let last = -Infinity;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** A short burst of filtered noise: the mechanical part of a click. */
function noiseClick(ac: AudioContext, out: AudioNode, at: number, freq: number, ms: number) {
  const length = Math.max(1, Math.round((ac.sampleRate * ms) / 1000));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.4;
  src.connect(band).connect(out);
  src.start(at);
}

/** A soft sine tone with a quick attack and a short tail. */
function tone(ac: AudioContext, out: AudioNode, at: number, freq: number, ms: number, level = 1) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const env = ac.createGain();
  const end = at + ms / 1000;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(0.5 * level, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(end + 0.02);
}

const VOICES: Record<SoundName, (ac: AudioContext, out: AudioNode, t: number) => void> = {
  // The cap of a key: 8 ms of bright noise.
  click: (ac, out, t) => noiseClick(ac, out, t, 3800, 8),
  // A lever: two lower clicks and a small thump.
  lever: (ac, out, t) => {
    noiseClick(ac, out, t, 1500, 12);
    tone(ac, out, t, 140, 40, 0.8);
    noiseClick(ac, out, t + 0.05, 1100, 14);
  },
  // The light of a question: two short tones.
  question: (ac, out, t) => {
    tone(ac, out, t, 880, 90, 0.6);
    tone(ac, out, t + 0.1, 1320, 110, 0.5);
  },
  // A task done: three flat ascending tones.
  done: (ac, out, t) => {
    tone(ac, out, t, 660, 90, 0.45);
    tone(ac, out, t + 0.09, 830, 90, 0.45);
    tone(ac, out, t + 0.18, 990, 140, 0.45);
  },
};

/** Whether a sound may play now (window in the foreground, throttle). */
export function soundAllowed(now: number, doc: Document = document): boolean {
  if (doc.hidden) return false;
  if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false;
  return now - last >= SOUND_THROTTLE_MS;
}

/**
 * Plays a sound if the user turned the sounds on (`force` skips the
 * preference: the switch that turns them on).
 */
export function playSound(name: SoundName, opts: { force?: boolean } = {}): void {
  if (!opts.force && !usePrefs.getState().sounds) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!soundAllowed(now)) return;
  const ac = audio();
  if (!ac) return;
  last = now;
  try {
    if (ac.state === 'suspended') void ac.resume();
    const master = ac.createGain();
    master.gain.value = MASTER;
    master.connect(ac.destination);
    VOICES[name](ac, master, ac.currentTime + 0.005);
  } catch {
    // audio refused by the browser: the instrument stays silent
  }
}

/** The sound player for components (stable). */
export function useSound(): (name: SoundName) => void {
  return useCallback((name: SoundName) => playSound(name), []);
}
