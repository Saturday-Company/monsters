import { SETTINGS_SECTIONS, settingsPath } from '@monsters/shared';

/*
 * The places of the app the hints of the system tools name (D-133, D-153): written as the app
 * shows them in the language in use, whenever a hint is built.
 */

/** Where the user grants folders and the terminal ("Settings → Permissions"). */
export const permissionsPlace = (): string => settingsPath('permessi');

/** The name of the terminal permission in that place ("Terminal"). */
export const terminalName = (): string => SETTINGS_SECTIONS.terminale.label;
