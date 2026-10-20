/*
 * A fake Anteiku (D-075): the MCP server of Saturday's gestionale as the real
 * one behaves (`anteiku/lib/mcp`, `lib/oauth`), on 127.0.0.1, never the real
 * service. Stateless Streamable HTTP, POST only (GET and DELETE are 405), an
 * `Origin` that is not ours nor loopback is 403, every request needs a bearer
 * (an OAuth access token or a personal `anteiku_pat_…`), and without one the
 * 401 points to the protected resource metadata with `scope="anteiku"`.
 * OAuth 2.1: discovery (RFC 9728, RFC 8414), dynamic registration at
 * `/oauth/registra`, consent at `/oauth/autorizza` (given at once here),
 * `/oauth/token` with PKCE S256 and rotating refresh tokens, `/oauth/revoca`.
 *
 * The 124 tools are those of the real catalog (122 operations named
 * `anteiku_<area>_<verbo>`, plus `search` and `fetch`), with the same hints:
 * writes `readOnlyHint: false`, `elimina|archivia|cestina|togli_*|segna_pagato`
 * `destructiveHint: true`. A small company lives behind them (40 clients,
 * their projects and tasks) with long notes, so lists are long tool results.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/** The public operations of Anteiku's catalog (16/10/2026, `lib/operazioni`, not `interna`). */
export const ANTEIKU_OPERATIONS =
  `agenda.intervallo automazioni.aggiorna automazioni.archivia automazioni.attiva automazioni.crea automazioni.decidi automazioni.elenca automazioni.leggi automazioni.proposte azienda.leggi catalogo.aggiorna catalogo.crea catalogo.elenca centralino.aziende clienti.aggiorna clienti.archivia clienti.crea clienti.elenca clienti.leggi commenti.aggiungi contatti.aggiorna contatti.aggiungi diario.decidi diario.elenca diario.modifica diario.scrivi documenti.cerca documenti.crea_cartella documenti.elenca eventi.aggiorna eventi.crea eventi.elenca eventi.leggi moduli.elenca notifiche.conta notifiche.elenca novita.elenca novita.segna_viste oggi.riepilogo ore.consuntivo ore.decidi ore.elimina ore.margini ore.modifica ore.registra pagamenti.aggiorna pagamenti.crea pagamenti.elenca pagamenti.leggi pagamenti.segna_pagato pagine.aggiorna pagine.archivia pagine.crea pagine.elenca pagine.leggi persone.elenca preventivi.aggiorna preventivi.aggiorna_calcolo preventivi.aggiorna_scenario preventivi.aggiorna_sconto preventivi.aggiorna_voce preventivi.aggiungi_scenario preventivi.aggiungi_sconto preventivi.aggiungi_voce preventivi.applica_calcolo preventivi.archivia preventivi.crea preventivi.documento preventivi.duplica preventivi.elenca preventivi.elimina preventivi.esito preventivi.leggi preventivi.ordina preventivi.rate preventivi.riapri preventivi.segna_inviato preventivi.stima preventivi.togli_scenario preventivi.togli_sconto preventivi.togli_voce prezzi.leggi prezzi.salva_modello prodotti.collegati prodotti.ticket progetti.aggiorna progetti.archivia progetti.crea progetti.elenca progetti.leggi ricorrenti.aggiorna ricorrenti.crea ricorrenti.elenca ricorrenti.leggi riunioni.aggiungi_nota riunioni.approva_report riunioni.chiudi riunioni.decidi riunioni.discuti riunioni.elenca riunioni.inizia riunioni.leggi riunioni.odg_aggiorna riunioni.odg_aggiungi riunioni.odg_togli riunioni.riapri servizi.aggiorna servizi.aggiungi servizi.elenca task.aggiorna task.aggiorna_punto task.aggiungi_punto task.archivia task.commenta task.crea task.elenca task.leggi task.segna_parte task.sposta task.togli_punto timer.avvia timer.ferma`.split(
    ' ',
  );

export const anteikuToolName = (op: string) => `anteiku_${op.replace(/\./g, '_')}`;

