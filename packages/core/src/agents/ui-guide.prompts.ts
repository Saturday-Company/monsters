import { pick, type Lang } from '@monsters/shared';

/*
 * The manual of the drawn blocks (D-162, `ui_guide`): what a monster reads to write a ```ui block
 * in a reply. Written by us, not lang-core's generic prompt (it says the WHOLE response must be
 * OpenUI Lang: here the block lives inside a normal Markdown reply). Two families (D-153): the
 * Italian one is what the app's language picks; the English one is its twin. The signatures of
 * the components come in as one text (`uiSignatures()` of `@monsters/shared`), so the manual
 * can never name a component or an argument the app does not draw.
 */

const en = {
  toolDescription:
    'Gives you the manual of drawn blocks: how to put a table, key numbers, a chart, a comparison or steps in your reply as a ```ui block. Read-only, no arguments. Call it before your first block of the conversation, unless the manual is already in this message.',
  /** Marks the manual attached to a turn by the core (one line, then the manual). */
  attached: '[System] The reply to this request reads better drawn. Manual of the `ui` blocks:',
  guide: (signatures: string) =>
    `# Drawn blocks
Where data reads better drawn than written, put a fenced block with language \`ui\` inside your normal Markdown reply: the app draws it as a table, key numbers, a chart, a comparison or steps. The prose around it stays Markdown.
Draw: data to compare, numbers or trends, several options with the same features, steps to follow, the status of many items.
Do not draw: chat, a text to write or send, one fact, an explanation. A choice for the user is \`ask_user\`; a long report is \`artifact_create\`.
Rules:
- Usually one block per reply, at most one per topic. The conclusion goes in prose: the block holds the data.
- One statement per line: \`name = Component(args)\`. The first line is \`root = Block([...])\`.
- Arguments are positional, in signature order; \`?\` ones may be left out at the end, or \`null\` in the middle.
- Strings in double quotes, numbers as numbers (12, not "12"), lists in [ ], objects as {key: value}.
- Every name you use is defined once, on its own line. Only these components, nothing else.
Components:
${signatures}
Example:
\`\`\`ui
root = Block([k, t])
k = Stats([Stat("Open rate", "42%", "+3%", "up"), Stat("Clicks", "1.2k")])
t = Table(["Plan", "Price (€/month)"], [["Free", 0], ["Pro", 12]], "Plans")
\`\`\``,
};

const it: typeof en = {
  toolDescription:
    'Ti dà il manuale dei blocchi disegnati: come mettere nella risposta una tabella, dei numeri chiave, un grafico, un confronto o dei passi con un blocco ```ui. Solo lettura, nessun argomento. Chiamalo prima del tuo primo blocco della conversazione, a meno che il manuale non sia già in questo messaggio.',
  attached:
    '[Sistema] La risposta a questa richiesta si legge meglio disegnata. Manuale dei blocchi `ui`:',
  guide: (signatures) =>
    `# Blocchi disegnati
Dove i dati si leggono meglio disegnati che scritti, metti nella tua risposta Markdown normale un blocco di codice con linguaggio \`ui\`: l’app lo disegna come tabella, numeri chiave, grafico, confronto o passi. La prosa intorno resta Markdown.
Disegna: dati da confrontare, numeri o andamenti, più opzioni con le stesse caratteristiche, passi da seguire, lo stato di tante cose.
Non disegnare: chiacchiere, un testo da scrivere o da mandare, un fatto solo, una spiegazione. Una scelta per l’utente è \`ask_user\`; un rapporto lungo è \`artifact_create\`.
Regole:
- Di solito un blocco per risposta, al massimo uno per argomento. La conclusione va in prosa: il blocco contiene i dati.
- Una istruzione per riga: \`nome = Componente(argomenti)\`. La prima riga è \`root = Block([...])\`.
- Argomenti posizionali, nell’ordine della firma; quelli con \`?\` si omettono in fondo, o si scrive \`null\` in mezzo.
- Stringhe tra virgolette doppie, numeri come numeri (12, non "12"), liste tra [ ], oggetti come {chiave: valore}.
- Ogni nome che usi è definito una volta, su una riga sua. Solo questi componenti, nient’altro.
Componenti:
${signatures}
Esempio:
\`\`\`ui
root = Block([k, t])
k = Stats([Stat("Tasso di apertura", "42%", "+3%", "up"), Stat("Click", "1,2k")])
t = Table(["Piano", "Prezzo (€/mese)"], [["Free", 0], ["Pro", 12]], "Piani")
\`\`\``,
};

export const uiGuidePrompts = (lang?: Lang) => pick({ en, it }, lang);
