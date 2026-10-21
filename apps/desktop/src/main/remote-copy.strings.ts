import { pick } from '@monsters/shared';

/*
 * The words of the client mode (M3.3, D-047): host key dialogs, tray tooltip, banner over
 * the window, status line of the connections page, why a connection failed. Typed
 * dictionaries (D-153); call `remoteCopyStrings()` where the text is produced.
 */

const en = {
  hostKey: {
    title: 'New computer',
    message: (name: string) =>
      `You’re connecting to “${name}” for the first time. If you set it up yourself, that’s normal.`,
    port: (hostname: string, port: number) => `${hostname}, port ${port}`,
    remember: (where: string) =>
      `Monsters will remember this computer’s key (${where}) and from now on check that it’s ` +
      'always the same one: if it ever changes, it won’t connect.',
    fingerprint: (type: string, fingerprint: string) => `Fingerprint (${type}): ${fingerprint}`,
    verify: [
      'How to check it: on the other computer, in a terminal,',
      'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
      'should print the same fingerprint.',
    ] as readonly string[],
    cancel: 'Cancel',
    trust: 'I trust it, connect',
  },
  hostKeyChanged: {
    title: 'The computer’s key has changed',
    message: (name: string) =>
      `“${name}” no longer shows the same key as before: I’m not connecting.`,
    detail:
      'This happens when that computer was reinstalled, but also when someone gets in the middle ' +
      'of the connection. If you know it was reinstalled, you can forget the old key in the ' +
      'Monsters window; otherwise ask whoever manages it.',
    ok: 'OK',
  },
  forgetKey: {
    title: 'Forget the old key?',
    message: (name: string) =>
      `Only do this if you’re sure “${name}” was reinstalled or changed by you.`,
    detail:
      'If you don’t know, someone could be posing as your computer to read what the monsters ' +
      'do. After this, I’ll show you the new key to confirm when I connect.',
    forget: 'Forget the key',
    cancel: 'Cancel',
  },
  keyElsewhere: {
    title: 'Key saved outside Monsters',
    message: (name: string) =>
      `The old key of “${name}” is saved in your user’s SSH settings, which Monsters doesn’t change.`,
    detail: (address: string) =>
      `To remove it, from a terminal on this computer:\nssh-keygen -R ${address}\nthen press “Try again”.`,
    ok: 'OK',
  },
  failure: {
    hostNotFound: (address: string) => `I can’t find “${address}” on the network.`,
    hostNotFoundTip:
      'Check the address (for example 192.168.1.20 or home-pc.local) and, if you use a VPN such as Tailscale, that it’s on.',
    unreachable: (address: string) => `“${address}” isn’t answering.`,
    unreachableTip:
      'Is it on and connected to the same network (or the VPN)? Check the address too.',
    authFailed: (address: string) =>
      `“${address}” refused the sign-in. Monsters only signs in with an SSH key, never with a password: check the user name and the key.`,
    authFailedTipWindows:
      'For your key to be accepted, its public part (the .pub file) has to be added to ~/.ssh/authorized_keys on the other computer.',
    authFailedTip:
      'For your key to be accepted, from a terminal on this computer: ssh-copy-id user@address. If the key has a passphrase, add it first with ssh-add.',
    hostKeyUnknown: (name: string) => `I didn’t connect: the key of “${name}” wasn’t confirmed.`,
    hostKeyUnknownTip: 'With “Try again” I’ll show it to you again.',
    hostKeyChanged: (name: string) =>
      `“${name}” no longer shows the same key as before, so I’m not connecting.`,
    hostKeyChangedTip:
      'This happens when that computer was reinstalled, but also when someone gets in the middle. If you’re not sure, ask whoever manages it.',
    coreUnreachable: (name: string) =>
      `The link to “${name}” works, but Monsters isn’t running there.`,
    coreUnreachableTip: 'Open Monsters on that computer, then press “Try again”.',
    coreUnverified: (name: string) =>
      `On “${name}”, another program is answering instead of Monsters: to be safe I’m not connecting.`,
    coreUnverifiedTip:
      'If Monsters there has just restarted, “Try again” is enough; otherwise restart it on that computer.',
    coreOutdated: (name: string) => `Monsters on “${name}” is too old to connect securely.`,
    coreOutdatedTip: 'Update it on that computer, reopen it and press “Try again”.',
    connectionLost: (name: string) => `The link to “${name}” was interrupted.`,
    connectionLostTip: 'Press “Try again”; if it keeps happening, look at the details below.',
  },
  tray: {
    local: 'Monsters · This computer',
    connecting: (name: string) => `Monsters · Connecting to ${name}…`,
    connected: (name: string) => `Monsters · Connected to ${name}`,
    reconnecting: (name: string) => `Monsters · Reconnecting to ${name}…`,
    disconnected: (name: string) => `Monsters · Disconnected from ${name}`,
  },
  status: {
    inUse: 'In use',
    inUseStarting: 'In use · starting',
    inUseConnecting: 'In use · connecting…',
    inUseConnected: 'In use · connected',
    inUseReconnecting: (attempt: number) => `In use · reconnecting… (attempt ${attempt})`,
    inUseFailed: 'In use · not connected',
    closed: 'Disconnected',
  },
  banner: {
    reconnecting: (name: string, attempt: number) =>
      `Link to ${name} interrupted. Reconnecting… (attempt ${attempt})`,
    connected: (name: string) => `Connected to ${name}`,
  },
};

