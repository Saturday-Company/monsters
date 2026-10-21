import { pick } from '@monsters/shared';

/*
 * Why a .deb update was not installed (deb-install.ts `describeDebFailure`): one or two
 * sentences for the user. Typed dictionaries (D-153).
 */

const en = {
  noPkexec:
    'pkexec (the polkit package), which is needed to ask for the password, is missing on this computer.',
  cancelled: 'The password request was cancelled.',
  timeout: 'Nobody answered the password request: I cancelled the installation.',
  noAgent:
    'There’s nothing that can ask for the computer’s password: this happens when Monsters runs in a remote session (SSH or remote desktop) without the authentication agent.',
  notAuthorized:
    'I wasn’t allowed to install: the password wasn’t accepted, or this user can’t install programs (a computer administrator is needed).',
  mismatch:
    'The downloaded package doesn’t match the published one (sha512 check): I didn’t install it.',
  signature:
    'The update’s signature isn’t valid (checked with the keys installed with Monsters): I didn’t install it.',
  notOurs: 'The downloaded file isn’t the Monsters package: I didn’t install it.',
  notNewer: 'The downloaded package isn’t newer than the installed version: I didn’t install it.',
  openssl:
    'Checking the update’s signature needs OpenSSL 3.0 or newer, and this computer doesn’t have it (the system is too old, or the openssl package is missing): I didn’t install it.',
  copy: (detail: string) => `I couldn’t prepare the package for installation (${detail}).`,
  depends: (missing: string) =>
    `The package needs ${missing}, which this computer doesn’t have: I didn’t install it, so as not to leave Monsters half-installed.`,
  dpkg: (code: string, detail: string, halfInstalled: boolean) =>
    `dpkg didn’t complete the installation (code ${code}): ${detail}.` +
    (halfInstalled
      ? ' The new package was left half-installed: its files are already on disk, but some dependencies are missing.'
      : ''),
  error: (detail: string) => `The installation didn’t start (${detail}).`,
};

const it: typeof en = {
  noPkexec:
    'Su questo computer manca pkexec (il pacchetto polkit), che serve a chiedere la password.',
  cancelled: 'La richiesta della password è stata annullata.',
  timeout: 'Nessuno ha risposto alla richiesta della password: ho annullato l’installazione.',
  noAgent:
    'Non c’è niente che possa chiedere la password del computer: succede quando Monsters gira in una sessione remota (SSH o desktop remoto) senza l’agente di autenticazione.',
  notAuthorized:
    'Non ho avuto il permesso di installare: la password non è stata accettata, o questo utente non può installare programmi (serve un amministratore del computer).',
  mismatch:
    'Il pacchetto scaricato non corrisponde a quello pubblicato (controllo sha512): non l’ho installato.',
  signature:
    'La firma dell’aggiornamento non è valida (controllo fatto con le chiavi installate con Monsters): non l’ho installato.',
  notOurs: 'Il file scaricato non è il pacchetto di Monsters: non l’ho installato.',
  notNewer:
    'Il pacchetto scaricato non è più recente della versione installata: non l’ho installato.',
  openssl:
    'Per controllare la firma dell’aggiornamento serve OpenSSL 3.0 o più recente, e su questo computer non c’è (il sistema è troppo vecchio, o manca il pacchetto openssl): non l’ho installato.',
  copy: (detail) => `Non sono riuscito a preparare il pacchetto per l’installazione (${detail}).`,
  depends: (missing) =>
    `Il pacchetto ha bisogno di ${missing}, che su questo computer non c’è: non l’ho installato, per non lasciare Monsters a metà.`,
  dpkg: (code, detail, halfInstalled) =>
    `dpkg non ha completato l’installazione (codice ${code}): ${detail}.` +
    (halfInstalled
      ? ' Il pacchetto nuovo è rimasto a metà: i suoi file sono già sul disco, ma mancano delle dipendenze.'
      : ''),
  error: (detail) => `L’installazione non è partita (${detail}).`,
};

export const debInstallStrings = () => pick({ en, it });
