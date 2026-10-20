import { lazy, Suspense } from 'react';
import { OwnerPrompt } from './components/auth/OwnerPrompt.tsx';
import { UnreachableScreen } from './components/auth/UnreachableScreen.tsx';
import { Monster } from './components/monster/Monster.tsx';
import { ErrorBoundary, UpdatePrompt } from './components/shell/ErrorBoundary.tsx';
import { monsterFor } from './lib/monsters.ts';
import { useRoute } from './lib/router.ts';
import { useOnboardingRedirect } from './onboarding/redirect.ts';
import { useApp } from './store/app.ts';

/*
 * Code splitting (M2.8): the first bundle holds React, the store, the API client
 * and the boot screens. The shell and every page come in chunks of their own,
 * fetched while the boot screen is up (`NoticeRoot` starts at once).
 */
const NoticeRoot = lazy(() => import('./components/shell/NoticeRoot.tsx'));
const ReadyShell = lazy(() => import('./components/shell/ReadyShell.tsx'));
const Onboarding = lazy(() =>
  import('./onboarding/Onboarding.tsx').then((m) => ({ default: m.Onboarding })),
);
const AuthScreen = lazy(() =>
  import('./components/auth/AuthScreen.tsx').then((m) => ({ default: m.AuthScreen })),
);

function Loading() {
  return (
    <main className="relative z-[1] flex min-h-full items-center justify-center" aria-busy="true">
      <span className="sr-only">Carico Monsters…</span>
      <Monster genome={monsterFor('titan')} size={96} expression="think" />
    </main>
  );
}

export function App({ mock }: { mock: boolean }) {
  const phase = useApp((s) => s.phase);
  const route = useRoute();
  useOnboardingRedirect(phase, route);

  const signedOut = phase === 'setup' || phase === 'login';
  const loading = <Loading />;
  return (
    <>
      {phase === 'boot' && loading}
      {phase === 'unreachable' && <UnreachableScreen />}
      <ErrorBoundary full>
        <Suspense fallback={phase === 'boot' || phase === 'unreachable' ? null : loading}>
          <NoticeRoot>
            {signedOut && <AuthScreen key={phase} mode={phase} mock={mock} />}
            {phase === 'ready' && route === 'welcome' && <Onboarding />}
            {phase === 'ready' && route !== 'welcome' && <ReadyShell route={route} />}
          </NoticeRoot>
        </Suspense>
      </ErrorBoundary>
      {phase === 'ready' && <OwnerPrompt />}
      <UpdatePrompt />
    </>
  );
}
