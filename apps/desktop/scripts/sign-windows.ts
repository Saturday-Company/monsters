/*
 * Windows code signing from Linux with jsign (D-040, D-046): electron-builder calls `signWithJsign`
 * (its `win.signtoolOptions.sign` hook) for every executable it signs: the app, the uninstaller,
 * the installer. The mode comes from the environment, so the same build config makes unsigned,
 * test-signed and really signed packages:
 *
 *   MONSTERS_WIN_SIGN=off (default)  no signature (the alpha, D-040: "Windows ha protetto il PC")
 *   MONSTERS_WIN_SIGN=test           self-signed test certificate of apps/desktop/.signing/
 *                                    (`bash apps/desktop/scripts/setup-signing.sh --test-cert`)
 *   MONSTERS_WIN_SIGN=jsign          the real certificate, any keystore jsign supports:
 *     MONSTERS_JSIGN_STORETYPE   e.g. PKCS12, PKCS11 (Certum SimplySign), …
 *     MONSTERS_JSIGN_KEYSTORE    keystore file or PKCS#11 configuration
 *     MONSTERS_JSIGN_STOREPASS   password or PIN (passed to jsign as env:, never on the command line)
 *     MONSTERS_JSIGN_ALIAS       key alias (optional)
 *     MONSTERS_JSIGN_CERTFILE    certificate chain file (optional)
 *     MONSTERS_JSIGN_TSAURL      timestamp server (default http://time.certum.pl)
 *     MONSTERS_WIN_PUBLISHER_NAME  the certificate's CN: written into the update metadata, so the
 *                                  updater accepts only installers signed by the same publisher
 *
 * Tools: MONSTERS_JSIGN_JAR and MONSTERS_JAVA, default the ones of setup-signing.sh under
 * ~/.local/opt/monsters-signing (or `java` on the PATH).
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const APP = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const JSIGN_VERSION = '7.5';
export const TEST_SIGNING_DIR = join(APP, '.signing');

export type WinSignMode = 'off' | 'test' | 'jsign';

export function winSignMode(env: NodeJS.ProcessEnv = process.env): WinSignMode {
  const mode = (env['MONSTERS_WIN_SIGN'] ?? 'off').trim().toLowerCase();
  if (mode === '' || mode === 'off' || mode === '0' || mode === 'none') return 'off';
  if (mode === 'test' || mode === 'jsign') return mode;
  throw new Error(`MONSTERS_WIN_SIGN=${mode}: use off, test or jsign`);
}

/** The jsign options for a mode (without the file to sign). Throws when something is missing. */
export function jsignOptions(
  mode: Exclude<WinSignMode, 'off'>,
  env: NodeJS.ProcessEnv = process.env,
  testDir = TEST_SIGNING_DIR,
): { args: string[]; env: Record<string, string> } {
  const common = ['--alg', 'SHA-256', '--name', 'Monsters', '--url', 'https://saturdaycompany.it'];
  if (mode === 'test') {
    const keystore = join(testDir, 'test.p12');
    if (!existsSync(keystore)) {
      throw new Error(
        `no test certificate in ${testDir}: run "bash apps/desktop/scripts/setup-signing.sh --test-cert"`,
      );
    }
    return {
      args: [
        '--storetype',
        'PKCS12',
        '--keystore',
        keystore,
        '--storepass',
        `file:${join(testDir, 'test.pass')}`,
        ...common,
      ],
      env: {},
    };
  }
  const need = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`MONSTERS_WIN_SIGN=jsign needs ${name}`);
    return value;
  };
  const args = [
    '--storetype',
    need('MONSTERS_JSIGN_STORETYPE'),
    '--keystore',
    need('MONSTERS_JSIGN_KEYSTORE'),
    '--storepass',
    'env:MONSTERS_JSIGN_STOREPASS',
    '--tsaurl',
    env['MONSTERS_JSIGN_TSAURL'] || 'http://time.certum.pl',
    '--tsmode',
    'RFC3161',
    ...common,
  ];
  need('MONSTERS_JSIGN_STOREPASS');
  if (env['MONSTERS_JSIGN_ALIAS']) args.push('--alias', env['MONSTERS_JSIGN_ALIAS']);
  if (env['MONSTERS_JSIGN_CERTFILE']) args.push('--certfile', env['MONSTERS_JSIGN_CERTFILE']);
  return { args, env: { MONSTERS_JSIGN_STOREPASS: need('MONSTERS_JSIGN_STOREPASS') } };
}

