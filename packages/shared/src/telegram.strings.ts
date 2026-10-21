import { pick } from './i18n.ts';

/** The texts of the Telegram helpers shared by the core and the UI (D-153). */
const en = {
  tokenShape:
    'That doesn’t look like a Telegram token: it looks like 123456789:AAE… and you’ll find it in BotFather’s message.',
};

const it: typeof en = {
  tokenShape:
    'Questo non sembra un token di Telegram: è fatto come 123456789:AAE… e lo trovi nel messaggio di BotFather.',
};

export const telegramStrings = () => pick({ en, it });
