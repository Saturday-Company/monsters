import { pick } from '@monsters/shared';

/*
 * The texts a person reads from the other apps (MCP servers, D-153): the cards'
 * errors, the notices in Activity, the API errors and the sign-in's answers.
 * Picked where they are written, never at module load.
 */

const en = {
  // sign-in and card errors
  signInNeeded: 'Sign-in needed: press “Connect” and confirm in the browser.',
  oauthUnreachable:
    'The service can’t be reached: I can’t renew the sign-in (it stays valid). I’ll try again on the next call.',
  headersRefused: 'The server refused the sign-in: check the headers (for example the token).',
  signInAskedAgain: (label: string, where: string) =>
    `${label} asks for the sign-in again: press “Connect” in ${where}.`,
  moreScope: (label: string, where: string) =>
    `${label} needs one more permission for what the monsters ask of it: press “Connect” in ${where} and confirm in the browser.`,
  // tools that changed
  toolsUpdated: (label: string, n: number, first: string) =>
    `${label} updated ${n === 1 ? `the tool “${first}”` : `${n} tools`}: they are already on.`,
  toolsPaused: (label: string, n: number, change: 'new' | 'changed', first: string) =>
    n === 1
      ? `${label} has ${change === 'new' ? 'a new tool' : 'a changed tool'} “${first}”: it stays paused until you accept it.`
      : `${label} has ${n} new or changed tools: they stay paused until you accept them.`,
  toolsAccepted: (n: number, first: string, label: string, telegram: boolean) =>
    `You accepted ${n === 1 ? `“${first}”` : `${n} tools`} of ${label}${telegram ? ' (from Telegram)' : ''}.`,
  toolsLimited: (name: string, max: number, total: number) =>
    `${name} gets ${max} of the ${total} tools from other apps (the most its model can take): the rest stay out of its work, and it knows.`,
  skippedUnsafe: 'runs code on the computer without limits: left out of Monsters’ browser',
  skippedPaused: 'new or changed: paused until you accept it',
  // errors of the API
  unknownServer: (name: string) => `There is no server “${name}”.`,
  unknownAgent: (id: string) => `There is no monster “${id}” in the squad.`,
  secretsUnreadable: (name: string) =>
    `The secrets of the server “${name}” can’t be read (keychain unreachable or file damaged): the server stays off. Enter them again from the panel.`,
  invalidName:
    'The name can only have lowercase letters, digits and hyphens (24 at most), and must start with a letter.',
  browserNameTaken: '“browser” is the name of Monsters’ browser: pick another one.',
  browserNameOnly: 'The browser only turns on with the name “browser”.',
  oauthWebOnly: 'OAuth sign-in only works for services on the web.',
  commandMissing: 'Type the command that starts the server.',
  urlFull: 'Type the full address, for example https://example.com/mcp.',
  urlScheme: 'The address must start with https:// or http://.',
  urlCredentials: 'Put the user name and password in the headers, not in the address.',
  missingValue: (kind: 'variable' | 'header', name: string) =>
    `The value of the ${kind} ${name} is missing.`,
  notOauth: 'This app doesn’t use OAuth sign-in.',
  wentWrong: 'Something went wrong: try again.',
  removedMeanwhile: 'That app was removed in the meantime.',
  connected: (label: string) => `${label} is connected.`,
  // why a server did not start
  halted: 'The monsters are stopped: press “Resume” and try again.',
  programMissingNeeds: (command: string, needs: string, url: string) =>
    `I can’t find the program “${command}”: it’s part of ${needs}, which has to be installed on the computer (${url}). Then try again.`,
  programMissing: (command: string) =>
    `I can’t find the program “${command}”: check that it’s installed and spelled right.`,
  noPermission: (command: string) => `I can’t start “${command}”: permissions are missing.`,
  noMcpHere: 'There is no MCP server at this address (response 404).',
  serverError: (status: number) => `The server answered with an error (${status}).`,
  noServerAt: (url: string) => `No server answers at ${url}.`,
  timedOut: (tail: string) => `The server didn’t answer in time${tail ? `: ${tail}` : '.'}`,
  closedAtOnce: (tail: string) => `The server closed right away${tail ? `: ${tail}` : '.'}`,
  cantConnect: (name: string, message: string, tail: string) =>
    `I can’t connect to “${name}”: ${message}${tail ? ` (${tail})` : ''}`,
  // the sign-in's answers
  oauthPrepare: (detail: string) =>
    `I couldn’t set up the sign-in: the service doesn’t accept sign-ins from other apps or isn’t answering (${detail}).`,
  oauthUnsafePage: 'The service gave an unsafe sign-in page: I’m stopping.',
  oauthExpired:
    'This sign-in is no longer valid (expired or already used): try again from Monsters.',
  oauthDenied: 'You refused the sign-in: nothing was connected.',
  oauthRefused: (code: string) => `The service refused the sign-in (${code}).`,
  oauthNoCode: 'The service didn’t send the sign-in code.',
  oauthNotAccepted: (detail: string) =>
    `The service didn’t accept the sign-in (${detail}): try again from Monsters.`,
  // the input schema of a tool
  schemaNotObject: 'the arguments’ schema isn’t a JSON object',
  schemaNotJson: 'the arguments’ schema isn’t JSON',
  schemaTooLarge: 'the arguments’ schema is too large',
  schemaTooDeep: 'the arguments’ schema is nested too deep',
  argsNotObject: 'the arguments aren’t an object',
  schemaExternalRefs: 'the schema points to external files',
  schemaInvalid: (detail: string) => `the arguments’ schema isn’t valid (${detail})`,
  // installs
  npmNeeded:
    'installing the browser needs npm: install Node.js (with npm) from https://nodejs.org and try again',
  uvNeeded: (url: string) => `installing the server needs uv: install it from ${url} and try again`,
  installOf: (pkg: string) => pkg,
  installOfBrowser: 'the browser',
  installFailed: (what: string, message: string) => `installing ${what} failed: ${message}`,
  installFailedCode: (what: string, tool: string, code: number | null, tail: string) =>
    `installing ${what} failed (${tool} ${code})${tail ? `: ${tail}` : ''}`,
  notExpected: (pkg: string) => `the installed package ${pkg} isn’t the expected one`,
};