/** As in Anteiku: operations that only read (the others write in the gestionale). */
const READS =
  /\.(elenca|leggi|cerca|conta|riepilogo|consuntivo|margini|intervallo|proposte|aziende|collegati|ticket|stima|documento|rate)$/;
const DESTRUCTIVE = /\.(elimina|archivia|cestina|togli_\w+|segna_pagato)$/;

const AREA: Record<string, string> = {
  agenda: 'l’agenda (eventi e scadenze)',
  automazioni: 'le automazioni',
  azienda: 'l’azienda',
  catalogo: 'il catalogo dei servizi',
  centralino: 'il centralino dell’azienda',
  clienti: 'i clienti',
  commenti: 'i commenti',
  contatti: 'i contatti dei clienti',
  diario: 'il diario di lavoro',
  documenti: 'i documenti',
  eventi: 'gli eventi dell’agenda',
  moduli: 'i moduli attivi',
  notifiche: 'le notifiche',
  novita: 'le novità di Anteiku',
  oggi: 'la giornata di oggi',
  ore: 'le ore lavorate',
  pagamenti: 'i pagamenti (incassi e scadenze)',
  pagine: 'le pagine (wiki interna)',
  persone: 'le persone del team',
  preventivi: 'i preventivi',
  prezzi: 'il listino prezzi',
  prodotti: 'i prodotti Saturday collegati',
  progetti: 'i progetti',
  ricorrenti: 'le attività ricorrenti',
  riunioni: 'le riunioni e i verbali',
  servizi: 'i servizi di un cliente',
  task: 'le task (con checklist)',
  timer: 'il timer delle ore',
};

const VERB: Record<string, string> = {
  elenca:
    'Elenca {a}, con filtri per testo e stato, a pagine. Restituisce id, nome e i campi principali di ogni elemento',
  leggi: 'Legge la scheda completa di un elemento ({a}) dato il suo id, con i collegamenti',
  crea: 'Crea un nuovo elemento ({a}) con i campi indicati e restituisce il suo id',
  aggiorna: 'Aggiorna i campi indicati di un elemento ({a}); gli altri restano come sono',
  archivia: 'Archivia un elemento ({a}): non si cancella, sparisce dagli elenchi e si può riaprire',
  elimina: 'Elimina un elemento ({a}). Solo le bozze mai inviate si cancellano davvero',
  aggiungi: 'Aggiunge un elemento ({a})',
  modifica: 'Modifica un elemento ({a})',
};

function describe(op: string): string {
  const [area, verb] = op.split('.') as [string, string];
  const a = AREA[area] ?? area;
  const base =
    VERB[verb]?.replace('{a}', a) ??
    `Operazione «${verb.replace(/_/g, ' ')}» su ${a}: vedi i campi per gli argomenti`;
  return READS.test(op)
    ? `${base}.`
    : `${base}. Scrive nel gestionale a nome tuo (resta nelle attività di Anteiku).`;
}

const ID = z.uuid().describe('L’id dell’elemento (uuid)');
const CHIAVE = z
  .string()
  .min(8)
  .max(200)
  .optional()
  .describe(
    'Facoltativa. Una chiave di idempotenza scelta da te (8-200 caratteri, per esempio un UUID): se ripeti la chiamata con la stessa chiave, Anteiku restituisce il risultato della prima volta invece di rifarla.',
  );

