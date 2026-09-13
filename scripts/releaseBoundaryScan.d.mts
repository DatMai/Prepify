export type ReleaseBoundaryIssueCode =
  | 'tracked_content'
  | 'tracked_env'
  | 'migration_duplicate_prefix'
  | 'missing_required_doc'
  | 'legacy_claude_surface';

export interface ReleaseBoundaryIssue {
  code: ReleaseBoundaryIssueCode;
  /** A path, a numeric migration prefix, or a document name. Never file contents. */
  detail: string;
}

export interface ReleaseBoundaryInput {
  trackedFiles?: string[];
  migrationFiles?: string[];
  existingPaths?: string[];
  requiredPaths?: string[];
}

export declare const REQUIRED_PATHS: string[];

export function scanReleaseBoundaries(input: ReleaseBoundaryInput): ReleaseBoundaryIssue[];
