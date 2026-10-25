import { setAppLang } from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import {
  accessCheck,
  findAccessClaims,
  isAccessClaim,
  judgeAccessClaims,
  runAccessFacts,
  withoutAccessClaims,
  type AccessState,
  type ClaimContext,
  type RunAccessFacts,
} from '../src/team/access-claims.ts';

// The texts the models read are tested in Italian (the family of the app language, byte for byte
// what they were); the English ones are checked in the blocks that switch the language.
beforeEach(() => setAppLang('it'));
afterEach(() => setAppLang('en'));

/*
 * D3 and D4 of the audit of 19/10 (D-140, D-141): the texts paraphrase what monsters wrote
 * in a real run, set in a fictional example project ("Progetto Social").
 */

function memoryLog() {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
}

const CTX: ClaimContext = {
  services: [{ name: 'Canva' }, { name: 'Notion' }, { name: 'Gmail' }],
  members: ['Nova', 'Pixel', 'Eco'],
  userNames: ['Alice'],
};

/** Progetto Social: the web permission on, Canva connected and given. */
const ALL_ON: AccessState = {
  web: { has: true },
  terminal: { has: true },
  services: [
    { name: 'Canva', has: true },
    { name: 'Notion', has: false, off: true },
  ],
  members: [
    { name: 'Nova', web: { has: true } },
    { name: 'Pixel', web: { has: true } },
  ],
};

/** Luna, the lead: no web (D-026, her squad searches), Canva not ticked in the project. */
const CAPO: AccessState = {
  web: {
    has: false,
    off: false,
    why: 'non è tra i tuoi strumenti in questo lavoro: ce l’hanno Nova, Pixel',
  },
  terminal: { has: true },
  services: [
    {
      name: 'Canva',
      has: false,
      off: false,
      why: 'è collegato all’account ma non a questo progetto',
    },
  ],
  members: [
    { name: 'Nova', web: { has: false, off: false, why: 'non ce l’ha nell’agent.yaml' } },
    { name: 'Pixel', web: { has: true } },
  ],
};

const NO_FACTS: RunAccessFacts = { userNo: [], toolCauses: [] };

const unbacked = (text: string, state: AccessState, facts = NO_FACTS) =>
  judgeAccessClaims(findAccessClaims(text, CTX), state, facts);

// Paraphrases of the false claims of 19/10.
const NOVA_NO_DATA =
  "Nessun risultato: il permesso di ricerca web è stato negato, quindi non ho potuto cercare né aprire siti. L'elenco è rimasto com'era.";
const NOVA_MEMORY =
  '**Da ricordare:** in questa sessione la ricerca web è bloccata dai permessi. Prima di un compito che la richiede, meglio verificare che sia concessa.';
const LUNA_DENIED =
  'Non riesco a cercare online. Il web mi è stato negato in questa sessione, quindi non ho potuto aprire né il blog né Canva. Non ho cercato altre strade per aggirare il blocco.';
const CANVA = '- **Canva non è collegato.** Finché manca il collegamento non vedo le tue grafiche.';
const NOVA_PERMESSO =
  '- **Nova non ha il permesso di ricerca web.** Lo puoi dare da Impostazioni → Permessi.';
const DONT_ASK =
  "Tutte le ricerche web (quattro, una per fornitore più una sugli eventi) sono state rifiutate dai permessi: la sessione è in modalità «don't ask».";
const DONT_ASK_MEMORY =
  '- La ricerca web è negata in modalità «don’t ask»: va concessa prima degli incarichi che la richiedono.';
const NON_CHIEDERE =
  '- **Nova** è rimasto senza web. Gli è stato rifiutato dai permessi di questa sessione, che hanno la modalità «non chiedere».';
const NESSUN_MOSTRO =
  'Ho verificato: nessun mostro può accedere al web, quindi i dati me li devi passare tu.';

