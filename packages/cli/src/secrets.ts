import {
  acquireHomeLock,
  exportSecretsToFiles,
  inspectSecrets,
  openSecretStore,
} from '@monsters/core';
import type { SecretsStatus } from '@monsters/shared';
import type { Io } from './main.ts';

/*
 * `monsters secrets`: where the keys are kept (D-042), and `export` to turn the
 * encrypted secrets back into plain files (before moving the data directory to
 * another machine, or to stop using the keychain).
 */

const REASONS: Record<SecretsStatus['reason'], string> = {
  keychain: 'in use',
  forced: 'chosen with MONSTERS_SECRETS=file',
  unavailable: 'no usable keychain',
  timeout: 'the keychain did not answer in time (locked?)',
  error: 'the keychain gave an invalid key',
  'missing-key':
    'the keychain has no key for this data directory, and some encrypted secrets have no plain copy ' +
    '(save them again, or `monsters secrets reset` if the key is really lost)',
};

function list(names: string[]): string {
  return names.length > 0 ? names.join(', ') : 'none';
}

export async function cmdSecrets(args: string[], home: string, io: Io): Promise<number> {
  const sub = args[0] ?? 'status';
  if (sub === 'status') {
    const report = await inspectSecrets({ home });
    const s = report.status;
    if (s.backend === 'keychain') {
      io.out(`Secrets: encrypted, master key in the system keychain (${s.keychain ?? '?'}).`);
      if (report.masterKey === 'missing') {
        io.out('  No master key yet: it is created at the next start of the core.');
      }
    } else {
      io.out('Secrets: protected files (mode 600), not in the keychain.');
      io.out(`  Why: ${REASONS[s.reason]}${s.detail ? ` (${s.detail})` : ''}.`);
    }
    io.out(`  Data: ${home}`);
    io.out(`  Encrypted: ${list(report.encrypted)}`);
    io.out(`  Plain files: ${list(report.plain)}`);
    if (s.backend === 'keychain' && report.plain.length > 0) {
      io.out('  Plain files are encrypted at the next start of the core.');
    }
    if (s.unreadable.length > 0) {
      io.out(`  Cannot be read now: ${list(s.unreadable)} (save them again from Settings).`);
    }
    return 0;
  }
  if (sub === 'export') {
    // The running core would encrypt the files again: it must be stopped.
    const lock = acquireHomeLock(home);
    try {
      const result = await exportSecretsToFiles({ home });
      io.out(`Exported to plain files (mode 600): ${list(result.exported)}`);
      if (result.failed.length > 0) io.err(`Could not export: ${list(result.failed)}`);
      io.out(
        'Start the core with MONSTERS_SECRETS=file to keep them as files, otherwise they go back into the keychain at the next start.',
      );
      return result.failed.length > 0 ? 1 : 0;
    } finally {
      lock.release();
    }
  }
  if (sub === 'reset') {
    // Explicit step of D-042: the keychain lost the key of this home for good.
    const lock = acquireHomeLock(home);
    try {
      const report = await inspectSecrets({ home });
      if (report.masterKey !== 'missing') {
        io.err(
          report.masterKey === 'present'
            ? 'The keychain has the key of this data directory: nothing to reset.'
            : `No usable keychain (${report.status.reason}): nothing to reset.`,
        );
        return 1;
      }
      const { store } = await openSecretStore({ home, resetKey: true });
      const s = store.status();
      if (store.backend !== 'keychain') {
        io.err(`The keychain did not keep a new key (${s.detail ?? s.reason}): nothing was moved.`);
        return 1;
      }
      io.out('New master key saved in the system keychain.');
      if (s.quarantined?.length) {
        io.out(
          `Set aside in secrets/unreadable-*: ${list(s.quarantined)}. Save them again from Settings.`,
        );
      }
      return 0;
    } finally {
      lock.release();
    }
  }
  io.err(`unknown secrets command: ${sub} (status, export, reset)`);
  return 2;
}
