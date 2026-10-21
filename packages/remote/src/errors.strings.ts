import { pick } from '@monsters/shared';

/**
 * What the desktop app shows when the tunnel to another computer fails (D-153), by the kind of
 * error. The kinds are codes and stay as they are.
 */
const en = {
  'ssh-missing':
    'I can’t find the ssh command on this computer. On Windows, install “OpenSSH Client” from ' +
    'Settings → System → Optional features; on Linux, the openssh-client package.',
  'host-key-unknown':
    'This is the first connection to this computer: check that the fingerprint of its key is the right one ' +
    'before you trust it.',
  'host-key-changed':
    'The remote computer’s key has changed from the one you know. It may have been reinstalled, but it could ' +
    'also be someone in the middle: Monsters won’t connect. Check with whoever manages that computer and, ' +
    'if the change is legitimate, remove the old key from the known_hosts file.',
  'host-key-scan-failed':
    'I can’t read the remote computer’s key to have you confirm it. Connect once from a terminal with ' +
    '“ssh” and accept the key there, then try again.',
  'auth-failed':
    'The remote computer refused the sign-in. Monsters only uses SSH keys (no passwords): ' +
    'check the user and the key, and that the public key is in ~/.ssh/authorized_keys on the remote computer.',
  'host-not-found':
    'I can’t find this computer on the network: check the name or address (and the VPN, if you use one).',
  unreachable:
    'The remote computer isn’t answering: is it on and reachable? Check the address, the SSH port and the VPN.',
  'connection-lost': 'The connection to the remote computer was interrupted.',
  'forward-failed': 'I can’t open the local port for the tunnel.',
  'core-unreachable':
    'The SSH connection works, but Monsters isn’t answering on the remote computer: is it running? ' +
    '(on the remote computer: “monsters start”)',
  'core-unverified':
    'On the remote computer, something answers at Monsters’ port that doesn’t prove it is your ' +
    'Monsters: I’m not connecting. If the remote engine has just restarted, trying again is enough; otherwise ' +
    'check on the remote computer what is using that port.',
  'core-outdated':
    'Monsters on the remote computer is too old to connect safely: ' +
    'update it and restart it, then try again.',
  'forwarding-disabled':
    'The remote computer’s SSH server doesn’t allow tunnels: in /etc/ssh/sshd_config you need ' +
    '“AllowTcpForwarding local” (or “yes”) for your user.',
  'ssh-error': 'The SSH connection failed.',
};

const it: typeof en = {
  'ssh-missing':
    'Non trovo il comando ssh su questo computer. Su Windows installa "Client OpenSSH" da ' +
    'Impostazioni → Sistema → Funzionalità facoltative; su Linux il pacchetto openssh-client.',
  'host-key-unknown':
    "È la prima connessione a questo computer: controlla che l'impronta della sua chiave sia quella giusta " +
    'prima di fidarti.',
  'host-key-changed':
    'La chiave del computer remoto è cambiata rispetto a quella che conosci. Potrebbe essere stato ' +
    'reinstallato, ma anche qualcuno che si mette in mezzo: Monsters non si collega. Verifica con chi ' +
    'gestisce quel computer e, se il cambio è legittimo, togli la vecchia chiave dal file known_hosts.',
  'host-key-scan-failed':
    'Non riesco a leggere la chiave del computer remoto per fartela confermare. Collegati una volta da ' +
    'un terminale con "ssh" e accetta lì la chiave, poi riprova.',
  'auth-failed':
    "Il computer remoto ha rifiutato l'accesso. Monsters usa solo chiavi SSH (niente password): " +
    'controlla utente e chiave, e che la chiave pubblica sia in ~/.ssh/authorized_keys sul computer remoto.',
  'host-not-found':
    "Non trovo questo computer in rete: controlla il nome o l'indirizzo (e la VPN, se la usi).",
  unreachable:
    'Il computer remoto non risponde: è acceso e raggiungibile? Controlla indirizzo, porta SSH e VPN.',
  'connection-lost': 'La connessione con il computer remoto si è interrotta.',
  'forward-failed': 'Non riesco ad aprire la porta locale del tunnel.',
  'core-unreachable':
    'Il collegamento SSH funziona, ma Monsters non risponde sul computer remoto: è acceso? ' +
    '(sul computer remoto: "monsters start")',
  'core-unverified':
    'Sul computer remoto, alla porta di Monsters, risponde qualcosa che non dimostra di essere il tuo ' +
    'Monsters: non mi collego. Se il motore remoto si è appena riavviato basta riprovare; altrimenti ' +
    'controlla sul computer remoto chi usa quella porta.',
  'core-outdated':
    'Monsters sul computer remoto è di una versione troppo vecchia per collegarsi in modo sicuro: ' +
    'aggiornalo e riavvialo, poi riprova.',
  'forwarding-disabled':
    'Il server SSH del computer remoto non permette i tunnel: in /etc/ssh/sshd_config serve ' +
    '"AllowTcpForwarding local" (o "yes") per il tuo utente.',
  'ssh-error': 'Il collegamento SSH non è riuscito.',
};

export const tunnelStrings = () => pick({ en, it });
