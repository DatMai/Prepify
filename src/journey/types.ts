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

export interface JourneySnapshot {
  date: string;
  revision: string;
  mtimeMs: number;
  obsidianUri: string;
  stage: string;
  tasks: JourneyTask[];
  evidence: string[];
  journal: JourneyJournal;
}
