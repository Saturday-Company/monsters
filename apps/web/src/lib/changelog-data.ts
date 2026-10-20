import source from '../../../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog.ts';

// The product's changelog, bundled at build time (Vite `?raw`): the web UI served by the core and
// the desktop app carry it, no request needed. The repo root is inside Vite's fs.allow (workspace).

/** The versions of CHANGELOG.md, newest first. */
export const CHANGELOG = parseChangelog(source);
