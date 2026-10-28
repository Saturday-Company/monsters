import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api.ts';
import { navigate, routeOf, type Route } from '../lib/router.ts';
import type { Phase } from '../store/app.ts';
import { onboardingApi } from './api.ts';

let done = false;

/** The wait before the state is asked again after a read that failed. */
export const RECHECK_MS = 8_000;

/**
 * What the core says about the first start: only a real answer settles it. A failed read is
 * `unknown` (asked again), never "done": a hiccup must not hide the onboarding for the whole
 * session. A core without the onboarding API (404) has nothing to show.
 */
export async function onboardingVerdict(
  read: () => Promise<{ status: string }>,
): Promise<'done' | 'pending' | 'unknown'> {
  try {
    return (await read()).status === 'done' ? 'done' : 'pending';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return 'done';
    return 'unknown';
  }
}

/**
 * After login (or a reload), sends the user to the onboarding while the team
 * does not exist yet. Once the core says it is done, it stops asking for the
 * session; an old core without the onboarding API is simply ignored, and a read that
 * fails is tried again a little later.
 */
export function useOnboardingRedirect(phase: Phase, route: Route): void {
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (phase !== 'ready') {
      done = false;
      return;
    }
    if (done || route === 'welcome') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void onboardingVerdict(() => onboardingApi.state()).then((verdict) => {
      if (verdict === 'done') done = true;
      else if (!alive) return;
      else if (verdict === 'unknown') timer = setTimeout(() => setAgain((n) => n + 1), RECHECK_MS);
      else if (routeOf(window.location.hash) !== 'welcome') navigate('welcome');
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase, route, again]);
}
