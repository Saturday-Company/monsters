import { pick } from '../i18n.ts';

/** What the user reads when a program that starts JavaScript children cannot find Node or npm (D-153). */
const en = {
  nodeMissing:
    'Node.js not found: install Node.js 20 or newer from https://nodejs.org, or point to the Node to use with the MONSTERS_NODE_PATH variable',
  npmMissing:
    'npm not found: install Node.js (with npm) from https://nodejs.org, or point to the Node to use with the MONSTERS_NODE_PATH variable',
};

const it: typeof en = {
  nodeMissing:
    'Node.js non trovato: installa Node.js 20 o più recente da https://nodejs.org, oppure indica il Node da usare con la variabile MONSTERS_NODE_PATH',
  npmMissing:
    'npm non trovato: installa Node.js (con npm) da https://nodejs.org, oppure indica il Node da usare con la variabile MONSTERS_NODE_PATH',
};

export const runtimeStrings = () => pick({ en, it });
