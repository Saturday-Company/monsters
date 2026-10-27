import { createContext } from 'react';

/**
 * True inside an earlier conversation shown for reading (F-5): what changes things (undoing a
 * job, the buttons of a drawn block) is off there, because the monster no longer reads it.
 */
export const ReadOnlyContext = createContext(false);
