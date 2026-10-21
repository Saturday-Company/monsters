import { pick } from './i18n.ts';

/*
 * The words of the "Istinto" settings (D-067, D-153): the module's title, the three engines and the
 * twelve uses. The ids of the uses and of the engines are API values and stay as they are.
 */

interface UseTexts {
  label: string;
  description: string;
  sends: string;
}

const en = {
  title: 'Monsters’ decisions',
  description:
    'The quick calls the squad makes: who to hand a job to, whether to ask you, whether a result is really done, whether a monster is going in circles. Publishing, writing to others, spending and deleting always ask you first.',
  engines: {
    rules: {
      label: 'Rules only',
      description: 'Anything unclear always goes to you; no extra checks.',
    },
    llm: {
      label: 'Small model',
      description:
        'Uses one of your models: it’s free, but slower and sometimes wrong. Only for decisions that can wait a few seconds.',
    },
    jev: {
      label: 'An expert model (TypeSafe)',
      description:
        'A model built to decide in an instant. It costs very little (about €1 per 2,000 jobs) and needs a TypeSafe key. It gets your request, the summaries of the jobs and the web pages the monsters read, never your notes.',
    },
  },
  uses: {
    gate: {
      label: 'Asks you only when needed',
      description:
        'The squad decides anything that can be undone; taste, facts only you know and anything under “They always ask you” go to you.',
      sends: 'The monster’s question, the options and the request it’s working on.',
    },
    done_check: {
      label: 'Checks that jobs are really done',
      description:
        'After each job it compares what the monster says with the notes it actually saved: if something’s missing, it asks the monster to finish.',
      sends:
        'The task, the “done when” and the constraints, the monster’s report and the names of the notes touched (not their content).',
    },
    stuck: {
      label: 'Stops monsters going in circles',
      description:
        'If a monster repeats the same actions without getting anywhere, it asks it to try another way, and if it keeps at it, moves to another model. It never stops it on its own.',
      sends: 'The task and the last steps, one line each (tool, short arguments, outcome).',
    },
    final_question: {
      label: 'Questions become cards',
      description:
        'If your lead ends a reply by asking you something, it sends it as a card with options to tap.',
      sends: 'The last sentences of your lead’s reply.',
    },
    route_hint: {
      label: 'Hands the job to the right monster',
      description:
        'Suggests to your lead who to give the request to, or to answer alone when there’s nothing to delegate.',
      sends: 'Your request, the latest messages and the monsters’ names and roles.',
    },
    tools: {
      label: 'Gives each monster only the tools it needs',
      description:
        'Rare tools (undo, move, delete notes) and the web are offered only when the request calls for them: free models get less confused.',
      sends: 'Your request (in the same question as “Hands the job to the right monster”).',
    },
    tier: {
      label: 'Uses the cheaper model for simple things',
      description:
        'If a monster has a light model and a strong one, simple requests go to the light one and hard ones to the strong one; every task the lead hands to a monster gets its own level. It never uses paid models if you’ve turned them off.',
      sends:
        'Your request (in the same question as “Hands the job to the right monster”) and, for each task, the text the lead writes to the monster.',
    },
    shortcut: {
      label: 'Shortcut to the right monster (trial)',
      description:
        'On trial: it notes when it would have sent the request straight to a monster, without going through your lead. For now it changes nothing.',
      sends: 'Your request (in the same question as “Hands the job to the right monster”).',
    },
    outbound: {
      label: 'Asks you before actions that leave the computer',
      description:
        'Before publishing, writing to others, spending or deleting for good with other apps, the browser or the terminal, and before sending pieces of your notes to a site it has never seen, the monster stops and asks you (only for the things under “They always ask you”). These rules always apply; if the monsters’ decisions are on, they also look at doubtful cases.',
      sends: 'The tool’s name, its description and the call’s arguments (shortened).',
    },
    injection: {
      label: 'Flags texts that give orders to the monsters',
      description:
        'In web pages and texts from other apps it looks for sentences aimed at the monsters: it flags them, or removes them when it’s sure. It doesn’t check your notes.',
      sends:
        'The text of the web pages and of the results from other apps that the monsters read. Never your notes.',
    },
    memory: {
      label: 'Remembers only what’s useful',
      description:
        'Before adding a memory to a monster’s memory, it checks that it will still be useful in later jobs.',
      sends: 'The “To remember” lines the monster wrote, with its name and role.',
    },
    scorecard: {
      label: 'Learns which model works best',
      description:
        'Keeps the monsters’ scorecard: after at least 20 checked jobs per model, it puts first, among the models you already have, the one that finishes the most at the lowest cost.',
      sends: 'Nothing: the scorecard stays on this computer.',
    },
  } satisfies Record<string, UseTexts>,
};

