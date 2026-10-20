/*
 * The lines of the projects' loop that the models read (D-097): who wrote a
 * message of `project_send`, and how a lead's report reaches the orchestrator.
 */

/** What a lead reads before a message the orchestrator wrote with `project_send`. */
export function fromLine(name: string): string {
  return `[Da ${name}, che coordina tutte le squadre: il tuo ultimo messaggio torna a lui come rapporto]`;
}
