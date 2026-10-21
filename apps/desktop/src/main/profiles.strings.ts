import { pick } from '@monsters/shared';

/*
 * The words of the connection profiles: the errors of the form's fields (profiles.ts) and
 * the messages of the checks at save and "Try" time (connection-check.ts). D-153.
 */

const en = {
  fieldErrors: {
    name: 'The name can be at most 80 characters.',
    host: 'Enter the other computer’s address, for example 192.168.1.20 or home-pc.local: no spaces and no “-” at the start.',
    user: 'The user name can’t contain spaces or start with “-”.',
    sshPort: 'The port is a number between 1 and 65535 (usually 22).',
    identityFile: 'The key path is too long.',
    remotePort: 'The Monsters port is a number between 1 and 65535 (usually 4747).',
    remoteHome: 'The folder can’t contain quotes, $ or \\.',
  },
  hostLooksLikeName:
    'This looks like the connection’s name. What’s needed here is the other computer’s address, for example 192.168.1.20 or home-pc.local.',
  duplicateName: 'There’s already a connection with this name: pick another one.',
  newerFile:
    'The connections were saved by a newer version of Monsters: update the app to edit them.',
  check: {
    hostNotFound: (host: string) =>
      `I can’t find “${host}” on the network. Check the address (for example 192.168.1.20 or home-pc.local) and, if you use a VPN such as Tailscale, that it’s on. If you’re sure, press “Save” again.`,
    works: (version: string, name: string) =>
      `It works: Monsters ${version} is answering on “${name}”.`,
  },
};

const it: typeof en = {
  fieldErrors: {
    name: 'Il nome può avere al massimo 80 caratteri.',
    host: 'Scrivi l’indirizzo dell’altro computer, per esempio 192.168.1.20 o pc-casa.local: senza spazi e senza "-" all’inizio.',
    user: 'Il nome utente non può contenere spazi né iniziare con "-".',
    sshPort: 'La porta è un numero tra 1 e 65535 (di solito 22).',
    identityFile: 'Il percorso della chiave è troppo lungo.',
    remotePort: 'La porta di Monsters è un numero tra 1 e 65535 (di solito 4747).',
    remoteHome: 'La cartella non può contenere virgolette, $ o \\.',
  },
  hostLooksLikeName:
    'Questo sembra il nome della connessione. Qui serve l’indirizzo dell’altro computer, per esempio 192.168.1.20 o pc-casa.local.',
  duplicateName: 'C’è già una connessione con questo nome: scegline un altro.',
  newerFile:
    'Le connessioni sono state salvate da una versione più recente di Monsters: aggiorna l’app per modificarle.',
  check: {
    hostNotFound: (host) =>
      `Non trovo «${host}» in rete. Controlla l’indirizzo (per esempio 192.168.1.20 o pc-casa.local) e, se usi una VPN come Tailscale, che sia accesa. Se sei sicuro, premi di nuovo «Salva».`,
    works: (version, name) => `Funziona: Monsters ${version} risponde su «${name}».`,
  },
};

export const profileStrings = () => pick({ en, it });