export function jsignTools(env: NodeJS.ProcessEnv = process.env): { java: string; jar: string } {
  const base =
    env['MONSTERS_SIGNING_TOOLS'] ?? join(homedir(), '.local', 'opt', 'monsters-signing');
  const jar = env['MONSTERS_JSIGN_JAR'] ?? join(base, `jsign-${JSIGN_VERSION}.jar`);
  const localJava = join(base, 'jre', 'bin', 'java');
  const java = env['MONSTERS_JAVA'] ?? (existsSync(localJava) ? localJava : 'java');
  if (!existsSync(jar)) {
    throw new Error(`jsign not found in ${jar}: run "bash apps/desktop/scripts/setup-signing.sh"`);
  }
  return { java, jar };
}

/** The test certificate's subject CN (for the publisher name of test builds). */
export function testCertificateName(testDir = TEST_SIGNING_DIR): string | null {
  try {
    const out = execFileSync(
      'openssl',
      [
        'x509',
        '-noout',
        '-subject',
        '-nameopt',
        'multiline',
        '-in',
        join(testDir, 'test-signer.crt'),
      ],
      { encoding: 'utf8' },
    );
    return /commonName\s*=\s*(.+)/.exec(out)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** What electron-builder passes to the hook (CustomWindowsSignTaskConfiguration, subset). */
export interface SignTask {
  path: string;
  hash?: string;
}

/** electron-builder's custom sign hook. */
export async function signWithJsign(task: SignTask): Promise<void> {
  const mode = winSignMode();
  if (mode === 'off') return;
  if (task.hash && task.hash !== 'sha256') return; // one SHA-256 signature is enough (Windows 10+)
  const { args, env } = jsignOptions(mode);
  const { java, jar } = jsignTools();
  await promisify(execFile)(java, ['-jar', jar, ...args, task.path], {
    env: { ...process.env, ...env },
  });
  process.stderr.write(`  • signed (${mode}) ${task.path.split(/[\\/]/).pop()}\n`);
}

/**
 * Reads the signature back with osslsigncode (when installed). `caFile`: a certificate to trust
 * for the check (the test certificate), so that "verified" means signed by it and intact; without
 * it the chain of a self-signed certificate is never trusted and only the digest is compared.
 */
export function verifyWithOsslsigncode(
  file: string,
  caFile?: string,
): { signer: string | null; intact: boolean; verified: boolean } {
  const args = ['verify', ...(caFile ? ['-CAfile', caFile] : []), '-in', file];
  try {
    const out = execFileSync('osslsigncode', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseOsslsigncode(out);
  } catch (err) {
    return parseOsslsigncode(`${(err as { stdout?: string }).stdout ?? ''}`);
  }
}

export function parseOsslsigncode(out: string): {
  signer: string | null;
  intact: boolean;
  verified: boolean;
} {
  const signer = /Signer #0:\s*\n\s*Subject:\s*(.+)/.exec(out)?.[1]?.trim() ?? null;
  const current = /Current message digest\s*:\s*([0-9A-F]+)/i.exec(out)?.[1];
  const calculated = /Calculated message digest\s*:\s*([0-9A-F]+)/i.exec(out)?.[1];
  const intact = !!current && current === calculated;
  const verified = intact && /Signature verification: ok/.test(out) && /^Succeeded$/m.test(out);
  return { signer, intact, verified };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/sign-windows.ts <file.exe>  (signs it, MONSTERS_WIN_SIGN)');
    process.exit(2);
  }
  await signWithJsign({ path: file, hash: 'sha256' });
  console.warn(JSON.stringify(verifyWithOsslsigncode(file, join(TEST_SIGNING_DIR, 'test-ca.crt'))));
}
