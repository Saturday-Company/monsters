import { createHash } from 'node:crypto';
import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appStrings } from '../src/main/app.strings.ts';
import { connectionsPageHtml } from '../src/main/connections-page.ts';
import { connectionsStrings } from '../src/main/connections-page.strings.ts';
import { checkProblemText } from '../src/main/core-integrity.ts';
import { closeNotice, leaveLocalDialog, quitDialog } from '../src/main/core-jobs.ts';
import { describeDebFailure } from '../src/main/deb-install.ts';
import { runKeychainOp, type HelperRequest } from '../src/keychain-helper/index.ts';
import { sandboxNotice } from '../src/main/linux-sandbox.ts';
import { LoginItem, linuxLauncher } from '../src/main/login-item.ts';
import { parseProfileForm } from '../src/main/profiles.ts';
import {
  bannerHtml,
  bannerText,
  forgetKeyDialog,
  hostKeyDialog,
  linkStatusText,
  remoteFailureCopy,
  trayTooltip,
} from '../src/main/remote-copy.ts';
import { statusCopy, statusPageHtml } from '../src/main/status-page.ts';
import { targetInfo } from '../src/main/ipc-guards.ts';
import { describeRefusal } from '../src/main/update-signature.ts';
import {
  debFailureDialog,
  manualCheckDialog,
  updateMenuEntry,
  updateReadyDialog,
  updateReadyNotice,
} from '../src/main/updater.ts';

/*
 * The desktop app's texts in Italian (D-153): the dictionaries are picked when the text is
 * produced, so `setAppLang('it')` is enough. The other tests run in English.
 */

beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));

