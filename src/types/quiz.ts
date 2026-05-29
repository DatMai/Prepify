export type TextBlock = { type: 'text'; text: string };
export type NoteBlock = { type: 'note'; text: string };
export type CodeBlock = { type: 'code'; lang: string; text: string };
export type TableBlock = { type: 'table'; rows: string[][]; headerDone?: boolean };

export type Block = TextBlock | NoteBlock | CodeBlock | TableBlock;

export interface Question {
  id?: string;
  q: string;
  blocks: Block[];
}

export interface Section {
  name: string;
  questions: Question[];
}

export interface Topic {
  title: string;
  subtitle?: string;
  label: string;
  color: string;
  sections: Section[];
}

export interface TopicIndexEntry {
  key: string;
  label: string;
  title: string;
  subtitle?: string;
  color: string;
  questionCount: number;
}

export type ProgressMap = Record<string, boolean>;
export type OpenMap = Record<string, boolean>;

export interface AppState {
  topic: string;
  quiz: boolean;
  progress: ProgressMap;
  open: OpenMap;
}