describe('findAccessClaims', () => {
  it('finds the claims of 19/10', () => {
    for (const text of [
      NOVA_NO_DATA,
      NOVA_MEMORY,
      LUNA_DENIED,
      CANVA,
      NOVA_PERMESSO,
      DONT_ASK,
      DONT_ASK_MEMORY,
      NON_CHIEDERE,
      NESSUN_MOSTRO,
    ]) {
      expect(findAccessClaims(text, CTX).length, text).toBeGreaterThan(0);
    }
    const [canva] = findAccessClaims(CANVA, CTX);
    expect(canva).toMatchObject({ services: ['Canva'], cause: true, user: false });
    expect(findAccessClaims(NOVA_PERMESSO, CTX)[0]).toMatchObject({
      member: 'Nova',
      web: true,
      cause: true,
    });
    expect(findAccessClaims(DONT_ASK, CTX)[0]).toMatchObject({ session: true, web: true });
    expect(findAccessClaims(NESSUN_MOSTRO, CTX)[0]).toMatchObject({ squad: true, web: true });
  });

  it('leaves out what is not a claim about an access', () => {
    for (const text of [
      'Non ho aggirato nessun blocco e non ho pubblicato niente.',
      'Non ho provato altre strade per aggirare il blocco.',
      'Per ora nessun mostro ha uno strumento per pubblicare. Non è stato pubblicato niente.',
      'Da qui non posso cambiare questi permessi: servono le impostazioni.',
      'Il sito ha bloccato la richiesta (403): riprovo più tardi da un’altra fonte.',
      'Il web non è bloccato?',
      'Non è un rifiuto dell’utente: il web non mi è stato negato, ce l’ha Pixel.',
      'Mi hai detto di non usare il web per questa ricerca, quindi ho usato solo le note.',
      // Somebody it does not name.
      'Non ha il permesso del web, quindi la ricerca la faccio io.',
      'Ho registrato fornitori ed eventi e sono pronte le bozze dei testi.',
    ]) {
      expect(findAccessClaims(text, CTX), text).toEqual([]);
    }
  });

  it('reads a refusal of the user, by name too', () => {
    expect(
      findAccessClaims('Hai detto no alla mail, quindi non l’ho mandata.', CTX)[0],
    ).toMatchObject({ user: true });
    expect(findAccessClaims('Alice ha rifiutato l’accesso a Canva.', CTX)[0]).toMatchObject({
      user: true,
      services: ['Canva'],
    });
    expect(findAccessClaims('Non mi hai dato il permesso per il terminale.', CTX)[0]).toMatchObject(
      {
        user: true,
        terminal: true,
      },
    );
  });
});

