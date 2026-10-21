import { setVaultLayout, type VaultLayoutId } from '@monsters/shared';
import { onTestFinished } from 'vitest';

/*
 * The layout of the vaults the cores of a test create (D-154). Tests start with Italian vaults
 * (`MONSTERS_VAULT_LAYOUT=it` in vitest.env.ts: they model the vaults that exist); a test of a
 * new English vault calls `vaultLayoutIn('en')`, and `vaultLayoutIn(null)` lets the app's
 * language decide, as a real install does. The layout in use goes back to Italian at the end.
 */
export function vaultLayoutIn(layout: VaultLayoutId | null): void {
  const saved = process.env['MONSTERS_VAULT_LAYOUT'];
  if (layout === null) delete process.env['MONSTERS_VAULT_LAYOUT'];
  else process.env['MONSTERS_VAULT_LAYOUT'] = layout;
  onTestFinished(() => {
    if (saved === undefined) delete process.env['MONSTERS_VAULT_LAYOUT'];
    else process.env['MONSTERS_VAULT_LAYOUT'] = saved;
    setVaultLayout('it');
  });
}
