import { pick, type Lang } from '@monsters/shared';

/*
 * The first start's texts that a person reads (D-153): the first message of the
 * orchestrator, and the lines in the log. The profile and team-generation
 * prompts are for the models and stay where they are (wave 3).
 */

const en = {
  welcomeNoModel: (user: string, me: string, team: string) =>
    `Hi ${user}! I’m ${me}, I coordinate your squad: with me there are ${team}. To get to work I only need a model: connect one and we start.`,
  welcome: (user: string, me: string, team: string) =>
    `Hi ${user}! I’m ${me}, I coordinate your squad. With me there are ${team}. Tell me what you need and we’ll take it from there: for the things you asked me to check with you, I’ll ask first.`,
  steps: {
    folders: 'the monsters’ folders',
    models: 'the models',
    vault: 'the notes areas',
    settings: 'the settings',
    profile: 'the profile',
    welcome: 'the welcome',
  },
  teamQuestion: 'Which squad is needed?',
  teamFromModel: (model: string) => `proposed by the model ${model}`.trim(),
  teamStarter: 'starting squad (Rhea and Dione)',
  incompleteGaveUp: (attempts: number, left: string) =>
    `the squad wasn’t completed after ${attempts} attempts: I’m not trying again. Missing: ${left}. Check Settings.`,
  incomplete: (message: string) => `the squad wasn’t completed: ${message}`,
  coordinatorRenamed: 'onboarding: another name for the coordinator',
  basicSquad:
    'I couldn’t put together a squad made for you: I’m proposing the basic one, which you can change.',
};

const it: typeof en = {
  welcomeNoModel: (user, me, team) =>
    `Ciao ${user}! Sono ${me} e coordino la tua squadra: con me ci sono ${team}. Per lavorare mi manca solo un modello: collegane uno e partiamo.`,
  welcome: (user, me, team) =>
    `Ciao ${user}! Sono ${me} e coordino la tua squadra. Con me ci sono ${team}. Scrivimi quello che ti serve e ci pensiamo noi: per le cose che mi hai indicato, prima chiedo a te.`,
  steps: {
    folders: 'le cartelle dei mostri',
    models: 'i modelli',
    vault: 'le aree del vault',
    settings: 'le impostazioni',
    profile: 'il profilo',
    welcome: 'il benvenuto',
  },
  teamQuestion: 'Quale squadra serve?',
  teamFromModel: (model) => `proposta del modello ${model}`.trim(),
  teamStarter: 'squadra di partenza (Rhea e Dione)',
  incompleteGaveUp: (attempts, left) =>
    `la squadra non è stata completata dopo ${attempts} tentativi: non riprovo più. Mancano: ${left}. Controlla Impostazioni.`,
  incomplete: (message) => `la squadra non è stata completata: ${message}`,
  coordinatorRenamed: 'onboarding: altro nome del coordinatore',
  basicSquad:
    'Non sono riuscito a preparare una squadra su misura per te: ti propongo quella di base, che puoi cambiare.',
};

/** The dictionary of the app's language, or of the one asked (the monsters’ own, for the welcome). */
export const onboardingStrings = (lang?: Lang) => pick({ en, it }, lang);