describe('the app in Italian', () => {
  it('menus', () => {
    const t = appStrings().menu;
    expect([t.open, t.kill, t.resume, t.quit, t.connections]).toEqual([
      'Apri Monsters',
      'Ferma tutto',
      'Riprendi',
      'Esci da Monsters',
      'Computer…',
    ]);
    expect([t.edit, t.view, t.window, t.closeWindow, t.thisComputer]).toEqual([
      'Modifica',
      'Vista',
      'Finestra',
      'Chiudi finestra',
      'Questo computer',
    ]);
    expect(appStrings().startFailed.quit).toBe('Esci');
    expect(targetInfo(null, true).name).toBe('Questo computer');
  });

  it('the status page: language, welcome, failures', () => {
    const welcome = statusPageHtml({ kind: 'welcome' });
    expect(welcome).toContain('<html lang="it"');
    expect(welcome).toContain('<h1>Dove lavorano i tuoi mostri?</h1>');
    expect(welcome).toContain('Su questo computer <em>Consigliato</em>');
    expect(welcome).toContain('Su un altro mio computer');
    const failed = statusPageHtml({ kind: 'failed', logPath: '/l' });
    expect(failed).toContain('Riprova');
    expect(failed).toContain('Apri il log');
    expect(failed).toContain('<summary>Dettagli</summary>');
    expect(
      statusCopy({ kind: 'restarting', attempt: 2, maxAttempts: 5, delayMs: 1000 }).body[0],
    ).toBe('Lo riavvio tra un secondo (tentativo 2 di 5).');
    expect(statusPageHtml({ kind: 'missing', path: '/opt/m/core.js', dev: false })).toContain(
      'installa di nuovo Monsters',
    );
    expect(statusPageHtml({ kind: 'remote-connecting', name: 'casa' })).toContain(
      'Mi collego a casa…',
    );
  });

  it('the connections page: language, labels, texts of the script, hash of the script', () => {
    const html = connectionsPageHtml('frame');
    expect(html).toContain('<html lang="it"');
    expect(html).toContain('<title>Computer · Monsters</title>');
    expect(html).toContain('placeholder="192.168.1.20 o pc-casa.local"');
    expect(html).toContain('>Salva e collega</button>');
    expect(html).toContain('Entra senza password');
    expect(html).toContain('Opzioni avanzate');
    expect(html).toContain('"unsaved":"Hai modifiche non salvate');
    expect(html).toContain('"looksLikeName":"Questo sembra il nome della connessione');
    // The script is the one the CSP lets run.
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    const hash = createHash('sha256').update(script).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(connectionsStrings().windowTitle).toBe('Computer');
    setAppLang('en');
    const english = connectionsPageHtml('frame');
    expect(english).toContain('<html lang="en"');
    expect(english).toContain('>Save and connect</button>');
    const enScript = /<script>([\s\S]*?)<\/script>/.exec(english)?.[1] ?? '';
    expect(english).toContain(
      `script-src 'sha256-${createHash('sha256').update(enScript).digest('base64')}'`,
    );
    expect(enScript).not.toBe(script);
  });

  it('the client mode: dialogs, tooltip, banner, failures', () => {
    const info = {
      host: 'casa',
      hostname: '100.64.0.7',
      port: 2222,
      knownHostsName: '[100.64.0.7]:2222',
      keys: [{ type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:QmFzZTY0' }],
    };
    const d = hostKeyDialog(info, 'PC di casa');
    expect(d.buttons).toEqual(['Annulla', 'Mi fido, collegati']);
    expect(d.message).toBe(
      'Stai collegando per la prima volta «PC di casa». Se l’hai configurato tu, è normale.',
    );
    expect(d.detail).toContain('100.64.0.7, porta 2222');
    expect(d.detail).toContain('Impronta (ssh-ed25519): SHA256:QmFzZTY0');
    expect(forgetKeyDialog('x').buttons).toEqual(['Dimentica la chiave', 'Annulla']);
    expect(trayTooltip(null)).toBe('Monsters · Questo computer');
    expect(trayTooltip({ status: 'connected', name: 'Casa' })).toBe('Monsters · Collegato a Casa');
    const reconnecting = {
      status: 'reconnecting' as const,
      name: 'Casa',
      attempt: 2,
      delayMs: 2000,
      reason: 'x',
    };
    expect(bannerText(reconnecting)).toBe(
      'Collegamento con Casa interrotto. Mi ricollego… (tentativo 2)',
    );
    expect(linkStatusText(reconnecting, false)).toBe('In uso · mi ricollego… (tentativo 2)');
    expect(bannerHtml('x', 'busy')).toContain('<html lang="it">');
    expect(remoteFailureCopy('auth-failed', 'Casa', 'casa.lan', '', 'linux')).toMatchObject({
      message: expect.stringContaining('«casa.lan» ha rifiutato l’accesso') as unknown,
      tip: expect.stringContaining('ssh-copy-id') as unknown,
    });
  });

  it('forms and checks of the connections', () => {
    const r = parseProfileForm({ name: 'x', host: 'casa con spazi', sshPort: '99999' });
    expect(r).toMatchObject({
      ok: false,
      errors: {
        host: expect.stringContaining('sembra il nome della connessione') as unknown,
        sshPort: 'La porta è un numero tra 1 e 65535 (di solito 22).',
      },
    });
  });

  it('work in progress, close notice, sandbox notice', () => {
    const leave = leaveLocalDialog('PC di casa', 2);
    expect(leave.message).toBe(
      'Su questo computer ci sono 2 lavori in corso: se passi a «PC di casa» si fermano.',
    );
    expect(leave.buttons).toEqual(['Passa comunque', 'Annulla']);
    expect(leaveLocalDialog('x', null).message).toBe('Passare a «x»?');
    expect(quitDialog(1).message).toBe(
      'Su questo computer c’è un lavoro in corso: se esci si ferma.',
    );
    expect(quitDialog(1, 'update').buttons[0]).toBe('Riavvia');
    expect(closeNotice('Ctrl+Q')).toEqual({
      title: 'Monsters continua a lavorare',
      body: 'Anche a finestra chiusa i mostri vanno avanti. Per chiudere davvero Monsters: Esci (Ctrl+Q).',
    });
    expect(sandboxNotice().buttons).toEqual(['Continua', 'Esci']);
  });

  it('integrity, signature and .deb failures', () => {
    expect(checkProblemText({ ok: false, problem: 'changed', file: 'a.js', ms: 0 })).toBe(
      'resources/core/a.js è cambiato',
    );
    expect(describeRefusal('0.2.0', 'missing')).toBe(
      'l’aggiornamento 0.2.0 non è firmato: non lo scarico',
    );
    expect(describeRefusal(null, 'fetch')).toContain('riprovo più tardi');
    expect(describeDebFailure({ kind: 'cancelled' })).toBe(
      'La richiesta della password è stata annullata.',
    );
    expect(describeDebFailure({ kind: 'dpkg', code: 2, detail: 'unmet dependencies' })).toContain(
      'rimasto a metà',
    );
  });

  it('the updater: menu, dialogs, notification', () => {
    expect(updateMenuEntry({ kind: 'idle', checkedAt: null })?.label).toBe('Cerca aggiornamenti');
    expect(updateMenuEntry({ kind: 'ready', version: '0.0.2' })?.label).toBe(
      'Riavvia per aggiornare (versione 0.0.2)',
    );
    expect(manualCheckDialog({ kind: 'latest' }, '0.1.0')).toMatchObject({
      message: 'Monsters è aggiornato',
      detail: 'Hai già l’ultima versione (0.1.0).',
    });
    expect(updateReadyNotice('0.2.0').title).toBe('Aggiornamento pronto');
    const dialog = updateReadyDialog('0.2.0', { password: true });
    expect(dialog.buttons).toEqual(['Riavvia ora', 'Più tardi']);
    expect(dialog.detail).toContain('Ti chiederò la password del computer');
    const failure = debFailureDialog({
      failure: { kind: 'no-agent' },
      update: { version: '0.0.2', file: '/p/m.deb', sha512: 'x', url: null },
      currentVersion: '0.0.1',
      restarting: false,
    });
    expect(failure.message).toBe('Non ho installato Monsters 0.0.2');
    expect(failure.buttons).toEqual(['Copia il comando', 'Chiudi']);
    expect(failure.detail).toContain('Monsters continua con la versione 0.0.1.');
  });

  it('open at login', () => {
    const dev = linuxLauncher({ env: {}, execPath: '/repo/electron', isPackaged: false });
    expect(dev).toEqual({
      ok: false,
      reason: 'Si può scegliere solo nell’app installata (.deb o AppImage).',
    });
    const item = new LoginItem({
      platform: 'freebsd',
      env: {},
      execPath: '/x',
      isPackaged: true,
      homedir: '/h',
      backend: { get: () => ({ openAtLogin: false }), set: () => {} },
      log: () => {},
    });
    expect(item.state().note).toBe('Non disponibile su questo sistema.');
  });

  it('the keychain: the host answers in the app’s language, the helper in the one it is told', () => {
    const base: HelperRequest = {
      nativePath: '/core/keyring.linux-x64-gnu.node',
      op: 'get',
      service: 'Other',
      account: 'x',
    };
    const linux = { platform: 'linux' as const, arch: 'x64' };
    expect(runKeychainOp({ ...base, lang: 'it' }, () => ({}), linux)).toMatchObject({
      message: 'voce del portachiavi che non è di Monsters',
    });
    expect(runKeychainOp({ ...base, lang: 'en' }, () => ({}), linux)).toMatchObject({
      message: 'keychain entry that doesn’t belong to Monsters',
    });
    // No language in the request: English.
    expect(runKeychainOp(base, () => ({}), linux)).toMatchObject({
      message: 'keychain entry that doesn’t belong to Monsters',
    });
  });
});
