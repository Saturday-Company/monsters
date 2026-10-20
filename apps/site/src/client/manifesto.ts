/*
 * The base64 manifesto decodes itself left to right on hover, focus or tap (10 steps of 40ms),
 * and encodes back when left. Reduced motion: it simply switches.
 */
import { fromBase64, revealFrame } from '../lib/manifesto.ts';
import { isKilled, reducedMotion } from './util.ts';

const STEPS = 18;
const FRAME = 40;

export function initManifesto(): void {
  document.querySelectorAll<HTMLElement>('[data-b64]').forEach((el) => {
    const encoded = el.dataset['b64'] ?? '';
    let plain = '';
    try {
      plain = fromBase64(encoded);
    } catch {
      return;
    }
    let step = 0;
    let target = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const paint = () => {
      el.textContent = revealFrame(plain, encoded, step, STEPS);
      el.dataset['state'] = step >= STEPS ? 'plain' : 'encoded';
    };
    const run = (to: number) => {
      target = to;
      if (reducedMotion() || isKilled()) {
        step = to;
        paint();
        return;
      }
      if (timer) return;
      timer = setInterval(() => {
        step += Math.sign(target - step);
        paint();
        if (step === target && timer) {
          clearInterval(timer);
          timer = null;
        }
      }, FRAME);
    };
    el.addEventListener('pointerenter', () => run(STEPS));
    el.addEventListener('pointerleave', () => run(0));
    el.addEventListener('focus', () => run(STEPS));
    el.addEventListener('blur', () => run(0));
    el.addEventListener('click', () => run(target === STEPS ? 0 : STEPS));
  });
}
