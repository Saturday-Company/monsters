import {
  describeSchedule,
  draftTaint,
  type DraftView,
  type ModelRefView,
  type ProjectPlanMember,
  type TeamDraft,
} from '@monsters/shared';
import { draftCardStrings } from './draft-card.strings.ts';
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
const yes = (b: boolean) => (b ? draftCardStrings().yes : draftCardStrings().no);

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
  const t = draftCardStrings();
  const lines = [
    `🧩 <b>${e(d.name)}</b> · ${e(d.title)}`,
    `${t.role}: ${e(d.role)}`,
    `${t.does}: ${e(d.mission)}`,
    `${t.rules}:`,
    ...d.duties.map((duty, i) => `  ${i + 1}. ${e(duty)}`),
  ];
  if (d.context) lines.push(`${t.aboutYou}: ${e(d.context)}`);
  lines.push(
    t.tools(Boolean(d.web)),
    t.notes(e(d.area)),
    `${t.model}: ${e(model(models, modelFallback))}`,
  );
  return lines;
}

function memberLines(m: ProjectPlanMember, name: Name, lead: string): string[] {
  const t = draftCardStrings();
  if ('copyOf' in m) {
    const from = name(m.copyOf);
    return [t.copyOf(e(m.name ?? from), e(from))];
  }
  return monsterLines(m.draft, m.models, t.like(lead));
}

/** The warning of a draft that is not only the user's request. */
function taintLine(source: string, applying: boolean): string {
  return draftCardStrings().taint(e(source), applying);
}

/** The card's lines (HTML), every field that the confirmation makes real. */
export function draftCardLines(
  d: DraftView,
  name: Name,
  projectName: Name = (id) => id,
  /** The project's existing folder is outside `~/Monsters Progetti`: it is confirmed in the app. */
  folderOutside = false,
): string[] {
  const t = draftCardStrings();
  const lines = [`📝 ${e(d.summary)}`];
  const taint = draftTaint(d);
  if (taint && d.kind !== 'docs') lines.push(taintLine(taint, false));
  if (d.kind === 'monster') {
    if (d.project) lines.push(`${t.project}: ${e(projectName(d.project))}`);
    lines.push(...monsterLines(d.monster.draft, d.monster.models, t.like(name(d.from))));
    return lines;
  }
  if (d.kind === 'project') {
    const p = d.projectDraft;
    const plan = p.plan;
    const lead = plan?.lead.name ?? t.theLead;
    if (plan?.lead.goal) lines.push(`${t.goal}: ${e(plan.lead.goal)}`);
    if (plan?.why) lines.push(`${t.why}: ${e(plan.why)}`);
    lines.push(
      t.lead(
        e(lead),
        plan?.lead.from ? e(name(plan.lead.from)) : null,
        e(model(plan?.lead.models, plan?.lead.from ? t.like(name(plan.lead.from)) : t.automatic)),
      ),
    );
    for (const m of plan?.members ?? []) lines.push(...memberLines(m, name, lead));
    lines.push(
      p.folder ? t.folder(e(p.folder), Boolean(plan?.createFolder)) : t.noFolder,
      ...(p.folder ? [t.folderGrant(Boolean(plan?.createFolder))] : []),
      ...(folderOutside ? [t.folderOutside] : []),
      t.projectNotes(e(p.vaultArea)),
      t.connections(e([...p.connections.mcp, ...p.connections.claude].join(', ') || t.none)),
      t.webSearch(yes(p.webSearch)),
    );
    const caps = [
      p.spend.dailyEur != null ? t.perDay(p.spend.dailyEur) : '',
      p.spend.monthlyEur != null ? t.perMonth(p.spend.monthlyEur) : '',
    ].filter(Boolean);
    lines.push(t.spendCap(caps.join(', ') || t.squadCap));
    for (const a of plan?.automations ?? []) {
      lines.push(
        t.automationDraft(
          e(a.name),
          e(describeSchedule(a.schedule.cron, { timezone: a.schedule.timezone })),
        ),
        t.goalIndented(e(a.objective)),
      );
      if (a.participants.length > 0)
        lines.push(t.participantsIndented(e(a.participants.join(', '))));
      if (a.resultsFolder) lines.push(t.resultsIndented(e(a.resultsFolder)));
      if (a.notify) lines.push(t.noticesIndented(yes(a.notify.app), yes(a.notify.telegram)));
    }
    return lines;
  }
  if (d.kind === 'docs') {
    const x = d.docs;
    lines.push(t.file(e(x.file), x.current === null, e(projectName(d.project ?? ''))));
    if (taint) lines.push(taintLine(taint, true));
    if (x.stale) lines.push(t.fileChanged);
    if (x.folderMoved) lines.push(t.folderChanged);
    if (x.tooLarge) lines.push(t.fileTooLarge(e(x.file)));
    if (!x.tooLarge) {
      // The diff of the whole file (the core's), shown when short.
      lines.push(docsDiffShown(d) ? `<pre>${e(x.diff)}</pre>` : t.diffLong);
    }
    return lines;
  }
  if (d.kind === 'memory') {
    // Every line as it would be added (review of 18/10, A2).
    lines.push(t.inMemoryOf(e(name(d.memory.agent))), ...d.memory.lines.map((l) => `  • ${e(l)}`));
    if (d.memory.tainted) lines.push(t.memoryTainted);
    return lines;
  }
  const a = d.automation;
  lines.push(
    t.when(e(a.scheduleText)),
    t.leadLine(e(name(a.lead)), a.project ? e(projectName(a.project)) : null),
    t.participants(e(a.participants.map(name).join(', ') || t.none)),
    t.goalLine(e(a.objective)),
  );
  if (a.resultsFolder) lines.push(t.resultsLine(e(a.resultsFolder)));
  lines.push(t.noticesLine(yes(a.notify.app), yes(a.notify.telegram)));
  const limits = [
    a.limits.maxSteps !== undefined ? t.steps(a.limits.maxSteps) : '',
    a.limits.maxTotalTokens !== undefined ? t.tokens(a.limits.maxTotalTokens) : '',
    a.limits.maxEur !== undefined ? t.euros(a.limits.maxEur) : '',
  ].filter(Boolean);
  lines.push(t.limitsPerRun(limits.join(', ') || t.eachJobsOwn));
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