describe('judgeAccessClaims', () => {
  it('flags the texts of 19/10 against the state of that evening', () => {
    for (const text of [
      NOVA_NO_DATA,
      NOVA_MEMORY,
      LUNA_DENIED,
      DONT_ASK,
      DONT_ASK_MEMORY,
      NON_CHIEDERE,
      NESSUN_MOSTRO,
    ]) {
      expect(unbacked(text, ALL_ON).length, text).toBeGreaterThan(0);
    }
    // Luna had no web: "negato" is still false (D-026 is not a no of the user).
    expect(unbacked(LUNA_DENIED, CAPO).map((u) => u.truth.join(' '))[0]).toContain(
      'ce l’hanno Nova, Pixel',
    );
    // Canva connected but not ticked in the project: "non è collegato" is false.
    expect(unbacked(CANVA, CAPO)[0]!.truth.join(' ')).toContain('non a questo progetto');
    // Nova without web_search in its agent.yaml, permission on: not "non ha il permesso".
    expect(unbacked(NOVA_PERMESSO, CAPO)).toHaveLength(1);
    // Pixel has the web: "nessun mostro" is false.
    expect(unbacked(NESSUN_MOSTRO, CAPO)[0]!.truth.join(' ')).toContain('Pixel');
  });

  it('keeps what is true: a setting off, a service not connected, a plain lack', () => {
    const off: AccessState = {
      ...CAPO,
      web: {
        has: false,
        off: true,
        why: 'il permesso «Il web» è spento in Impostazioni → Permessi',
      },
      members: [{ name: 'Nova', web: { has: false, off: true } }],
    };
    expect(unbacked('La ricerca web è disattivata nei permessi.', off)).toEqual([]);
    expect(unbacked('Il web mi è stato negato.', off)).toEqual([]);
    expect(unbacked('Nova non ha il permesso di ricerca web.', off)).toEqual([]);
    expect(unbacked('Nessun mostro può accedere al web.', off)).toEqual([]);
    expect(
      unbacked('Notion non è collegato: lo colleghi da Impostazioni → App e Telegram.', ALL_ON),
    ).toEqual([]);
    // The words of the core (D-127) repeated by a monster without the web: true.
    expect(
      unbacked(
        'WebSearch di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu.',
        CAPO,
      ),
    ).toEqual([]);
    // Without the web in this run, "non riesco a cercare online" is true.
    expect(unbacked('Non riesco a cercare online.', CAPO)).toEqual([]);
    // With the web it is not.
    expect(unbacked('Non riesco a cercare online.', ALL_ON)).toHaveLength(1);
  });

  it('a no of the user in the log backs "hai detto no"; without it, it is flagged', () => {
    const text = 'Hai detto no: non ho mandato la mail a Marco.';
    expect(
      unbacked(text, ALL_ON, { userNo: ['Hai detto no: Rhea non farà la mail'], toolCauses: [] }),
    ).toEqual([]);
    const flagged = unbacked(text, ALL_ON);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.truth[0]).toContain('nessun no dell’utente');
  });
});

describe('runAccessFacts', () => {
  it('reads the no of a brake card, of a question and of an access request', () => {
    const log = memoryLog();
    const runId = '01M5AMXSA6RVBQQBRWBCFNEZ2V';
    log.append({
      agent: 'system',
      runId,
      type: 'instinct',
      data: {
        use: 'outbound',
        action: 'outbound_refused',
        message: 'Hai detto no: Rhea non farà scrivere a Marco.',
        details: { outcome: 'refused' },
      },
    });
    log.append({
      agent: 'system',
      runId,
      type: 'instinct',
      data: {
        use: 'outbound',
        action: 'outbound_refused',
        message: 'Nessuna risposta: Rhea non ha fatto scrivere a Marco.',
        details: { outcome: 'expired' },
      },
    });
    expect(runAccessFacts(log, { runId, agentId: 'rhea' }).userNo).toEqual([
      'Hai detto no: Rhea non farà scrivere a Marco.',
    ]);

    // A question answered «No» in another run (a parked card).
    log.append({
      agent: 'luna',
      runId: 'other',
      type: 'question',
      data: {
        questionId: 'q1',
        question: 'Do il web a Nova?',
        options: [
          { id: '1', label: 'Sì, concedi' },
          { id: '2', label: 'No' },
        ],
        blocking: true,
        kind: 'access',
      },
    });
    log.append({
      agent: 'user',
      runId: 'other',
      type: 'answer',
      data: { questionId: 'q1', optionId: '2' },
    });
    expect(runAccessFacts(log, { runId: 'new', agentId: 'luna' }).userNo).toHaveLength(1);
    expect(runAccessFacts(log, { runId: 'new', agentId: 'nova' }).userNo).toEqual([]);
  });

  it('collects the causes the failed tools wrote', () => {
    const log = memoryLog();
    log.append({
      agent: 'nova',
      runId: 'r',
      type: 'tool_result',
      data: {
        callId: 'c',
        tool: 'claude-agent.WebSearch',
        ok: false,
        error:
          'WebSearch di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu.',
        refusal: 'not_in_run',
      },
    });
    log.append({
      agent: 'nova',
      runId: 'r',
      type: 'tool_result',
      data: { callId: 'd', tool: 'vault_read', ok: false, error: 'nota non trovata' },
    });
    expect(runAccessFacts(log, { runId: 'r', agentId: 'nova' }).toolCauses).toEqual([
      'WebSearch di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu.',
    ]);
  });
});

