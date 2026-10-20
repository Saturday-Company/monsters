import {
  describeSchedule,
  draftTaint,
  type DraftView,
  type ModelRefView,
  type ProjectPlanMember,
  type TeamDraft,
} from '@monsters/shared';
import { escapeHtml } from './format.ts';

/*
 * A draft of a monster on Telegram (D-098, D-103): every field that becomes
 * real with "Conferma", as the app shows it (D-079: nothing hidden). The
 * message has a limit: a card that does not fit is not confirmed from here
 * (the caller drops "Conferma" and points to the app).
 */

/** Visible characters a draft card may use (Telegram's limit is 4096, with room for its outcome). */
export const DRAFT_CARD_BUDGET = 3600;

/** Characters of a diff of CLAUDE.md or AGENTS.md shown on Telegram at most (D-113). */
export const DOCS_DIFF_BUDGET = 1500;

/** The whole diff of a proposal for CLAUDE.md or AGENTS.md is in its card. */
export function docsDiffShown(d: DraftView): boolean {
  return d.kind === 'docs' && !d.docs.tooLarge && d.docs.diff.length <= DOCS_DIFF_BUDGET;
}

type Name = (id: string) => string;

const e = escapeHtml;
const yes = (b: boolean) => (b ? 'sì' : 'no');

function model(models: readonly ModelRefView[] | undefined, fallback: string): string {
  const first = models?.[0];
  return first ? `${first.provider}/${first.model}` : fallback;
}

/** A new monster as `TeamManager.create` makes it: AGENTS.md and agent.yaml. */
function monsterLines(
  d: TeamDraft,
  models: readonly ModelRefView[] | undefined,
  modelFallback: string,
): string[] {
  const lines = [
    `🧩 <b>${e(d.name)}</b> · ${e(d.title)}`,
    `Ruolo: ${e(d.role)}`,
    `Fa: ${e(d.mission)}`,
    'Regole:',
    ...d.duties.map((duty, i) => `  ${i + 1}. ${e(duty)}`),
  ];
  if (d.context) lines.push(`Su di te: ${e(d.context)}`);
  lines.push(
    `Strumenti: ${d.web ? 'note e web (cerca e legge pagine)' : 'note'}, niente terminale né file`,
    `Note: legge tutte, scrive in ${e(d.area)}/ e Inbox/`,
    `Modello: ${e(model(models, modelFallback))}`,
  );
  return lines;
}

function memberLines(m: ProjectPlanMember, name: Name, lead: string): string[] {
  if ('copyOf' in m) {
    const from = name(m.copyOf);
    return [
      `🧩 <b>${e(m.name ?? from)}</b>: con il ruolo e le regole di ${e(from)}; nome, aspetto e memoria suoi`,
    ];
  }
  return monsterLines(m.draft, m.models, `come ${lead}`);
}

/** The warning of a draft that is not only the user's request. */
function taintLine(source: string, verb: string): string {
  return `⚠️ Proposta dopo aver letto testo di terzi (${e(source)}): controlla bene prima di ${verb}.`;
}

