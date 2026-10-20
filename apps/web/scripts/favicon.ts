// Writes public/favicon.svg from the official Titan. Run: node scripts/favicon.ts
import { writeFileSync } from 'node:fs';
import { ROSTER, renderMonster } from '@monsters/monster-kit';

const svg = renderMonster(ROSTER.titan.variants.A, {
  expression: 'happy',
  size: 64,
  title: 'Monsters',
});
writeFileSync(new URL('../public/favicon.svg', import.meta.url), `${svg}\n`);