describe('accessCheck', () => {
  it('reminds once, logs it, and names the causes', () => {
    const log = memoryLog();
    const check = accessCheck({
      log,
      agent: { id: 'luna', name: 'Luna' },
      runId: 'r',
      context: () => CTX,
      state: () => CAPO,
    });
    const reminder = check.hook(LUNA_DENIED);
    expect(reminder).toContain('[Controllo del sistema]');
    expect(reminder).toContain('Il web mi è stato negato in questa sessione');
    expect(reminder).toContain('ce l’hanno Nova, Pixel');
    // Once per turn.
    expect(check.hook(LUNA_DENIED)).toBeNull();
    const events = log.query({ type: 'instinct' });
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ action: 'access_claim', subject: 'luna' });
  });

  it('says nothing for a true no of the user, nor computes the state without a claim', () => {
    const log = memoryLog();
    log.append({
      agent: 'system',
      runId: 'r',
      type: 'instinct',
      data: {
        use: 'outbound',
        action: 'outbound_refused',
        message: 'Hai detto no: Rhea non farà scrivere a Marco.',
        details: { outcome: 'refused' },
      },
    });
    let computed = 0;
    const check = accessCheck({
      log,
      agent: { id: 'rhea', name: 'Rhea' },
      runId: 'r',
      context: () => CTX,
      state: () => {
        computed++;
        return ALL_ON;
      },
    });
    expect(check.hook('Ho preparato la bozza della mail nelle note.')).toBeNull();
    expect(computed).toBe(0);
    expect(check.hook('Hai detto no, quindi la mail a Marco non è partita.')).toBeNull();
  });

  it('corrects an answer that cannot be sent back (Codex)', () => {
    const check = accessCheck({
      log: memoryLog(),
      agent: { id: 'nova', name: 'Nova' },
      runId: 'r',
      context: () => CTX,
      state: () => ALL_ON,
    });
    expect(check.correct(NOVA_NO_DATA)).toContain('[Nota di Monsters]');
  });
});

describe('memory and summaries (D-141)', () => {
  it('a line about accesses is not memory', () => {
    for (const line of [
      'in questa sessione la ricerca web è bloccata dai permessi. Prima di un incarico che la richiede, conviene verificare che sia concessa.',
      'La ricerca web è negata in modalità «don’t ask»: va concessa prima degli incarichi che la richiedono.',
      'Canva non è tra i miei strumenti: va chiesto a Alice.',
      'Il connettore di Figma non è collegato.',
    ]) {
      expect(isAccessClaim(line, CTX), line).toBe(true);
    }
    for (const line of [
      'Alice preferisce i post con tre hashtag al massimo.',
      'L’evento del 20/10 è alla Libreria Aurora, 5 €.',
      'Per i prezzi dei fornitori la fonte migliore è il listino di ottobre.',
    ]) {
      expect(isAccessClaim(line, CTX), line).toBe(false);
    }
  });

  it('the summary of 19/10 loses its lines about accesses, not the decisions of the user', () => {
    const summary = [
      '## Decisioni (dell’utente e dell’assistente)',
      '- Canva non è collegato. L’utente può collegarlo da Impostazioni → App e Telegram.',
      '- Nova non ha il permesso di ricerca web.',
      '- L’utente ha deciso di pubblicare la storia del 20/10 senza tag.',
      '## Fatti dati dall’utente (preferenze, nomi, numeri)',
      '- Evento del 24/10 al Caffè Centrale: 10 €, ingresso libero per i soci.',
    ].join('\n');
    const out = withoutAccessClaims(summary, CTX);
    expect(out.dropped).toHaveLength(2);
    expect(out.text).toContain('pubblicare la storia del 20/10 senza tag');
    expect(out.text).toContain('Caffè Centrale');
    expect(out.text).not.toContain('Canva non è collegato');
  });
});