/** The card's lines (HTML), every field that the confirmation makes real. */
export function draftCardLines(
  d: DraftView,
  name: Name,
  projectName: Name = (id) => id,
  /** The project's existing folder is outside `~/Monsters Progetti`: it is confirmed in the app. */
  folderOutside = false,
): string[] {
  const lines = [`📝 ${e(d.summary)}`];
  const taint = draftTaint(d);
  if (taint && d.kind !== 'docs') lines.push(taintLine(taint, 'confermare'));
  if (d.kind === 'monster') {
    if (d.project) lines.push(`Progetto: ${e(projectName(d.project))}`);
    lines.push(...monsterLines(d.monster.draft, d.monster.models, `come ${name(d.from)}`));
    return lines;
  }
  if (d.kind === 'project') {
    const p = d.projectDraft;
    const plan = p.plan;
    const lead = plan?.lead.name ?? 'il capo';
    if (plan?.lead.goal) lines.push(`Obiettivo: ${e(plan.lead.goal)}`);
    if (plan?.why) lines.push(`Perché: ${e(plan.why)}`);
    lines.push(
      `👑 Capo: <b>${e(lead)}</b>${plan?.lead.from ? `, copia di ${e(name(plan.lead.from))}` : ''} · modello ${e(model(plan?.lead.models, plan?.lead.from ? `come ${name(plan.lead.from)}` : 'Automatica'))}`,
    );
    for (const m of plan?.members ?? []) lines.push(...memberLines(m, name, lead));
    lines.push(
      p.folder
        ? `Cartella: <code>${e(p.folder)}</code>${plan?.createFolder ? ' (nuova, creata alla conferma)' : ''}`
        : 'Cartella: nessuna (ogni mostro nella sua)',
      ...(p.folder
        ? [
            `⚠️ Tutti i mostri del progetto potranno leggere e scrivere in quella cartella${plan?.createFolder ? '' : ', con tutto quello che c’è già'}.`,
          ]
        : []),
      ...(folderOutside
        ? ['⚠️ È una cartella che c’è già, fuori da Monsters Progetti: la conferma è nell’app.']
        : []),
      `Note del progetto: ${e(p.vaultArea)}/`,
      `Collegamenti: ${e([...p.connections.mcp, ...p.connections.claude].join(', ') || 'nessuno')}`,
      `Ricerca web: ${yes(p.webSearch)}`,
    );
    const caps = [
      p.spend.dailyEur != null ? `${p.spend.dailyEur} € al giorno` : '',
      p.spend.monthlyEur != null ? `${p.spend.monthlyEur} € al mese` : '',
    ].filter(Boolean);
    lines.push(`Tetto di spesa: ${caps.join(', ') || 'quello della squadra'}`);
    for (const a of plan?.automations ?? []) {
      lines.push(
        `⏰ <b>${e(a.name)}</b> (bozza da confermare dopo): ${e(describeSchedule(a.schedule.cron, { timezone: a.schedule.timezone }))}`,
        `  Obiettivo: ${e(a.objective)}`,
      );
      if (a.participants.length > 0) lines.push(`  Partecipano: ${e(a.participants.join(', '))}`);
      if (a.resultsFolder) lines.push(`  Risultati in: ${e(a.resultsFolder)}/`);
      if (a.notify)
        lines.push(`  Avvisi: app ${yes(a.notify.app)}, Telegram ${yes(a.notify.telegram)}`);
    }
    return lines;
  }
  if (d.kind === 'docs') {
    const x = d.docs;
    lines.push(
      `📄 File: <b>${e(x.file)}</b>${x.current === null ? ' (nuovo)' : ''} · progetto ${e(projectName(d.project ?? ''))}`,
    );
    if (taint) lines.push(taintLine(taint, 'applicare'));
    if (x.stale) {
      lines.push('⚠️ Il file è cambiato dopo la proposta: chiedi al mostro di riproporla.');
    }
    if (x.folderMoved) {
      lines.push(
        '⚠️ La cartella del progetto è cambiata dopo la proposta: chiedi al mostro di riproporla.',
      );
    }
    if (x.tooLarge)
      lines.push(`⚠️ ${e(x.file)} adesso è più grande di 1 MB: non si cambia da qui.`);
    if (!x.tooLarge) {
      // The diff of the whole file (the core's), shown when short.
      lines.push(
        docsDiffShown(d)
          ? `<pre>${e(x.diff)}</pre>`
          : 'La differenza è lunga: la trovi anche nell’app.',
      );
    }
    return lines;
  }
  if (d.kind === 'memory') {
    // Every line as it would be added (review of 18/10, A2).
    lines.push(
      `🧠 Nella memoria di <b>${e(name(d.memory.agent))}</b>:`,
      ...d.memory.lines.map((l) => `  • ${e(l)}`),
    );
    if (d.memory.tainted) {
      lines.push(
        '<i>Restano segnate «da testo di terzi»: i lavori che le leggono hanno le difese accese.</i>',
      );
    }
    return lines;
  }
  const a = d.automation;
  lines.push(
    `Quando: ${e(a.scheduleText)}`,
    `Capo: ${e(name(a.lead))}${a.project ? ` · progetto ${e(projectName(a.project))}` : ''}`,
    `Partecipano: ${e(a.participants.map(name).join(', ') || 'nessuno')}`,
    `Obiettivo: ${e(a.objective)}`,
  );
  if (a.resultsFolder) lines.push(`Risultati in: ${e(a.resultsFolder)}/`);
  lines.push(`Avvisi: app ${yes(a.notify.app)}, Telegram ${yes(a.notify.telegram)}`);
  const limits = [
    a.limits.maxSteps !== undefined ? `${a.limits.maxSteps} passi` : '',
    a.limits.maxTotalTokens !== undefined ? `${a.limits.maxTotalTokens} token` : '',
    a.limits.maxEur !== undefined ? `${a.limits.maxEur} €` : '',
  ].filter(Boolean);
  lines.push(`Limiti per giro: ${limits.join(', ') || 'quelli di ogni lavoro'}`);
  return lines;
}

/** Characters Telegram counts: the text without tags, entities as one character. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|#\d+);/g, '_').length;
}

/** The first lines that fit in `budget` visible characters, the last one cut, as one HTML text. */
export function clipHtmlLines(lines: readonly string[], budget: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const n = visibleLength(line) + 1;
    if (used + n > budget) {
      out.push('…');
      break;
    }
    out.push(line);
    used += n;
  }
  return out.join('\n');
}