const it: typeof en = {
  title: 'Decisioni dei mostri',
  description:
    'Le decisioni al volo della squadra: a chi passare un lavoro, se serve chiederti, se un risultato è finito davvero, se un mostro gira a vuoto. Pubblicare, scrivere ad altri, spendere e cancellare te li chiedono sempre.',
  engines: {
    rules: {
      label: 'Solo regole',
      description: 'Le cose non chiare te le chiedono sempre; niente controlli in più.',
    },
    llm: {
      label: 'Modello piccolo',
      description:
        'Usa uno dei tuoi modelli: è gratis, ma più lento e a volte sbaglia. Solo per le decisioni che possono aspettare qualche secondo.',
    },
    jev: {
      label: 'Un modello esperto (TypeSafe)',
      description:
        'Un modello fatto apposta per decidere in un attimo. Costa pochissimo (circa 1 € ogni 2.000 lavori) e serve una chiave di TypeSafe. Riceve la richiesta, i riassunti dei lavori e le pagine web che i mostri leggono, mai le tue note.',
    },
  },
  uses: {
    gate: {
      label: 'Ti chiede solo quando serve',
      description:
        'Le scelte che si possono annullare le decide la squadra; gusto, fatti che sai solo tu e le cose in «Chiedi sempre» le chiede a te.',
      sends: 'La domanda del mostro, le opzioni e la richiesta a cui sta lavorando.',
    },
    done_check: {
      label: 'Controlla che i lavori siano finiti davvero',
      description:
        'Dopo ogni lavoro confronta quello che il mostro dice con le note che ha salvato davvero: se manca qualcosa gli chiede di completarlo.',
      sends:
        'Il compito, «finito quando» e i vincoli, il rapporto del mostro e i nomi delle note toccate (non il loro contenuto).',
    },
    stuck: {
      label: 'Ferma chi gira a vuoto',
      description:
        'Se un mostro ripete le stesse azioni senza andare avanti gli chiede di cambiare strada, e se insiste passa a un altro modello. Non lo ferma mai da solo.',
      sends:
        'Il compito e gli ultimi passi in una riga ciascuno (strumento, argomenti brevi, esito).',
    },
    final_question: {
      label: 'Le domande diventano schede',
      description:
        'Se il tuo capo chiude una risposta chiedendoti qualcosa, te lo manda come scheda con le opzioni da toccare.',
      sends: 'Le ultime frasi della risposta del tuo capo.',
    },
    route_hint: {
      label: 'Passa il lavoro al mostro giusto',
      description:
        'Suggerisce al tuo capo a chi affidare la richiesta, o di rispondere da solo quando non serve delegare.',
      sends: 'La tua richiesta, gli ultimi messaggi e i nomi e ruoli dei mostri.',
    },
    tools: {
      label: 'Dà a ogni mostro solo gli strumenti che servono',
      description:
        'Gli strumenti rari (annullare, spostare, cancellare note) e il web arrivano solo quando la richiesta li chiede: i modelli gratuiti si confondono meno.',
      sends: 'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto»).',
    },
    tier: {
      label: 'Usa il modello più economico per le cose semplici',
      description:
        'Se un mostro ha un modello leggero e uno potente, le richieste semplici vanno al leggero e quelle difficili al potente; ogni incarico che il capo passa a un mostro ha il suo livello. Non usa mai modelli a pagamento se li hai spenti.',
      sends:
        'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto») e, per ogni incarico, il testo che il capo scrive al mostro.',
    },
    shortcut: {
      label: 'Scorciatoia verso il mostro giusto (in prova)',
      description:
        'In prova: annota quando avrebbe mandato la richiesta direttamente a un mostro, senza passare dal tuo capo. Per ora non cambia nulla.',
      sends: 'La tua richiesta (nella stessa domanda di «Passa il lavoro al mostro giusto»).',
    },
    outbound: {
      label: 'Ti chiede prima delle azioni che escono dal computer',
      description:
        'Prima di pubblicare, scrivere ad altri, spendere o cancellare per sempre con altri programmi, il browser o il terminale, e prima di mandare pezzi delle tue note a un sito mai visto, il mostro si ferma e te lo chiede (solo per le cose in «Chiedi sempre»). Queste regole valgono sempre; se le decisioni dei mostri sono accese, guardano anche i casi dubbi.',
      sends:
        'Il nome dello strumento, la sua descrizione e gli argomenti della chiamata (accorciati).',
    },
    injection: {
      label: 'Segnala i testi che danno ordini ai mostri',
      description:
        'Nelle pagine web e nei testi di altri programmi cerca frasi rivolte ai mostri: le segnala, o le toglie quando è sicuro. Le tue note non le controlla.',
      sends:
        'Il testo delle pagine web e dei risultati di altri programmi che i mostri leggono. Mai le tue note.',
    },
    memory: {
      label: 'Ricorda solo quello che serve',
      description:
        'Prima di aggiungere un ricordo alla memoria di un mostro controlla che serva anche nei lavori dopo.',
      sends: 'Le righe «Da ricordare» scritte dal mostro, con il suo nome e ruolo.',
    },
    scorecard: {
      label: 'Impara quale modello lavora meglio',
      description:
        'Tiene la pagella dei mostri: dopo almeno 20 lavori controllati per modello mette per primo, tra i modelli che hai già, quello che finisce di più al costo più basso.',
      sends: 'Niente: la pagella resta su questo computer.',
    },
  },
};

export const instinctStrings = () => pick({ en, it });
