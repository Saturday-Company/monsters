import type { ProjectView } from '@monsters/shared';
import { useState } from 'react';
import { describeError } from '../../lib/api.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { refreshProjects } from '../../store/projects.ts';
import { ConfirmButton, Group, Row } from '../settings/parts.tsx';

/**
 * "Archivia il progetto" (D-100), at the foot of the Cartella tab: the squad
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
  const [archiving, setArchiving] = useState(false);
  const archive = async () => {
    setArchiving(true);
    try {
      onChanged(await getApi().archiveProject(p.id));
      notify(
        `${p.name} è nell’archivio con i suoi mostri. Note e cartella restano dove sono.`,
        'success',
      );
      void refreshAgents().catch(() => {});
      void refreshProjects();
    } catch (err) {
      notify(describeError(err), 'error');
      setArchiving(false);
    }
  };

  return (
    <Group
      title="Archivia il progetto"
      testId="project-archive"
      description="I suoi mostri vanno nell’archivio con lui e smettono di lavorare; le note e la cartella restano dove sono. Lo puoi ripristinare quando vuoi."
    >
      <Row label={p.name} description="Se lo ripristini, ritrova i suoi mostri con compiti e note.">
        <ConfirmButton
          label="Archivia"
          question="Archiviare il progetto?"
          confirm="Sì, archivia"
          busy={archiving}
          onConfirm={() => void archive()}
        />
      </Row>
    </Group>
  );
}
