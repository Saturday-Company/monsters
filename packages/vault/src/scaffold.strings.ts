import type { VaultLayoutId } from '@monsters/shared';

/*
 * What a new vault starts with, in the words of its layout (D-154): the readme, the templates
 * of the new notes and the proposal notes the agents leave in the inbox. Picked by the vault's
 * layout, never by the app's language: an Italian vault gets Italian notes whatever language
 * the app speaks. The Italian texts are those of every vault made before D-154: they do not
 * change.
 */

const en = {
  /** Commit messages of the vault's history, in the words of the vault's layout (D-153, C8). */
  commitCreate: 'vault_create: new vault',
  commitInit: 'vault_init: history started by Monsters',
  commitSnapshot: (files: string) =>
    `user snapshot: ${files}\n\nChanges made outside Monsters, saved before an agent’s write.`,
  commitUndo: (actionId: string, commit: string) => `Undo action ${actionId} (commit ${commit})`,
  /** The orchestrator's name when nobody gave one. */
  orchestratorName: 'Orchestrator',
  readme: `# Read me

This is your second brain: Markdown notes you can open with Obsidian or any editor.
You and your agents write here. Every change the agents make is saved in the history (git) and can be undone.

## Folders
- **Inbox**: quick capture. Agents without an area of their own write here, change proposals too.
- **Journal**: one note per day (\`YYYY-MM-DD\`). Agents write only in the \`## Agents\` section.
- **Projects**: one note (or one folder) per active project.
- **Areas**: responsibilities that go on over time (health, work, home, money…).
- **Resources**: reference knowledge, notes, research, links.
- **People**: one note per person.
- **Archive**: closed projects and notes no longer active.
- **Agents**: one folder per agent, with \`MEMORY.md\` (the index of its memory) and its notes.
- **Templates**: the templates of new notes.
- **Attachments**: images and PDFs.

## Conventions
- The file name is the note's title and is unique in the vault, so short links \`[[Title]]\` work.
- At the top of a note there are its properties (\`type\`, \`tags\`, \`aliases\`…). \`id\`, \`created\`, \`updated\` and
  \`author\` are managed by Monsters.
- Tags are lower case and nested: \`project/monsters\`, \`area/health\`.
- Notes with \`private: true\` and the \`Private/\` folder are visible only to you and the orchestrator.
- Deleted notes go to \`.trash/\`, as in Obsidian.
`,
  /** Templates of the new notes, by file name inside the templates folder. */
  templates: {
    'Note.md': `---
type: note
tags: []
aliases: []
---
# {{title}}

A summary in one or two lines.

## Details
`,
    'Person.md': `---
type: person
tags: []
aliases: []
---
# {{title}}

Who they are and how you know them.

## Contacts

## Notes
`,
    'Project.md': `---
type: project
status: active
tags: []
---
# {{title}}

Goal and deadline in one line.

## Next steps

## Decisions

## Links
`,
    'Journal.md': `---
type: daily
tags: []
---
# {{date}}

## Notes

## Agents
`,
  } as Record<string, string>,
  /** Name of a proposal note, without the folder and `.md`. */
  proposalName: (author: string, target: string, stamp: string) =>
    `Proposal by ${author} - ${target} - ${stamp}`,
  proposalTitle: (target: string) => `# Proposed change to [[${target}]]`,
  proposalDiff: '## Proposed change',
  proposalOps: '## Operations',
  proposalApplied: 'Applied by the orchestrator with `vault_apply_proposal`.',
};

const it: typeof en = {
  commitCreate: 'vault_create: nuovo vault',
  commitInit: 'vault_init: cronologia avviata da Monsters',
  commitSnapshot: (files) =>
    `snapshot utente: ${files}\n\nModifiche fatte fuori da Monsters, salvate prima della scrittura di un agente.`,
  commitUndo: (actionId, commit) => `Annulla l'azione ${actionId} (commit ${commit})`,
  orchestratorName: 'Orchestratore',
  readme: `# Leggimi

Questo è il tuo second brain: note Markdown che puoi aprire con Obsidian o con qualsiasi editor.
Ci scrivete tu e i tuoi agenti. Ogni modifica degli agenti è salvata nella cronologia (git) e si può annullare.

## Cartelle
- **Inbox**: cattura veloce. Gli agenti senza un'area dedicata scrivono qui, anche le proposte di modifica.
- **Diario**: una nota al giorno (\`AAAA-MM-GG\`). Gli agenti scrivono solo nella sezione \`## Agenti\`.
- **Progetti**: una nota (o una cartella) per ogni progetto attivo.
- **Aree**: responsabilità che continuano nel tempo (salute, lavoro, casa, finanze…).
- **Risorse**: conoscenza di riferimento, appunti, ricerche, link.
- **Persone**: una nota per persona.
- **Archivio**: progetti chiusi e note non più attive.
- **Agenti**: una cartella per agente, con \`MEMORY.md\` (l'indice della sua memoria) e le sue note.
- **Modelli**: i modelli per le note nuove.
- **Allegati**: immagini e PDF.

## Convenzioni
- Il nome del file è il titolo della nota ed è unico nel vault, così i link brevi \`[[Titolo]]\` funzionano.
- In testa alla nota ci sono le proprietà (\`type\`, \`tags\`, \`aliases\`…). \`id\`, \`created\`, \`updated\` e
  \`author\` le gestisce Monsters.
- I tag sono minuscoli e gerarchici: \`progetto/monsters\`, \`area/salute\`.
- Le note con \`private: true\` e la cartella \`Privato/\` sono visibili solo a te e all'orchestratore.
- Le note cancellate finiscono in \`.trash/\`, come in Obsidian.
`,
  templates: {
    'Nota.md': `---
type: note
tags: []
aliases: []
---
# {{title}}

Riassunto in una o due righe.

## Dettagli
`,
    'Persona.md': `---
type: person
tags: []
aliases: []
---
# {{title}}

Chi è e come la conosci.

## Contatti

## Note
`,
    'Progetto.md': `---
type: project
status: active
tags: []
---
# {{title}}

Obiettivo e scadenza in una riga.

## Prossimi passi

## Decisioni

## Collegamenti
`,
    'Diario.md': `---
type: daily
tags: []
---
# {{date}}

## Note

## Agenti
`,
  },
  proposalName: (author, target, stamp) => `Proposta di ${author} - ${target} - ${stamp}`,
  proposalTitle: (target) => `# Proposta di modifica a [[${target}]]`,
  proposalDiff: '## Modifica proposta',
  proposalOps: '## Operazioni',
  proposalApplied: "Applicate dall'orchestratore con `vault_apply_proposal`.",
};

const TEXTS: Record<VaultLayoutId, typeof en> = { en, it };

/** The texts of a new vault and of its proposal notes, in the words of its layout. */
export function scaffoldStrings(layout: VaultLayoutId): typeof en {
  return TEXTS[layout];
}
