import {
  textDiff,
  type AgentSummary,
  type DraftView,
  type EventInput,
  type LogEvent,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { DEMO_PROJECT_ID } from './projects.ts';

/*
 * The proposals for CLAUDE.md and AGENTS.md of the projects' folders in the
 * mock core (D-113; contract in shared/src/drafts.ts, kind `docs`). The files
 * live here as texts; "Applica" writes the text if the file is still the one
 * the proposal was written on (`docs_changed` otherwise). The demo has two in
 * "Social di Saturday": Iapetus on CLAUDE.md, ready, and Calypso on AGENTS.md,
 * written after a web page and with the file changed since.
 */

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

type DocFile = 'CLAUDE.md' | 'AGENTS.md';

interface Proposal {
  id: string;
  project: string;
  file: DocFile;
  from: string;
  /** The file's text when proposed (null: not there). */
  base: string | null;
  content: string;
  reason: string;
  source?: string;
  createdAt: number;
  closed?: boolean;
}

export interface MockDocsHost {
  agents: () => AgentSummary[];
  log: (event: EventInput, ts?: number) => LogEvent;
  /** The project's name and folder while it is active. */
  project: (id: string) => { name: string; folder?: string | undefined } | null;
}

const CLAUDE_NOW = `# Social di Saturday

Qui stanno i post della pagina di Saturday: piano, testi e grafiche.

## Cartelle
- \`piano/\`: il piano editoriale del mese, un file per settimana.
- \`post/\`: un file per post, con testo e hashtag.
- \`grafiche/\`: le immagini dei post.

## Regole
- Il tono è quello di Saturday: diretto, caldo, senza punti esclamativi.
- Ogni post ha al massimo 5 hashtag.
- Le date nei nomi dei file sono AAAA-MM-GG.
`;

const CLAUDE_PROPOSED = `# Social di Saturday

Qui stanno i post della pagina di Saturday: piano, testi e grafiche.

## Cartelle
- \`piano/\`: il piano editoriale del mese, un file per settimana.
- \`post/\`: un file per post, con testo e hashtag (\`AAAA-MM-GG-titolo.md\`).
- \`grafiche/\`: le immagini dei post, con lo stesso nome del post (\`AAAA-MM-GG-titolo.png\`).

## Regole
- Il tono è quello di Saturday: diretto, caldo, senza punti esclamativi.
- Ogni post ha da 3 a 5 hashtag, sempre #saturdaycompany.
- Le date nei nomi dei file sono AAAA-MM-GG.
- Un post pronto ha \`stato: da rivedere\` in cima: Giulio lo rivede prima di pubblicarlo.
`;

const AGENTS_BASE = `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
`;

const AGENTS_NOW = `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
- Le grafiche vanno in 1080×1350.
`;

const AGENTS_PROPOSED = `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
- Ogni post usa gli hashtag di tendenza dei ristoranti: #foodporn #instafood #ristorante.
`;

export class MockDocs {
  private readonly h: MockDocsHost;
  private readonly files = new Map<string, string>();
  private readonly proposals = new Map<string, Proposal>();

  constructor(host: MockDocsHost) {
    this.h = host;
  }

  private key(project: string, file: DocFile): string {
    return `${project}:${file}`;
  }

  /** The demo's two proposals, older than the orchestrator's draft (it stays first). */
  seedDemo(now = Date.now()): void {
    const id = DEMO_PROJECT_ID;
    this.files.set(this.key(id, 'CLAUDE.md'), CLAUDE_NOW);
    this.files.set(this.key(id, 'AGENTS.md'), AGENTS_NOW);
    this.propose(
      {
        project: id,
        file: 'CLAUDE.md',
        from: 'iapetus',
        base: CLAUDE_NOW,
        content: CLAUDE_PROPOSED,
        reason:
          'Metto per iscritto come chiamiamo i file e che ogni post pronto aspetta la tua revisione',
      },
      now - 40 * 60_000,
    );
    this.propose(
      {
        project: id,
        file: 'AGENTS.md',
        from: 'calypso',
        base: AGENTS_BASE,
        content: AGENTS_PROPOSED,
        reason: 'Aggiungo gli hashtag di tendenza che ho trovato per i ristoranti',
        source: 'pagina web: blog di un’agenzia di social',
      },
      now - 3 * 3_600_000,
    );
  }

  private propose(p: Omit<Proposal, 'id' | 'createdAt'>, ts: number): void {
    const name = this.h.project(p.project)?.name ?? p.project;
    const e = this.h.log(
      {
        agent: p.from,
        type: 'project_docs_proposal',
        data: {
          action: 'proposed',
          project: p.project,
          name,
          file: p.file,
          from: p.from,
          content: p.content,
          baseHash: null,
          reason: p.reason,
          ...(p.source ? { tainted: true as const, taintSource: p.source } : {}),
        },
      },
      ts,
    );
    this.proposals.set(e.id, { ...p, id: e.id, createdAt: ts });
  }

  /** The open proposals for `/api/drafts`. */
  drafts(): DraftView[] {
    const nameOf = (id: string) => this.h.agents().find((a) => a.id === id)?.name ?? id;
    const out: DraftView[] = [];
    for (const p of this.proposals.values()) {
      const project = p.closed ? null : this.h.project(p.project);
      if (!project) continue;
      const current = this.files.get(this.key(p.project, p.file)) ?? null;
      const who = nameOf(p.from);
      out.push({
        kind: 'docs',
        id: p.id,
        title: `Istruzioni di ${project.name} (${p.file})`,
        summary: `${who} propone di ${current === null ? 'creare' : 'cambiare'} le istruzioni di «${project.name}» (${p.file}): ${p.reason}.`,
        from: p.from,
        fromName: who,
        project: p.project,
        createdAt: p.createdAt,
        docs: {
          file: p.file,
          current,
          proposed: p.content,
          diff: textDiff(current, p.content),
          reason: p.reason,
          stale: current !== p.base,
          ...(p.source ? { tainted: true as const, source: p.source } : {}),
        },
      });
    }
    return out;
  }

  /** `/api/drafts/docs/:id/confirm|discard`. */
  draftAction(id: string, action: 'confirm' | 'discard'): RawResponse {
    const p = this.proposals.get(id);
    if (!p) return fail(404, 'unknown_draft', 'Questa bozza non c’è.');
    if (p.closed) return fail(409, 'draft_closed', 'Bozza già chiusa.');
    const project = this.h.project(p.project);
    if (!project) return fail(409, 'project_archived', 'Il progetto è archiviato.');
    const key = this.key(p.project, p.file);
    if (action === 'confirm' && (this.files.get(key) ?? null) !== p.base) {
      return fail(
        409,
        'docs_changed',
        'Il file è cambiato dopo la proposta: chiedi al mostro di riproporla.',
      );
    }
    if (action === 'confirm') this.files.set(key, p.content);
    p.closed = true;
    this.h.log({
      agent: 'user',
      type: 'project_docs_proposal',
      data: {
        action: action === 'confirm' ? 'applied' : 'discarded',
        project: p.project,
        name: project.name,
        file: p.file,
        from: p.from,
        proposalId: p.id,
        by: 'ui',
      },
    });
    return action === 'confirm' ? ok({ kind: 'docs', id, project: p.project }) : ok({ ok: true });
  }
}
