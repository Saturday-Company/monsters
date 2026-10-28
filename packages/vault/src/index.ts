import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export * from './service.ts';
export * from './tools.ts';
export { withVaultScope, currentVaultScope } from './scope.ts';
export { isFilesPath } from './paths.ts';
export { detectVaultLayout, readVaultLayoutRecord, writeVaultLayoutRecord } from './layout.ts';
export {
  fixAgentEditOps,
  fixAgentWrite,
  fixUrlWikilinks,
  linkBareSources,
  linkText,
  naturalNotePath,
  type LinkTitle,
} from './note-fixes.ts';
export {
  VaultIndex,
  ftsQuery,
  ftsAnyQuery,
  localIso,
  type NoteRow,
  type SearchHit,
  type SearchFilters,
} from './index-db/vault-index.ts';
export { vaultMigrations } from './index-db/schema.ts';
export {
  VaultPermissions,
  EXTERNAL_ACTOR_PREFIX,
  isExternalActor,
  type AgentVaultProfile,
  type VaultPermissionsConfig,
} from './permissions.ts';
export { parseNote, expandTag, type ParsedNote } from './markdown/parse.ts';
export {
  extractLinks,
  extractInlineTags,
  type ParsedLink,
  type ParsedTag,
} from './markdown/links.ts';
export {
  scanMarkdown,
  findSection,
  findSectionLoose,
  lookupSections,
  normalizeHeading,
  type Scan,
  type Heading,
  type Section,
  type SectionMatch,
} from './markdown/scan.ts';
export {
  readFrontmatter,
  updateFrontmatter,
  buildFrontmatter,
  type Props,
} from './markdown/frontmatter.ts';
export { applyOps, applyOp, type EditOp } from './markdown/edit.ts';
export { EditOpSchema, EditOpsSchema } from './schemas.ts';
export { lineDiff } from './diff.ts';
export { contentHash } from './fsutil.ts';
export type { VaultVcs, VcsKind, CommitInfo, CommitResult, GitAuthor } from './git/vcs.ts';
export { VAULT_FOLDERS, VAULT_GITIGNORE, vaultFolders, scaffoldFiles } from './scaffold.ts';
export {
  WorkerEmbedder,
  EmbedBatchError,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_FILE,
  DEFAULT_MODEL_SPEC,
  SemanticUnavailableError,
  TRANSFORMERS_PACKAGE,
  asSemanticUnavailable,
  transformersInstalled,
  type Embedder,
  type EmbedderLoader,
  type ModelOptions,
} from './semantic/embedder.ts';
export {
  ensureModelFiles,
  type ModelFile,
  type ModelSpec,
  type EnsureModelOptions,
} from './semantic/model-files.ts';
export {
  SemanticIndex,
  type SemanticState,
  type SemanticStatus,
  type SemanticIndexOptions,
  type ChunkHit,
  type RelatedScore,
  robustStats,
} from './semantic/semantic-index.ts';
export {
  RELATED_LIMIT,
  RELATED_MIN_Z,
  pickRelated,
  relationBonus,
  type RelationSignals,
} from './semantic/related.ts';
export {
  chunkNote,
  embedText,
  splitLong,
  CHUNK_MAX_CHARS,
  type NoteChunk,
} from './semantic/chunk.ts';
export { stemWord, stemText } from './semantic/stem.ts';
export { rrfFuse, RRF_K } from './semantic/rrf.ts';

/** Default index location: `<home>/index/<vault-id>.sqlite`, outside the vault. */
export function defaultIndexPath(home: string, vaultRoot: string): string {
  let real = resolve(vaultRoot);
  try {
    real = realpathSync(real);
  } catch {
    // The vault may not exist yet.
  }
  const id = createHash('sha256').update(real).digest('hex').slice(0, 16);
  return join(home, 'index', `${id}.sqlite`);
}