function inputOf(op: string): z.ZodObject {
  const [area, verb] = op.split('.') as [string, string];
  if (verb === 'elenca' || verb === 'cerca') {
    return z.object({
      testo: z.string().max(100).optional().describe('Testo da cercare nel nome e nelle note'),
      stato: z.enum(['attivo', 'archiviato', 'tutti']).optional().describe('Quali mostrare'),
      ...(area === 'progetti'
        ? { cliente_id: ID.optional().describe('Solo di questo cliente') }
        : {}),
      ...(area === 'task'
        ? { progetto_id: ID.optional().describe('Solo di questo progetto') }
        : {}),
      pagina: z.number().int().min(1).optional().describe('Pagina, da 1'),
      per_pagina: z.number().int().min(1).max(100).optional().describe('Elementi per pagina'),
    });
  }
  if (verb === 'leggi' || READS.test(op)) return z.object({ id: ID.optional() });
  if (op === 'task.crea') {
    return z.object({
      titolo: z.string().min(1).max(200).describe('Il titolo della task'),
      progetto_id: ID.describe('Il progetto della task'),
      descrizione: z.string().max(4000).optional().describe('Dettagli, in Markdown'),
      scadenza: z.iso.date().optional().describe('Data di scadenza (AAAA-MM-GG)'),
      priorita: z.enum(['bassa', 'media', 'alta']).optional(),
      assegnatari: z.array(z.string().email()).optional().describe('Email delle persone'),
      checklist: z.array(z.string().max(200)).optional().describe('Punti della checklist'),
      chiave: CHIAVE,
    });
  }
  if (verb === 'crea' || verb.startsWith('aggiungi')) {
    return z.object({
      nome: z.string().min(1).max(200).describe('Nome o titolo'),
      descrizione: z.string().max(4000).optional(),
      cliente_id: ID.optional(),
      progetto_id: ID.optional(),
      chiave: CHIAVE,
    });
  }
  if (verb.startsWith('aggiorna') || verb === 'modifica') {
    return z.object({
      id: ID,
      nome: z.string().max(200).optional(),
      descrizione: z.string().max(4000).optional(),
      stato: z.string().max(40).optional(),
      chiave: CHIAVE,
    });
  }
  return z.object({ id: ID, nota: z.string().max(1000).optional(), chiave: CHIAVE });
}

// --- the company ------------------------------------------------------------------------

const uuid = (kind: number, n: number) =>
  `00000000-0000-4000-8${kind}00-${n.toString().padStart(12, '0')}`;
const CITIES = ['Milano', 'Torino', 'Bologna', 'Firenze', 'Roma', 'Napoli', 'Bari', 'Verona'];
const SECTORS = ['arredamento', 'ristorazione', 'logistica', 'moda', 'editoria', 'turismo'];
const SURNAMES =
  `Rossi Bianchi Verdi Russo Ferrari Esposito Romano Colombo Ricci Marino Greco Bruno Gallo Conti De_Luca Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone Longo Gentile Martinelli Vitale Lombardo Serra Coppola De_Santis DAngelo`.split(
    ' ',
  );

const note = (seed: number, words: number) =>
  Array.from(
    { length: words },
    (_, i) =>
      [
        'incontro',
        'preventivo',
        'consegna',
        'revisione',
        'grafica',
        'sito',
        'fattura',
        'chiamata',
        'riunione',
        'campagna',
      ][(seed * 7 + i * 3) % 10],
  ).join(' ');

export const ANTEIKU_DATA = (() => {
  const clienti = SURNAMES.map((s, i) => ({
    id: uuid(1, i + 1),
    nome: `${s.replace('_', ' ')} ${SECTORS[i % SECTORS.length]![0]!.toUpperCase()}${SECTORS[i % SECTORS.length]!.slice(1)} s.r.l.`,
    piva: `IT0${(1234567890 + i * 7919).toString().slice(0, 10)}`,
    citta: CITIES[i % CITIES.length],
    stato: i % 9 === 8 ? 'archiviato' : 'attivo',
    prossimo_passo: `Sentire ${s.replace('_', ' ')} per ${note(i, 3)}`,
    note: `Cliente dal ${2019 + (i % 6)}. ${note(i, 40)}.`,
  }));
  const progetti = clienti.flatMap((c, i) =>
    [0, 1].map((k) => ({
      id: uuid(2, i * 2 + k + 1),
      cliente_id: c.id,
      nome: `${k === 0 ? 'Sito web' : 'Campagna social'} ${c.nome.split(' ')[0]}`,
      stato: 'attivo',
      descrizione: `${note(i + k, 50)}.`,
    })),
  );
  const tasks = progetti.flatMap((p, i) =>
    [0, 1].map((k) => ({
      id: uuid(3, i * 2 + k + 1),
      progetto_id: p.id,
      titolo: `${k === 0 ? 'Bozza' : 'Revisione'} ${p.nome}`,
      stato: k === 0 ? 'da fare' : 'in corso',
      scadenza: `2026-11-${String((i % 27) + 1).padStart(2, '0')}`,
      descrizione: `${note(i * 3 + k, 30)}.`,
    })),
  );
  return { clienti, progetti, tasks };
})();

