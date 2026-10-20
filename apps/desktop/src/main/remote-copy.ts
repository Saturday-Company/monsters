import { messageFor, type HostKeyInfo, type TunnelErrorKind } from '@monsters/remote';
import { SYSTEM_FONT } from './page-theme.ts';
import type { LinkState } from './remote-core.ts';

/*
 * The words of the client mode (M3.3, D-047), in Italian: the host key dialogs, the tray
 * tooltip, the banner over the window while reconnecting, the status line of the
 * connections page. Pure functions (tested), used by index.ts.
 */

/** The fields of Electron's MessageBoxOptions used here. */
export interface DialogCopy {
  type: 'warning' | 'error';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

/** Index of the "trust" button in `hostKeyDialog`. */
export const TRUST_BUTTON = 1;

/**
 * First connection to a computer: the user compares the fingerprint with the one the
 * remote computer prints. "Annulla" is the default (Enter, Esc, closing the dialog). The
 * first line says it is normal; the check, for whoever wants it, comes after (audit UX 1.8).
 */
export function hostKeyDialog(info: HostKeyInfo, name: string): DialogCopy {
  const key = info.keys[0];
  const where = info.port === 22 ? info.hostname : `${info.hostname}, porta ${info.port}`;
  return {
    type: 'warning',
    title: 'Nuovo computer',
    message: `Stai collegando per la prima volta «${name}». Se l’hai configurato tu, è normale.`,
    detail: [
      `Monsters si ricorda la chiave di questo computer (${where}) e da ora controlla che sia ` +
        'sempre lui: se un giorno cambia, non si collega.',
      '',
      `Impronta (${key?.type ?? '?'}): ${key?.fingerprint ?? '?'}`,
      '',
      'Come verificarlo: sull’altro computer, in un terminale,',
      'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
      'deve stampare la stessa impronta.',
    ].join('\n'),
    buttons: ['Annulla', 'Mi fido, collegati'],
    defaultId: 0,
    cancelId: 0,
  };
}

export function hostKeyChangedDialog(name: string): DialogCopy {
  return {
    type: 'error',
    title: 'Chiave del computer cambiata',
    message: `«${name}» non si presenta più con la stessa chiave di prima: non mi collego.`,
    detail:
      'Succede se quel computer è stato reinstallato, ma anche se qualcuno si mette in mezzo ' +
      'alla connessione. Se sai che è stato reinstallato, nella finestra di Monsters puoi ' +
      'dimenticare la vecchia chiave; altrimenti chiedi a chi lo gestisce.',
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
  };
}

/** "Dimentica la vecchia chiave": a strong warning first. Button 0 forgets, 1 is the default. */
export function forgetKeyDialog(name: string): DialogCopy {
  return {
    type: 'warning',
    title: 'Dimenticare la vecchia chiave?',
    message: `Fallo solo se sei sicuro che «${name}» sia stato reinstallato o cambiato da te.`,
    detail:
      'Se non lo sai, qualcuno potrebbe fingersi il tuo computer per leggere quello che fanno ' +
      'i mostri. Dopo, al collegamento ti mostro la chiave nuova da confermare.',
    buttons: ['Dimentica la chiave', 'Annulla'],
    defaultId: 1,
    cancelId: 1,
  };
}

/** The old key is in the user's own known_hosts: Monsters never writes it. */
export function keyElsewhereDialog(name: string, address: string): DialogCopy {
  return {
    type: 'warning',
    title: 'Chiave salvata fuori da Monsters',
    message: `La vecchia chiave di «${name}» è salvata nelle impostazioni SSH del tuo utente, che Monsters non modifica.`,
    detail: `Per toglierla, da un terminale di questo computer:\nssh-keygen -R ${address}\npoi premi «Riprova».`,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
  };
}

/** Field of the connections form that fixes a failure ("Correggi la connessione"). */
export type FixField = 'host' | 'user' | 'identityFile' | 'sshPort';

export interface FailureCopy {
  message: string;
  tip?: string;
  /** Field to open the form on; null when the profile is not what needs fixing. */
  fix: FixField | null;
  /** Host key changed: offer to forget the old one. */
  forgetKey?: boolean;
}

/**
 * Why a connection failed, in plain Italian, naming the address that was tried and saying what
 * to do (audit UX 1.4, 1.7). The technical lines of ssh stay under "Dettagli".
 */
export function remoteFailureCopy(
  kind: TunnelErrorKind,
  name: string,
  address: string,
  fallback = '',
  platform: string = process.platform,
): FailureCopy {
  switch (kind) {
    case 'host-not-found':
      return {
        message: `Non trovo «${address}» in rete.`,
        tip: 'Controlla l’indirizzo (per esempio 192.168.1.20 o pc-casa.local) e, se usi una VPN come Tailscale, che sia accesa.',
        fix: 'host',
      };
    case 'unreachable':
      return {
        message: `«${address}» non risponde.`,
        tip: 'È acceso e collegato alla stessa rete (o alla VPN)? Controlla anche l’indirizzo.',
        fix: 'host',
      };
    case 'auth-failed':
      return {
        message: `«${address}» ha rifiutato l’accesso. Monsters entra solo con una chiave SSH, mai con la password: controlla nome utente e chiave.`,
        tip:
          platform === 'win32'
            ? 'Perché la tua chiave sia accettata, la sua parte pubblica (il file .pub) va aggiunta a ~/.ssh/authorized_keys sull’altro computer.'
            : 'Perché la tua chiave sia accettata, da un terminale di questo computer: ssh-copy-id utente@indirizzo. Se la chiave ha una passphrase, aggiungila prima con ssh-add.',
        fix: 'user',
      };
    case 'host-key-unknown':
      return {
        message: `Non mi sono collegato: la chiave di «${name}» non è stata confermata.`,
        tip: 'Con «Riprova» te la mostro di nuovo.',
        fix: null,
      };
    case 'host-key-changed':
      return {
        message: `«${name}» non si presenta più con la stessa chiave di prima, quindi non mi collego.`,
        tip: 'Succede se quel computer è stato reinstallato, ma anche se qualcuno si mette in mezzo. Se non sei sicuro, chiedi a chi lo gestisce.',
        fix: null,
        forgetKey: true,
      };
    case 'core-unreachable':
      return {
        message: `Il collegamento con «${name}» funziona, ma lì Monsters non è acceso.`,
        tip: 'Apri Monsters su quel computer, poi premi «Riprova».',
        fix: null,
      };
    case 'core-unverified':
      return {
        message: `Su «${name}», al posto di Monsters, risponde un altro programma: per sicurezza non mi collego.`,
        tip: 'Se Monsters lì si è appena riavviato basta «Riprova»; altrimenti riavvialo su quel computer.',
        fix: null,
      };
    case 'core-outdated':
      return {
        message: `Monsters su «${name}» è di una versione troppo vecchia per collegarsi in modo sicuro.`,
        tip: 'Aggiornalo su quel computer, riaprilo e premi «Riprova».',
        fix: null,
      };
    case 'connection-lost':
    case 'ssh-error':
      return {
        message: `Il collegamento con «${name}» si è interrotto.`,
        tip: 'Premi «Riprova»; se succede ancora, guarda i dettagli qui sotto.',
        fix: null,
      };
    default:
      return { message: messageFor(kind) || fallback, fix: null };
  }
}

/** Tooltip of the tray icon: which core the app is using, and how the link is doing. */
export function trayTooltip(link: LinkState | null): string {
  if (!link) return 'Monsters · Questo computer';
  switch (link.status) {
    case 'connecting':
      return `Monsters · Mi collego a ${link.name}…`;
    case 'connected':
      return `Monsters · Collegato a ${link.name}`;
    case 'reconnecting':
      return `Monsters · Mi ricollego a ${link.name}…`;
    case 'failed':
    case 'closed':
      return `Monsters · Scollegato da ${link.name}`;
  }
}

/** The status line of the current row in the connections page. */
export function linkStatusText(link: LinkState | null, localReady: boolean): string {
  if (!link) return localReady ? 'In uso' : 'In uso · sta partendo';
  switch (link.status) {
    case 'connecting':
      return 'In uso · mi sto collegando…';
    case 'connected':
      return 'In uso · collegato';
    case 'reconnecting':
      return `In uso · mi ricollego… (tentativo ${link.attempt})`;
    case 'failed':
      return 'In uso · non collegato';
    case 'closed':
      return 'Scollegato';
  }
}

/** The banner over the remote page, or null when there is nothing to say. */
export function bannerText(link: LinkState | null): string | null {
  if (!link) return null;
  if (link.status === 'reconnecting') {
    return `Collegamento con ${link.name} interrotto. Mi ricollego… (tentativo ${link.attempt})`;
  }
  if (link.status === 'connected') return `Collegato a ${link.name}`;
  return null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The banner page: text only, no script (CSP `default-src 'none'`). */
export function bannerHtml(text: string, tone: 'busy' | 'ok'): string {
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;font:500 13px/1.3 ${SYSTEM_FONT};-webkit-font-smoothing:antialiased}
p{margin:0;padding:.5rem .95rem;border-radius:10px;background:#0d0d0c;color:#efe9dc;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 0 0 1px rgba(0,0,0,.4);max-width:calc(100% - 1rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:.5rem}
i{width:8px;height:8px;border-radius:50%;background:${tone === 'ok' ? '#4fd98a' : '#ff5e14'};box-shadow:0 0 6px ${tone === 'ok' ? 'rgba(79,217,138,.6)' : 'rgba(255,94,20,.6)'};flex:none}
@media (prefers-color-scheme:dark){p{background:#050505}}
</style></head>
<body><p role="status" data-tone="${tone}"><i></i>${escape(text)}</p></body></html>
`;
}
