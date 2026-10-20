import { AgentPermissionsSettings } from './AgentPermissionsSettings.tsx';
import { AskAlwaysSection } from './AskAlwaysSection.tsx';

/*
 * Settings → Permessi (D-066, D-068): one idea, what the monsters may do. First
 * what they always ask you, then what each of them may use. Who takes the
 * quick decisions (the instinct) is in Squadra; the ways in from outside
 * (Telegram, the web, other programs) are in Collegamenti.
 */
export function PermissionsTab() {
  return (
    <>
      <AskAlwaysSection />
      <AgentPermissionsSettings />
    </>
  );
}
