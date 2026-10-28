import type { AuthContext } from './auth-service.ts';

/*
 * Recent confirmation as a capability, not a list of paths (review of 28/10, weakness 4).
 *
 * Some changes give a monster, or a stranger in a Telegram chat, the power to run code: the
 * Terminal, a program an MCP server launches, the full toolset of a dedicated bot. They want the
 * password typed in the last minutes (`AuthContext.recent`), which a session left open for days
 * does not have. Deciding it from the path of the request let every new route that gave the same
 * power slip by, so the decision lives where the change is made: a service method that can grant
 * such power takes a `RecentProof` as an explicit parameter, works out from the change itself
 * (what it was, what it becomes) whether it grants it, and throws `ConfirmRequiredError` when it
 * does and the proof is missing. A route gets the proof from the caller's session with
 * `recentProofOf`; code with no user in front of it (an access card answered on a phone, a test
 * of something else) passes `undefined` and gets the refusal if the change turns out to grant.
 */

declare const recentBrand: unique symbol;

/** The caller is the user in person and typed the password recently (`recentProofOf`). */
export interface RecentProof {
  readonly [recentBrand]: true;
}

/** The proof of a caller, or undefined when it is not the user in person or not recent enough. */
export function recentProofOf(
  ctx: Pick<AuthContext, 'owner' | 'recent'> | undefined,
): RecentProof | undefined {
  return ctx?.owner === true && ctx.recent ? ({} as RecentProof) : undefined;
}

/**
 * The change needs a recent confirmation and the caller has none. The server answers 403
 * `confirm_required` (`app.onError`): the UI asks the password and sends the request again.
 */
export class ConfirmRequiredError extends Error {
  constructor() {
    super('a recent confirmation of the password is needed');
    this.name = 'ConfirmRequiredError';
  }
}

/** Throws `ConfirmRequiredError` unless the caller has a proof. Call it before changing anything. */
export function assertRecent(proof: RecentProof | undefined): asserts proof is RecentProof {
  if (!proof) throw new ConfirmRequiredError();
}
