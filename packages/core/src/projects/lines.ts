import { projectPrompts } from './projects.prompts.ts';

/*
 * The lines of the projects' loop that the models read (D-097): who wrote a
 * message of `project_send`, and how a lead's report reaches the orchestrator.
 */

/** What a lead reads before a message the orchestrator wrote with `project_send`. */
export function fromLine(name: string): string {
  return projectPrompts().fromLead(name);
}