export interface AnteikuCall {
  tool: string;
  args: Record<string, unknown>;
}

function run(op: string, args: Record<string, unknown>): unknown {
  const { clienti, progetti, tasks } = ANTEIKU_DATA;
  const text = typeof args['testo'] === 'string' ? args['testo'].toLowerCase() : '';
  const match = (o: { nome?: string; titolo?: string; note?: string; descrizione?: string }) =>
    !text ||
    `${o.nome ?? o.titolo ?? ''} ${o.note ?? o.descrizione ?? ''}`.toLowerCase().includes(text);
  switch (op) {
    case 'clienti.elenca':
      return { elementi: clienti.filter(match), totale: clienti.length };
    case 'clienti.leggi': {
      const c = clienti.find((x) => x.id === args['id']);
      if (!c) throw new Error('Cliente non trovato');
      return { ...c, progetti: progetti.filter((p) => p.cliente_id === c.id) };
    }
    case 'progetti.elenca':
      return {
        elementi: progetti.filter(
          (p) => match(p) && (!args['cliente_id'] || p.cliente_id === args['cliente_id']),
        ),
      };
    case 'progetti.leggi': {
      const p = progetti.find((x) => x.id === args['id']);
      if (!p) throw new Error('Progetto non trovato');
      return { ...p, task: tasks.filter((t) => t.progetto_id === p.id) };
    }
    case 'task.elenca':
      return {
        elementi: tasks.filter(
          (t) => match(t) && (!args['progetto_id'] || t.progetto_id === args['progetto_id']),
        ),
      };
    case 'task.crea':
      if (!progetti.some((p) => p.id === args['progetto_id'])) {
        throw new Error('Progetto non trovato');
      }
      return { id: uuid(9, 1), titolo: args['titolo'], progetto_id: args['progetto_id'] };
    default:
      if (READS.test(`.${op.split('.')[1]}`)) return { elementi: [], totale: 0 };
      return { ok: true };
  }
}

/** The 122 operations as tool definitions (name, description, JSON schema, hints), for unit tests. */
export function anteikuToolDefs(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
}[] {
  return ANTEIKU_OPERATIONS.map((op) => {
    const schema = z.toJSONSchema(inputOf(op), { io: 'input' }) as Record<string, unknown>;
    delete schema['$schema'];
    return {
      name: anteikuToolName(op),
      description: describe(op),
      inputSchema: schema,
      readOnly: READS.test(op),
      destructive: !READS.test(op) && DESTRUCTIVE.test(op),
    };
  });
}

