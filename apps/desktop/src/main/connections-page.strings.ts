import { pick } from '@monsters/shared';

/*
 * The words of the connections window and its page (D-153). The page's script gets the
 * `script` group as JSON (connections-page.ts): plain strings, `{name}` is replaced by the
 * script. Call `connectionsStrings()` where the text is produced.
 */

const en = {
  windowTitle: 'Computers',
  pageTitle: 'Computers · Monsters',
  pickKeyTitle: 'Choose the private SSH key',
  /** The row of this computer in the list (also its name for the web UI's switcher). */
  localName: 'This computer',
  localAddress: 'The monsters work here',
  intro:
    'Use the monsters working on another computer of yours, or go back to the ones on this one.',
  computersLabel: 'Computer',
  listLabel: 'List of computers',
  add: 'Add a computer',
  autoLogin: 'Sign in without a password',
  autoLoginHint:
    'Monsters uses your SSH access to that computer to sign you in on its own. If you turn it off, the first time it asks for your email and password.',
  advanced: 'Advanced options',
  saveAndConnect: 'Save and connect',
  test: 'Try',
  save: 'Save',
  cancel: 'Cancel',
  before: 'Before you start',
  beforeOther: 'On the other computer',
  beforeThis: 'From this computer',
  beforeRunning: 'Monsters has to be running.',
  beforeSsh:
    'SSH access is needed: on a Mac, System Settings → General → Sharing → Remote Login; on Windows, “OpenSSH Server” under Optional features; on Linux, the openssh-server package.',
  beforeKey:
    'you have to be able to sign in with an SSH key, without a password: Monsters never asks for a password.',
  fields: {
    host: {
      label: 'Computer',
      hint: 'The other computer’s address: a Tailscale name or user@address works too.',
      placeholder: '192.168.1.20 or home-pc.local',
    },
    name: {
      label: 'Name',
      hint: 'Optional: how you want to see it in the menus. If you leave it empty I use the address.',
      placeholder: 'Home PC',
    },
    user: { label: 'User', hint: 'Your user name on that computer.' },
    sshPort: { label: 'Port', hint: 'That computer’s SSH port.' },
    identityFile: {
      label: 'Key',
      hint: 'Without one, I use the SSH keys you already use.',
      placeholder: '~/.ssh/id_ed25519',
      pick: 'Choose…',
    },
    remotePort: {
      label: 'Monsters port',
      hint: 'I read it on my own on that computer.',
      placeholder: '4747',
    },
    remoteHome: {
      label: 'Data folder',
      hint: 'Only if Monsters there uses a different folder from the usual one.',
      placeholder: '~/.monsters',
    },
  },
  script: {
    use: 'Use',
    useAria: 'Use {name}',
    edit: 'Edit',
    editAria: 'Edit {name}',
    remove: 'Delete',
    removeAria: 'Delete {name}',
    confirm: 'Confirm',
    confirmAria: 'Confirm deleting {name}',
    editTitle: 'Edit {name}',
    addTitle: 'Add a computer',
    saveFailed: 'I couldn’t save the connection.',
    trying: 'Trying to connect…',
    tryFailed: 'I couldn’t try the connection.',
    unsaved: 'You have unsaved changes: press Esc again to close without saving them.',
  },
};

const it: typeof en = {
  windowTitle: 'Computer',
  pageTitle: 'Computer · Monsters',
  pickKeyTitle: 'Scegli la chiave privata SSH',
  localName: 'Questo computer',
  localAddress: 'I mostri lavorano qui',
  intro: 'Usa i mostri che lavorano su un altro tuo computer, o torna a quelli di questo.',
  computersLabel: 'Computer',
  listLabel: 'Elenco dei computer',
  add: 'Aggiungi un computer',
  autoLogin: 'Entra senza password',
  autoLoginHint:
    'Monsters usa il tuo accesso SSH a quel computer per farti entrare da solo. Se lo togli, la prima volta ti chiede email e password.',
  advanced: 'Opzioni avanzate',
  saveAndConnect: 'Salva e collega',
  test: 'Prova',
  save: 'Salva',
  cancel: 'Annulla',
  before: 'Prima di iniziare',
  beforeOther: 'Sull’altro computer',
  beforeThis: 'Da questo computer',
  beforeRunning: 'Monsters dev’essere acceso.',
  beforeSsh:
    'serve l’accesso SSH: su Mac in Impostazioni di Sistema → Generali → Condivisione → Login remoto; su Windows «Server OpenSSH» tra le Funzionalità facoltative; su Linux il pacchetto openssh-server.',
  beforeKey:
    'devi poter entrare con una chiave SSH, senza password: Monsters non chiede mai password.',
  fields: {
    host: {
      label: 'Computer',
      hint: 'L’indirizzo dell’altro computer: va bene anche il nome Tailscale, o utente@indirizzo.',
      placeholder: '192.168.1.20 o pc-casa.local',
    },
    name: {
      label: 'Nome',
      hint: 'Facoltativo: come vuoi vederlo nei menu. Se lo lasci vuoto uso l’indirizzo.',
      placeholder: 'PC di casa',
    },
    user: { label: 'Utente', hint: 'Il tuo nome utente su quel computer.' },
    sshPort: { label: 'Porta', hint: 'La porta SSH di quel computer.' },
    identityFile: {
      label: 'Chiave',
      hint: 'Senza, uso le chiavi SSH che usi già.',
      placeholder: '~/.ssh/id_ed25519',
      pick: 'Scegli…',
    },
    remotePort: {
      label: 'Porta di Monsters',
      hint: 'La leggo da sola su quel computer.',
      placeholder: '4747',
    },
    remoteHome: {
      label: 'Cartella dati',
      hint: 'Solo se lì Monsters usa una cartella diversa da quella di sempre.',
      placeholder: '~/.monsters',
    },
  },
  script: {
    use: 'Usa',
    useAria: 'Usa {name}',
    edit: 'Modifica',
    editAria: 'Modifica {name}',
    remove: 'Elimina',
    removeAria: 'Elimina {name}',
    confirm: 'Conferma',
    confirmAria: 'Conferma eliminazione di {name}',
    editTitle: 'Modifica {name}',
    addTitle: 'Aggiungi un computer',
    saveFailed: 'Non sono riuscito a salvare la connessione.',
    trying: 'Provo a collegarmi…',
    tryFailed: 'Non sono riuscito a provare la connessione.',
    unsaved: 'Hai modifiche non salvate: premi di nuovo Esc per chiudere senza salvarle.',
  },
};

export const connectionsStrings = () => pick({ en, it });
