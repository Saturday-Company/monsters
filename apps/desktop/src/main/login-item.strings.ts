import { pick } from '@monsters/shared';

/*
 * The words of "Open at login" (login-item.ts and its menu item and dialog in index.ts).
 * Typed dictionaries (D-153).
 */

const en = {
  label: 'Open at login',
  unavailable: 'Open at login isn’t available',
  couldntChange: 'The system didn’t let me change it. Try again.',
  pathNotWritable:
    'Monsters’ path can’t be written in the startup file: move the app to a folder with a simple name.',
  onlyInstalledPackage: 'You can only choose it in the installed app (.deb or AppImage).',
  onlyInstalled: 'You can only choose it in the installed app.',
  macApproval:
    'Needs approval in System Settings → General → Login Items: until you approve it, Monsters won’t open on its own.',
  notAvailable: 'Not available on this system.',
};

const it: typeof en = {
  label: 'Apri all’accesso',
  unavailable: 'Apri all’accesso non è disponibile',
  couldntChange: 'Il sistema non mi ha lasciato cambiarlo. Riprova.',
  pathNotWritable:
    'Il percorso di Monsters non si può scrivere nel file di avvio: sposta l’app in una cartella con un nome semplice.',
  onlyInstalledPackage: 'Si può scegliere solo nell’app installata (.deb o AppImage).',
  onlyInstalled: 'Si può scegliere solo nell’app installata.',
  macApproval:
    'Da approvare in Impostazioni di Sistema → Generali → Elementi login: finché non lo approvi Monsters non si apre da solo.',
  notAvailable: 'Non disponibile su questo sistema.',
};

export const loginItemStrings = () => pick({ en, it });