function anteikuServer(
  calls: AnteikuCall[],
  base: () => string,
  rewritten: ReadonlyMap<string, string>,
): McpServer {
  const server = new McpServer(
    { name: 'anteiku', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Anteiku è il gestionale di Prova: clienti, progetti, task. Per trovare un cliente usa search, poi la lettura completa.',
    },
  );
  const reply = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }],
  });
  const fail = (err: unknown) => ({
    content: [{ type: 'text' as const, text: (err as Error).message }],
    isError: true,
  });
  server.registerTool(
    'search',
    {
      title: 'Cerca in Anteiku',
      description:
        "Cerca in Anteiku, il gestionale dell'azienda: clienti (nome, P.IVA, note), contatti, progetti, task, pagine, preventivi, eventi dell'agenda (anche nei verbali) e pagamenti. Restituisce results con id, title e url (la scheda in Anteiku). Per leggere il contenuto completo di un risultato usa fetch con il suo id.",
      inputSchema: z.object({ query: z.string().min(1).max(100).describe('Il testo da cercare.') }),
      annotations: { title: 'Cerca in Anteiku', readOnlyHint: true, openWorldHint: false },
    },
    ({ query }: { query: string }) => {
      calls.push({ tool: 'search', args: { query } });
      const q = query.toLowerCase();
      const { clienti, progetti, tasks } = ANTEIKU_DATA;
      const results = [
        ...clienti
          .filter((c) => c.nome.toLowerCase().includes(q))
          .map((c) => ({ id: `cliente:${c.id}`, title: c.nome })),
        ...progetti
          .filter((p) => p.nome.toLowerCase().includes(q))
          .map((p) => ({ id: `progetto:${p.id}`, title: p.nome })),
        ...tasks
          .filter((t) => t.titolo.toLowerCase().includes(q))
          .map((t) => ({ id: `task:${t.id}`, title: t.titolo })),
      ].map((r) => ({ ...r, url: `${base()}/${r.id.replace(':', '/')}` }));
      return reply({ results: results.slice(0, 20) });
    },
  );
  server.registerTool(
    'fetch',
    {
      title: 'Apri un elemento di Anteiku',
      description:
        'Apre un risultato di search (id come «task:…», «cliente:…», «progetto:…») e restituisce id, title, text (la scheda completa, in JSON), url e metadata.',
      inputSchema: z.object({
        id: z.string().min(1).max(200).describe("L'id restituito da search."),
      }),
      annotations: {
        title: 'Apri un elemento di Anteiku',
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    ({ id }: { id: string }) => {
      calls.push({ tool: 'fetch', args: { id } });
      const [kind, raw] = id.split(':') as [string, string];
      const op = kind === 'cliente' ? 'clienti.leggi' : kind === 'progetto' ? 'progetti.leggi' : '';
      try {
        const value = op ? run(op, { id: raw }) : { id };
        return reply({
          id,
          title: id,
          text: JSON.stringify(value),
          url: `${base()}/${kind}/${raw}`,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
  for (const op of ANTEIKU_OPERATIONS) {
    const name = anteikuToolName(op);
    const writes = !READS.test(op);
    server.registerTool(
      name,
      {
        title: op,
        description: rewritten.get(name) ?? describe(op),
        inputSchema: inputOf(op),
        annotations: writes
          ? { readOnlyHint: false, destructiveHint: DESTRUCTIVE.test(op), openWorldHint: false }
          : { readOnlyHint: true, openWorldHint: false },
      },
      (args: Record<string, unknown>) => {
        calls.push({ tool: name, args });
        try {
          return reply(run(op, args));
        } catch (err) {
          return fail(err);
        }
      },
    );
  }
  return server;
}

export interface FakeAnteiku {
  base: string;
  mcpUrl: string;
  /** A personal token Anteiku accepts (`Authorization: Bearer anteiku_pat_…`). */
  personalToken: string;
  /** Tool calls, in order. */
  calls: AnteikuCall[];
  /** The server rewrites the description of a tool (a "rug pull", D-070). */
  rewrite(tool: string, description: string): void;
  /** `Origin` of every request to `/mcp` (null when absent). */
  origins: (string | null)[];
  registrations: { client_id: string; redirect_uris: string[]; scope?: string }[];
  /** Scope and resource asked at the authorization endpoint. */
  authorizations: { scope: string | null; resource: string | null }[];
  grants: string[];
  revoked: string[];
  close(): Promise<void>;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const LOOPBACK_REDIRECT = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?\//;
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export async function startFakeAnteiku(): Promise<FakeAnteiku> {
  let base = '';
  const calls: AnteikuCall[] = [];
  const rewritten = new Map<string, string>();
  const handler = createMcpHandler(() => anteikuServer(calls, () => base, rewritten));
  const personalToken = `anteiku_pat_${b64url(randomBytes(24))}`;
  const clients = new Map<string, string[]>();
  const codes = new Map<
    string,
    { clientId: string; challenge: string; redirectUri: string; resource: string | null }
  >();
  const valid = new Set<string>([personalToken]);
  const refreshValid = new Map<string, string>();
  const state: Omit<
    FakeAnteiku,
    'base' | 'mcpUrl' | 'personalToken' | 'calls' | 'rewrite' | 'close'
  > = {
    origins: [],
    registrations: [],
    authorizations: [],
    grants: [],
    revoked: [],
  };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const issue = (clientId: string) => {
    const access = `anteiku_at_${b64url(randomBytes(18))}`;
    const refresh = `anteiku_rt_${b64url(randomBytes(18))}`;
    valid.add(access);
    refreshValid.set(refresh, clientId);
    return json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: 'anteiku',
    });
  };

  const fetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (
      path === '/.well-known/oauth-protected-resource/mcp' ||
      path === '/.well-known/oauth-protected-resource'
    ) {
      return json({
        resource: path.endsWith('/mcp') ? `${base}/mcp` : base,
        authorization_servers: [base],
        scopes_supported: ['anteiku'],
        bearer_methods_supported: ['header'],
      });
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/autorizza`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/registra`,
        revocation_endpoint: `${base}/oauth/revoca`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['anteiku'],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (path === '/oauth/registra' && req.method === 'POST') {
      const meta = (await req.json()) as { redirect_uris: string[]; scope?: string };
      if (!meta.redirect_uris?.every((u) => LOOPBACK_REDIRECT.test(u))) {
        return json({ error: 'invalid_redirect_uri' }, 400);
      }
      const clientId = `anteiku_cli_${b64url(randomBytes(6))}`;
      clients.set(clientId, meta.redirect_uris);
      state.registrations.push({
        client_id: clientId,
        redirect_uris: meta.redirect_uris,
        ...(meta.scope ? { scope: meta.scope } : {}),
      });
      return json({ ...meta, client_id: clientId, client_id_issued_at: 1 }, 201);
    }
    if (path === '/oauth/autorizza') {
      const p = url.searchParams;
      const clientId = p.get('client_id') ?? '';
      const redirectUri = p.get('redirect_uri') ?? '';
      state.authorizations.push({ scope: p.get('scope'), resource: p.get('resource') });
      if (!clients.get(clientId)?.includes(redirectUri))
        return json({ error: 'bad redirect' }, 400);
      if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
        return json({ error: 'pkce required' }, 400);
      }
      const resource = p.get('resource');
      if (resource !== null && resource !== `${base}/mcp` && resource !== base) {
        return json({ error: 'invalid_target' }, 400);
      }
      const code = `anteiku_cod_${b64url(randomBytes(12))}`;
      codes.set(code, {
        clientId,
        challenge: p.get('code_challenge') ?? '',
        redirectUri,
        resource,
      });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state') ?? '');
      back.searchParams.set('iss', base);
      return new Response(null, { status: 302, headers: { location: back.href } });
    }
    if (path === '/oauth/token' && req.method === 'POST') {
      const p = new URLSearchParams(await req.text());
      const grant = p.get('grant_type') ?? '';
      state.grants.push(grant);
      if (grant === 'authorization_code') {
        const entry = codes.get(p.get('code') ?? '');
        codes.delete(p.get('code') ?? '');
        const challenge = b64url(
          createHash('sha256')
            .update(p.get('code_verifier') ?? '')
            .digest(),
        );
        if (
          !entry ||
          entry.clientId !== p.get('client_id') ||
          entry.redirectUri !== p.get('redirect_uri') ||
          entry.challenge !== challenge
        ) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return issue(entry.clientId);
      }
      if (grant === 'refresh_token') {
        const rt = p.get('refresh_token') ?? '';
        const clientId = refreshValid.get(rt);
        if (!clientId) return json({ error: 'invalid_grant' }, 400);
        refreshValid.delete(rt);
        return issue(clientId);
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (path === '/oauth/revoca' && req.method === 'POST') {
      const token = new URLSearchParams(await req.text()).get('token') ?? '';
      state.revoked.push(token);
      valid.delete(token);
      refreshValid.delete(token);
      return new Response(null, { status: 200 });
    }
    if (path === '/mcp') {
      const origin = req.headers.get('origin');
      state.origins.push(origin);
      // DNS rebinding: only no Origin (servers, the core), ours, or loopback.
      if (origin !== null && origin !== base && !LOOPBACK_ORIGIN.test(origin)) {
        return json({ error: 'origin not allowed' }, 403);
      }
      if (req.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
      if (!token || !valid.has(token)) {
        return json({ error: 'invalid_token' }, 401, {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="anteiku"`,
        });
      }
      return handler.fetch(req);
    }
    return json({ error: 'not found' }, 404);
  };

  const server = serve({
    fetch: fetchHandler,
    port: 0,
    hostname: '127.0.0.1',
    overrideGlobalObjects: false,
  });
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, {
    base,
    mcpUrl: `${base}/mcp`,
    personalToken,
    calls,
    rewrite: (tool: string, description: string) => void rewritten.set(tool, description),
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}