const it: typeof en = {
  hostKey: {
    title: 'Nuovo computer',
    message: (name) =>
      `Stai collegando per la prima volta «${name}». Se l’hai configurato tu, è normale.`,
    port: (hostname, port) => `${hostname}, porta ${port}`,
    remember: (where) =>
      `Monsters si ricorda la chiave di questo computer (${where}) e da ora controlla che sia ` +
      'sempre lui: se un giorno cambia, non si collega.',
    fingerprint: (type, fingerprint) => `Impronta (${type}): ${fingerprint}`,
    verify: [
      'Come verificarlo: sull’altro computer, in un terminale,',
      'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
      'deve stampare la stessa impronta.',
    ],
    cancel: 'Annulla',
    trust: 'Mi fido, collegati',
  },
  hostKeyChanged: {
    title: 'Chiave del computer cambiata',
    message: (name) =>
      `«${name}» non si presenta più con la stessa chiave di prima: non mi collego.`,
    detail:
      'Succede se quel computer è stato reinstallato, ma anche se qualcuno si mette in mezzo ' +
      'alla connessione. Se sai che è stato reinstallato, nella finestra di Monsters puoi ' +
      'dimenticare la vecchia chiave; altrimenti chiedi a chi lo gestisce.',
    ok: 'OK',
  },
  forgetKey: {
    title: 'Dimenticare la vecchia chiave?',
    message: (name) =>
      `Fallo solo se sei sicuro che «${name}» sia stato reinstallato o cambiato da te.`,
    detail:
      'Se non lo sai, qualcuno potrebbe fingersi il tuo computer per leggere quello che fanno ' +
      'i mostri. Dopo, al collegamento ti mostro la chiave nuova da confermare.',
    forget: 'Dimentica la chiave',
    cancel: 'Annulla',
  },
  keyElsewhere: {
    title: 'Chiave salvata fuori da Monsters',
    message: (name) =>
      `La vecchia chiave di «${name}» è salvata nelle impostazioni SSH del tuo utente, che Monsters non modifica.`,
    detail: (address) =>
      `Per toglierla, da un terminale di questo computer:\nssh-keygen -R ${address}\npoi premi «Riprova».`,
    ok: 'OK',
  },
  failure: {
    hostNotFound: (address) => `Non trovo «${address}» in rete.`,
    hostNotFoundTip:
      'Controlla l’indirizzo (per esempio 192.168.1.20 o pc-casa.local) e, se usi una VPN come Tailscale, che sia accesa.',
    unreachable: (address) => `«${address}» non risponde.`,
    unreachableTip:
      'È acceso e collegato alla stessa rete (o alla VPN)? Controlla anche l’indirizzo.',
    authFailed: (address) =>
      `«${address}» ha rifiutato l’accesso. Monsters entra solo con una chiave SSH, mai con la password: controlla nome utente e chiave.`,
    authFailedTipWindows:
      'Perché la tua chiave sia accettata, la sua parte pubblica (il file .pub) va aggiunta a ~/.ssh/authorized_keys sull’altro computer.',
    authFailedTip:
      'Perché la tua chiave sia accettata, da un terminale di questo computer: ssh-copy-id utente@indirizzo. Se la chiave ha una passphrase, aggiungila prima con ssh-add.',
    hostKeyUnknown: (name) =>
      `Non mi sono collegato: la chiave di «${name}» non è stata confermata.`,
    hostKeyUnknownTip: 'Con «Riprova» te la mostro di nuovo.',
    hostKeyChanged: (name) =>
      `«${name}» non si presenta più con la stessa chiave di prima, quindi non mi collego.`,
    hostKeyChangedTip:
      'Succede se quel computer è stato reinstallato, ma anche se qualcuno si mette in mezzo. Se non sei sicuro, chiedi a chi lo gestisce.',
    coreUnreachable: (name) =>
      `Il collegamento con «${name}» funziona, ma lì Monsters non è acceso.`,
    coreUnreachableTip: 'Apri Monsters su quel computer, poi premi «Riprova».',
    coreUnverified: (name) =>
      `Su «${name}», al posto di Monsters, risponde un altro programma: per sicurezza non mi collego.`,
    coreUnverifiedTip:
      'Se Monsters lì si è appena riavviato basta «Riprova»; altrimenti riavvialo su quel computer.',
    coreOutdated: (name) =>
      `Monsters su «${name}» è di una versione troppo vecchia per collegarsi in modo sicuro.`,
    coreOutdatedTip: 'Aggiornalo su quel computer, riaprilo e premi «Riprova».',
    connectionLost: (name) => `Il collegamento con «${name}» si è interrotto.`,
    connectionLostTip: 'Premi «Riprova»; se succede ancora, guarda i dettagli qui sotto.',
  },
  tray: {
    local: 'Monsters · Questo computer',
    connecting: (name) => `Monsters · Mi collego a ${name}…`,
    connected: (name) => `Monsters · Collegato a ${name}`,
    reconnecting: (name) => `Monsters · Mi ricollego a ${name}…`,
    disconnected: (name) => `Monsters · Scollegato da ${name}`,
  },
  status: {
    inUse: 'In uso',
    inUseStarting: 'In uso · sta partendo',
    inUseConnecting: 'In uso · mi sto collegando…',
    inUseConnected: 'In uso · collegato',
    inUseReconnecting: (attempt) => `In uso · mi ricollego… (tentativo ${attempt})`,
    inUseFailed: 'In uso · non collegato',
    closed: 'Scollegato',
  },
  banner: {
    reconnecting: (name, attempt) =>
      `Collegamento con ${name} interrotto. Mi ricollego… (tentativo ${attempt})`,
    connected: (name) => `Collegato a ${name}`,
  },
};

export const remoteCopyStrings = () => pick({ en, it });
