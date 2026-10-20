/*
 * Initial content of a new vault (research/04 §6.1): simplified PARA folders
 * with Italian names, LEGGIMI.md, four templates, a minimal Obsidian config
 * and the .gitignore. Only used when creating a vault, never on an existing one.
 */

export const VAULT_FOLDERS = [
  'Inbox',
  'Diario',
  'Progetti',
  'Aree',
  'Risorse',
  'Persone',
  'Archivio',
  'Agenti',
  'Modelli',
  'Allegati',
] as const;

/** Lines of the vault .gitignore (research/04 §5.1). */
export const VAULT_GITIGNORE = [
  '# Monsters: files that do not belong to the history of the vault',
  '.trash/',
  '.obsidian/workspace*.json',
  '.obsidian/cache',
  '.smart-env/',
  '*.monsters-tmp',
  '.DS_Store',
  '',
].join('\n');

/** Minimal `.obsidian/app.json` (research/04 §4.1). */
export const OBSIDIAN_APP_JSON = `${JSON.stringify(
  {
    useMarkdownLinks: false,
    newLinkFormat: 'shortest',
    alwaysUpdateLinks: true,
    trashOption: 'local',
    attachmentFolderPath: 'Allegati',
    newFileLocation: 'folder',
    newFileFolderPath: 'Inbox',
  },
  null,
  2,
)}\n`;

export const LEGGIMI = `# Leggimi

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
`;

export const TEMPLATES: Record<string, string> = {
  'Modelli/Nota.md': `---
type: note
tags: []
aliases: []
---
# {{title}}

Riassunto in una o due righe.

## Dettagli
`,
  'Modelli/Persona.md': `---
type: person
tags: []
aliases: []
---
# {{title}}

Chi è e come la conosci.

## Contatti

## Note
`,
  'Modelli/Progetto.md': `---
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
  'Modelli/Diario.md': `---
type: daily
tags: []
---
# {{date}}

## Note

## Agenti
`,
};

export function memoryNote(name: string): string {
  return `# Memoria di ${name}

Indice corto della memoria di ${name}: una riga per voce, con il link alla nota di dettaglio.
`;
}
