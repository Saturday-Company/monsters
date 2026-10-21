import { vaultLayoutOf, type VaultLayout } from '@monsters/shared';
import { mockLang, tr } from './lang.ts';

/*
 * The notes of the mock's demo vault, by key: path (and so title: the file name) in the mock's
 * language, in the layout of that language (D-154: `Agents/`, `Private/`, `~/Monsters Notes` in English;
 * `Agenti/`, `Privato/`, `~/Monsters Note` in Italian).
 * The wikilinks inside the notes name titles, so they must follow these names.
 */

const TABLE = {
  readme: ['README.md', 'LEGGIMI.md'],
  diary: ['Journal/2026-10-14.md', 'Diario/2026-10-14.md'],
  lisbonTips: ['Resources/Lisbon, weekend tips.md', 'Risorse/Lisbona, spunti per il weekend.md'],
  pasteis: ['Resources/Pastéis de nata.md', 'Risorse/Pastéis de nata.md'],
  tram28: ['Resources/Tram 28.md', 'Risorse/Tram 28.md'],
  carbonara: ['Resources/Recipes/Carbonara.md', 'Risorse/Ricette/Carbonara.md'],
  shopping: ['Resources/Shopping list.md', 'Risorse/Lista della spesa.md'],
  lisbonRestaurants: ['Resources/Restaurants in Lisbon.md', 'Risorse/Ristoranti a Lisbona.md'],
  inboxPosts: ['Inbox/Post drafts.md', 'Inbox/Bozze dei post.md'],
  quickIdea: ['Inbox/Quick idea.md', 'Inbox/Idea veloce.md'],
  roadmap: ['Projects/Monsters/Roadmap.md', 'Progetti/Monsters/Roadmap.md'],
  ideas: [
    'Projects/Monsters/Ideas for the little square.md',
    'Progetti/Monsters/Idee per la piazzetta.md',
  ],
  siteBrief: [
    'Projects/Saturday website/Website brief.md',
    'Progetti/Sito Saturday/Brief del sito.md',
  ],
  running: ['Areas/Health/Running.md', 'Aree/Salute/Corsa.md'],
  budget: ['Areas/Finance/October budget.md', 'Aree/Finanze/Budget di ottobre.md'],
  personalDiary: ['Private/Personal diary.md', 'Privato/Diario personale.md'],
  giulio: ['People/Giulio.md', 'Persone/Giulio.md'],
  sara: ['People/Sara.md', 'Persone/Sara.md'],
  rheaMemory: ['Agents/Rhea/MEMORY.md', 'Agenti/Rhea/MEMORY.md'],
  oldPlan: ['Archive/Old plan.md', 'Archivio/Vecchio piano.md'],
  socialPosts: ['Projects/Social/Post drafts.md', 'Progetti/Social/Bozze dei post.md'],
  meetingSummary: [
    'Meetings/Summary of the meeting with Bruno.md',
    'Riunioni/Riassunto riunione con Bruno.md',
  ],
  meetingNotes: ['Meetings/2026-10-15 Bruno.md', 'Riunioni/2026-10-15 Bruno.md'],
  ambientExpenses: ['Expenses/October.md', 'Spese/Ottobre.md'],
  ambientPost: ['Drafts/Lisbon post 1.md', 'Bozze/Post Lisbona 1.md'],
  ambientWeek: ['Calendar/Week 42.md', 'Calendario/Settimana 42.md'],
  ambientIndex: ['October index.md', 'Indice di ottobre.md'],
} as const satisfies Record<string, readonly [en: string, it: string]>;

export type NoteKey = keyof typeof TABLE;

/** The path of a demo note in the mock's language. */
export function notePath(key: NoteKey): string {
  return tr(TABLE[key][0], TABLE[key][1]);
}

/** The title of a demo note (its file name without `.md`), as wikilinks name it. */
export function noteTitle(key: NoteKey): string {
  return (notePath(key).split('/').pop() ?? '').replace(/\.md$/, '');
}

/** The layout of the mock's vault: the one of the mock's language (the demo vault is built in it). */
export function mockLayout(): VaultLayout {
  return vaultLayoutOf(mockLang());
}

/** The notes folder of the demo vault (`~/Monsters Notes`, `~/Monsters Note` in Italian). */
export function mockVaultDir(): string {
  return `/home/demo/${mockLayout().notesDir}`;
}
