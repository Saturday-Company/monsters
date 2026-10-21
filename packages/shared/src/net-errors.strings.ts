import { pick } from './i18n.ts';

/** Why a request never got an answer, in words the user can act on (D-153). */
const en = {
  causeDns: 'the name doesn’t resolve (you’re offline, or the network blocks it)',
  causeRefused: 'the connection was refused or dropped',
  causeTimeout: 'no answer in time',
  causeTls:
    'the connection is intercepted by a program on the network (VPN, corporate proxy or antivirus) that Monsters doesn’t trust',
  causeProxy: 'the network proxy won’t let it through',
  causeUnknown: (code?: string) => (code ? `network error (${code})` : 'network error'),
  hintUnknown: 'Check your connection and try again.',
  hintVpn: (host: string) =>
    `If you’re on a VPN or behind a corporate proxy, try without it or ask for ${host} to be allowed.`,
  dns: (host: string) =>
    `This computer can’t find ${host}: you’re offline, or the network blocks the name.`,
  refused: (host: string) => `The connection to ${host} was refused or dropped.`,
  timeout: (host: string) => `${host} didn’t answer in time.`,
  tls: (host: string) =>
    `The connection to ${host} is intercepted by a program on the network (VPN, corporate proxy or antivirus) that Monsters doesn’t trust.`,
  proxy: (host: string) => `The network proxy won’t let the connection to ${host} through.`,
  unknown: (host: string, code?: string) => `I can’t reach ${host}${code ? ` (${code})` : ''}.`,
};

const it: typeof en = {
  causeDns: 'il nome non si risolve (sei offline, o la rete lo blocca)',
  causeRefused: 'la connessione è stata rifiutata o interrotta',
  causeTimeout: 'nessuna risposta in tempo',
  causeTls:
    'la connessione è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce',
  causeProxy: 'il proxy della rete non la lascia passare',
  causeUnknown: (code) => (code ? `errore di rete (${code})` : 'errore di rete'),
  hintUnknown: 'Controlla la connessione e riprova.',
  hintVpn: (host) =>
    `Se sei in VPN o dietro un proxy aziendale, prova senza o chiedi di consentire ${host}.`,
  dns: (host) => `Il computer non trova ${host}: sei offline, o la rete blocca il nome.`,
  refused: (host) => `La connessione a ${host} è stata rifiutata o interrotta.`,
  timeout: (host) => `${host} non ha risposto in tempo.`,
  tls: (host) =>
    `La connessione a ${host} è intercettata da un programma della rete (VPN, proxy aziendale o antivirus) che Monsters non riconosce.`,
  proxy: (host) => `Il proxy della rete non lascia passare la connessione a ${host}.`,
  unknown: (host, code) => `Non riesco a raggiungere ${host}${code ? ` (${code})` : ''}.`,
};

export const netErrorStrings = () => pick({ en, it });
