import { useEffect } from 'react';
import { navigate, type Route } from '../lib/router.ts';
import type { Phase } from '../store/app.ts';
import { onboardingApi } from './api.ts';

let done = false;

/**
 * After login (or a reload), sends the user to the onboarding while the team
 * does not exist yet. Once the core says it is done, it stops asking for the
 * session; an old core without the onboarding API is simply ignored.
 */
export function useOnboardingRedirect(phase: Phase, route: Route): void {
  useEffect(() => {
    if (phase !== 'ready') {
      done = false;
      return;
    }
    if (done || route === 'welcome') return;
    let alive = true;
    onboardingApi
      .state()
      .then((s) => {
        if (s.status === 'done') done = true;
        else if (alive && window.location.hash !== '#/benvenuto') navigate('welcome');
      })
      .catch(() => {
        done = true;
      });
    return () => {
      alive = false;
    };
  }, [phase, route]);
}
