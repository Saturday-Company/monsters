import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installMonsterCss } from './components/monster/Monster.tsx';
import { installChunkErrorHandler } from './components/shell/ErrorBoundary.tsx';
import { applyDesktopChrome } from './lib/desktop.ts';
import { createRuntime } from './lib/env.ts';
import { initLang } from './lib/i18n.ts';
import { LangRoot } from './LangRoot.tsx';
import { boot, initApp } from './store/app.ts';
import { watchPrefs } from './store/prefs.ts';
// The three typefaces of docs/design.md, served by the app itself (no network): only the
// weights in use, latin and latin-ext.
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource/martian-mono/latin-400.css';
import '@fontsource/martian-mono/latin-ext-400.css';
import '@fontsource/martian-mono/latin-500.css';
import '@fontsource/martian-mono/latin-ext-500.css';
import '@fontsource/doto/latin-900.css';
import '@fontsource/doto/latin-ext-900.css';
import './styles.css';

initLang();
installChunkErrorHandler();
applyDesktopChrome();
watchPrefs();
installMonsterCss();
const runtime = await createRuntime();
initApp(runtime.transport);
void boot();

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <LangRoot>
      <App mock={runtime.mock !== null} />
    </LangRoot>
  </StrictMode>,
);
