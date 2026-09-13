export interface JourneyTask {
  id: string;
  checked: boolean;
  text: string;
  tags: string[];
}

export interface JourneyJournal {
  done: string;
  blocked: string;
  next: string;
}

export interface JourneyListItem {
  text: string;
  checked: boolean | null;
}

/**
 * A faithful, non-Markdown view of one Journey-owned Daily section, so the page
 * can show the recall callouts and `###` sub-sections a note actually contains.
 */
export type JourneyBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: JourneyListItem[] }
  | { kind: 'quote'; label: string; title: string; lines: string[]; collapsed: boolean };

export interface JourneySnapshot {
  date: string;
  revision: string;
  mtimeMs: number;
  obsidianUri: string;
  stage: string;
  tasks: JourneyTask[];
  evidence: string[];
  journal: JourneyJournal;
  blocks: JourneyBlock[];
}
