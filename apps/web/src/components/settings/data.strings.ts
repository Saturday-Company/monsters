import { defineStrings } from '../../lib/i18n.ts';

/* Settings: shared sentences (labels of the model services, errors of the team calls) (D-153). */

const en = {
  services: {
    claudeAgent: 'Claude plan',
    codex: 'Codex (for coding)',
  },
  errors: {
    busy: 'A monster is working: wait for it to finish or press Stop, then try again.',
    wrongPassword: 'The current password isn’t right.',
    samePassword: 'The new password is the same as the current one.',
    halted: 'The monsters are stopped: press “Resume”, then try again.',
  },
  nameProblem: 'Letters only, up to 24.',
};

const it: typeof en = {
  services: {
    claudeAgent: 'Piano Claude',
    codex: 'Codex (per programmare)',
  },
  errors: {
    busy: 'Un mostro sta lavorando: aspetta che finiscano o premi Ferma, poi riprova.',
    wrongPassword: 'La password attuale non è giusta.',
    samePassword: 'La nuova password è uguale a quella di adesso.',
    halted: 'I mostri sono fermi: premi “Riprendi”, poi riprova.',
  },
  nameProblem: 'Solo lettere, al massimo 24.',
};

export const dataStrings = defineStrings({ en, it });