const it: typeof en = {
  signInNeeded: 'Serve l’accesso: premi “Collega” e conferma nel browser.',
  oauthUnreachable:
    'Servizio non raggiungibile: non riesco a rinnovare l’accesso (l’accesso resta valido). Riprovo alla prossima chiamata.',
  headersRefused:
    'Il server ha rifiutato l’accesso: controlla le intestazioni (per esempio il token).',
  signInAskedAgain: (label, where) =>
    `${label} chiede di nuovo l’accesso: premi «Collega» in ${where}.`,
  moreScope: (label, where) =>
    `${label} chiede un permesso in più per quello che i mostri gli chiedono: premi «Collega» in ${where} e conferma nel browser.`,
  toolsUpdated: (label, n, first) =>
    `${label} ha aggiornato ${n === 1 ? `lo strumento «${first}»` : `${n} strumenti`}: sono già attivi.`,
  toolsPaused: (label, n, change, first) =>
    n === 1
      ? `${label} ha ${change === 'new' ? 'uno strumento nuovo' : 'cambiato lo strumento'} «${first}»: resta in pausa finché non lo accetti.`
      : `${label} ha ${n} strumenti nuovi o cambiati: restano in pausa finché non li accetti.`,
  toolsAccepted: (n, first, label, telegram) =>
    `Hai accettato ${n === 1 ? `«${first}»` : `${n} strumenti`} di ${label}${telegram ? ' (da Telegram)' : ''}.`,
  toolsLimited: (name, max, total) =>
    `${name} riceve ${max} strumenti di altri programmi su ${total} (il massimo per il suo modello): gli altri restano fuori dai suoi lavori, e lui lo sa.`,
  skippedUnsafe: 'esegue codice sul computer senza limiti: escluso dal browser di Monsters',
  skippedPaused: 'nuovo o cambiato: in pausa finché non lo accetti',
  unknownServer: (name) => `Non c’è nessun server “${name}”.`,
  unknownAgent: (id) => `Non c’è nessun mostro “${id}” nella squadra.`,
  secretsUnreadable: (name) =>
    `I segreti del server “${name}” non si leggono (portachiavi non raggiungibile o file rovinato): il server resta spento. Reinseriscili dal pannello.`,
  invalidName:
    'Il nome può avere solo lettere minuscole, cifre e trattini (al massimo 24), e deve iniziare con una lettera.',
  browserNameTaken: '“browser” è il nome del browser di Monsters: scegline un altro.',
  browserNameOnly: 'Il browser si attiva solo con il nome “browser”.',
  oauthWebOnly: 'L’accesso con OAuth vale solo per i servizi sul web.',
  commandMissing: 'Scrivi il comando che avvia il server.',
  urlFull: 'Scrivi l’indirizzo completo, per esempio https://esempio.it/mcp.',
  urlScheme: 'L’indirizzo deve iniziare con https:// o http://.',
  urlCredentials: 'Metti nome utente e password nelle intestazioni, non nell’indirizzo.',
  missingValue: (kind, name) =>
    `Manca il valore di ${kind === 'variable' ? 'la variabile' : 'l’intestazione'} ${name}.`,
  notOauth: 'Questo programma non usa l’accesso con OAuth.',
  wentWrong: 'Qualcosa è andato storto: riprova.',
  removedMeanwhile: 'Il programma è stato tolto nel frattempo.',
  connected: (label) => `${label} è collegato.`,
  halted: 'I mostri sono fermi: premi “Riprendi” e riprova.',
  programMissingNeeds: (command, needs, url) =>
    `Non trovo il programma “${command}”: fa parte di ${needs}, che va installato sul computer (${url}). Poi riprova.`,
  programMissing: (command) =>
    `Non trovo il programma “${command}”: controlla che sia installato e scritto bene.`,
  noPermission: (command) => `Non posso avviare “${command}”: mancano i permessi.`,
  noMcpHere: 'A questo indirizzo non c’è un server MCP (risposta 404).',
  serverError: (status) => `Il server ha risposto con un errore (${status}).`,
  noServerAt: (url) => `Nessun server risponde a ${url}.`,
  timedOut: (tail) => `Il server non ha risposto in tempo${tail ? `: ${tail}` : '.'}`,
  closedAtOnce: (tail) => `Il server si è chiuso subito${tail ? `: ${tail}` : '.'}`,
  cantConnect: (name, message, tail) =>
    `Non riesco a collegarmi a “${name}”: ${message}${tail ? ` (${tail})` : ''}`,
  oauthPrepare: (detail) =>
    `Non riesco a preparare l’accesso: il servizio non accetta l’accesso da altre app o non risponde (${detail}).`,
  oauthUnsafePage: 'Il servizio ha dato una pagina di accesso non sicura: mi fermo.',
  oauthExpired: 'Questo accesso non è più valido (scaduto o già usato): riprova da Monsters.',
  oauthDenied: 'Hai rifiutato l’accesso: niente di collegato.',
  oauthRefused: (code) => `Il servizio ha rifiutato l’accesso (${code}).`,
  oauthNoCode: 'Il servizio non ha mandato il codice di accesso.',
  oauthNotAccepted: (detail) =>
    `Il servizio non ha accettato l’accesso (${detail}): riprova da Monsters.`,
  schemaNotObject: 'lo schema degli argomenti non è un oggetto JSON',
  schemaNotJson: 'lo schema degli argomenti non è JSON',
  schemaTooLarge: 'lo schema degli argomenti è troppo grande',
  schemaTooDeep: 'lo schema degli argomenti è troppo annidato',
  argsNotObject: 'gli argomenti non sono un oggetto',
  schemaExternalRefs: 'lo schema rimanda a file esterni',
  schemaInvalid: (detail) => `lo schema degli argomenti non è valido (${detail})`,
  npmNeeded:
    'per installare il browser serve npm: installa Node.js (con npm) da https://nodejs.org e riprova',
  uvNeeded: (url) => `per installare il server serve uv: installalo da ${url} e riprova`,
  installOf: (pkg) => `di ${pkg}`,
  installOfBrowser: 'del browser',
  installFailed: (what, message) => `installazione ${what} non riuscita: ${message}`,
  installFailedCode: (what, tool, code, tail) =>
    `installazione ${what} non riuscita (${tool} ${code})${tail ? `: ${tail}` : ''}`,
  notExpected: (pkg) => `il pacchetto ${pkg} installato non è quello atteso`,
};

export const mcpStrings = () => pick({ en, it });
