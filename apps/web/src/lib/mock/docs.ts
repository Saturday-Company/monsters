import {
  textDiff,
  type AgentSummary,
  type DraftView,
  type EventInput,
  type LogEvent,
} from '@monsters/shared';
import type { RawResponse } from '../transport.ts';
import { tr } from './lang.ts';
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

const claudeNow = () =>
  tr(
    `# Saturday Social

This is where the posts of the Saturday page live: plan, copy and graphics.

## Folders
- \`plan/\`: the month's editorial plan, one file per week.
- \`posts/\`: one file per post, with copy and hashtags.
- \`graphics/\`: the images of the posts.

## Rules
- The tone is Saturday's: direct, warm, no exclamation marks.
- Every post has at most 5 hashtags.
- The dates in file names are YYYY-MM-DD.
`,
    `# Social di Saturday

Qui stanno i post della pagina di Saturday: piano, testi e grafiche.

## Cartelle
- \`piano/\`: il piano editoriale del mese, un file per settimana.
- \`post/\`: un file per post, con testo e hashtag.
- \`grafiche/\`: le immagini dei post.

## Regole
- Il tono è quello di Saturday: diretto, caldo, senza punti esclamativi.
- Ogni post ha al massimo 5 hashtag.
- Le date nei nomi dei file sono AAAA-MM-GG.
`,
  );

const claudeProposed = () =>
  tr(
    `# Saturday Social

This is where the posts of the Saturday page live: plan, copy and graphics.

## Folders
- \`plan/\`: the month's editorial plan, one file per week.
- \`posts/\`: one file per post, with copy and hashtags (\`YYYY-MM-DD-title.md\`).
- \`graphics/\`: the images of the posts, with the same name as the post (\`YYYY-MM-DD-title.png\`).

## Rules
- The tone is Saturday's: direct, warm, no exclamation marks.
- Every post has 3 to 5 hashtags, always #saturdaycompany.
- The dates in file names are YYYY-MM-DD.
- A ready post has \`status: to review\` at the top: Giulio reviews it before publishing.
`,
    `# Social di Saturday

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
`,
  );

const agentsBase = () =>
  tr(
    `# The social squad

- Calypso writes the copy, Pandora makes the graphics, Iapetus keeps the plan.
`,
    `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
`,
  );

const agentsNow = () =>
  tr(
    `# The social squad

- Calypso writes the copy, Pandora makes the graphics, Iapetus keeps the plan.
- Graphics go in 1080×1350.
`,
    `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
- Le grafiche vanno in 1080×1350.
`,
  );

const agentsProposed = () =>
  tr(
    `# The social squad

- Calypso writes the copy, Pandora makes the graphics, Iapetus keeps the plan.
- Every post uses the trending restaurant hashtags: #foodporn #instafood #restaurant.
`,
    `# Squadra dei social

- Calypso scrive i testi, Pandora fa le grafiche, Iapetus tiene il piano.
- Ogni post usa gli hashtag di tendenza dei ristoranti: #foodporn #instafood #ristorante.
`,
  );

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
    const claudeNowText = claudeNow();
    const agentsBaseText = agentsBase();
    this.files.set(this.key(id, 'CLAUDE.md'), claudeNowText);
    this.files.set(this.key(id, 'AGENTS.md'), agentsNow());
    this.propose(
      {
        project: id,
        file: 'CLAUDE.md',
        from: 'iapetus',
        base: claudeNowText,
        content: claudeProposed(),
        reason: tr(
          'I’m writing down how we name the files and that every ready post waits for your review',
          'Metto per iscritto come chiamiamo i file e che ogni post pronto aspetta la tua revisione',
        ),
      },
      now - 40 * 60_000,
    );
    this.propose(
      {
        project: id,
        file: 'AGENTS.md',
        from: 'calypso',
        base: agentsBaseText,
        content: agentsProposed(),
        reason: tr(
          'I’m adding the trending hashtags I found for restaurants',
          'Aggiungo gli hashtag di tendenza che ho trovato per i ristoranti',
        ),
        source: tr(
          'web page: a social media agency’s blog',
          'pagina web: blog di un’agenzia di social',
        ),
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
        title: tr(
          `Instructions of ${project.name} (${p.file})`,
          `Istruzioni di ${project.name} (${p.file})`,
        ),
        summary: tr(
          `${who} suggests ${current === null ? 'creating' : 'changing'} the instructions of “${project.name}” (${p.file}): ${p.reason}.`,
          `${who} propone di ${current === null ? 'creare' : 'cambiare'} le istruzioni di «${project.name}» (${p.file}): ${p.reason}.`,
        ),
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
    if (!p)
      return fail(404, 'unknown_draft', tr('This draft doesn’t exist.', 'Questa bozza non c’è.'));
    if (p.closed)
      return fail(409, 'draft_closed', tr('Draft already closed.', 'Bozza già chiusa.'));
    const project = this.h.project(p.project);
    if (!project) {
      return fail(
        409,
        'project_archived',
        tr('The project is archived.', 'Il progetto è archiviato.'),
      );
    }
    const key = this.key(p.project, p.file);
    if (action === 'confirm' && (this.files.get(key) ?? null) !== p.base) {
      return fail(
        409,
        'docs_changed',
        tr(
          'The file changed after the proposal: ask the monster to propose it again.',
          'Il file è cambiato dopo la proposta: chiedi al mostro di riproporla.',
        ),
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
