import type { ProjectView } from '@monsters/shared';
import { useState } from 'react';
import { describeError } from '../../lib/api.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { refreshProjects } from '../../store/projects.ts';
import { ConfirmButton, Group, Row } from '../settings/parts.tsx';
import { projectsStrings } from './projects.strings.ts';

/**
 * "Archive the project" (D-100), at the foot of the Folder tab: the squad
 * tab is for who works in the project, not for taking it away. Archived, never
 * deleted: its monsters go with it and stop working.
 */
export function ArchiveProject({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const s = projectsStrings().archive;
  const [archiving, setArchiving] = useState(false);
  const archive = async () => {
    setArchiving(true);
    try {
      onChanged(await getApi().archiveProject(p.id));
      notify(s.done(p.name), 'success');
      void refreshAgents().catch(() => {});
      void refreshProjects();
    } catch (err) {
      notify(describeError(err), 'error');
      setArchiving(false);
    }
  };

  return (
    <Group title={s.title} testId="project-archive" description={s.description}>
      <Row label={p.name} description={s.rowDescription}>
        <ConfirmButton
          label={s.label}
          question={s.question}
          confirm={s.confirm}
          busy={archiving}
          onConfirm={() => void archive()}
        />
      </Row>
    </Group>
  );
}
