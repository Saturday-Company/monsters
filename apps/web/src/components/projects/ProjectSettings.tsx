import type { ProjectView } from '@monsters/shared';
import { ArchiveProject } from './ArchiveProject.tsx';
import { ProjectFolder, ProjectLinks, ProjectSpend } from './ProjectSections.tsx';

/**
 * A project's Settings tab: its folder, apps, spending and the archive, one under the other on
 * a page that scrolls, so the tab bar stays at five. A part has an anchor (`project-settings-<part>`)
 * the old tabs' names scroll to (`PROJECT_ALIASES`).
 */
export function ProjectSettings({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  return (
    <>
      <div id="project-settings-cartella" className="grid scroll-mt-4 gap-7">
        <ProjectFolder p={p} onChanged={onChanged} />
      </div>
      <div id="project-settings-collegamenti" className="grid scroll-mt-4 gap-7">
        <ProjectLinks p={p} onChanged={onChanged} />
      </div>
      <div id="project-settings-spesa" className="grid scroll-mt-4 gap-7">
        <ProjectSpend p={p} onChanged={onChanged} />
      </div>
      <div id="project-settings-archivio" className="grid scroll-mt-4 gap-7">
        <ArchiveProject p={p} onChanged={onChanged} />
      </div>
    </>
  );
}
