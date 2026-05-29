import type { Topic, TopicIndexEntry } from '../types/quiz';

const topicModules = import.meta.glob<Topic>('../../content/*.json', {
  eager: true,
  import: 'default',
});

import indexJson from '../../content/index.json';

export const TOPIC_INDEX: TopicIndexEntry[] = indexJson as TopicIndexEntry[];

export const ORDER: string[] = TOPIC_INDEX.map((t) => t.key);

export const DATA: Record<string, Topic> = {};
for (const [filePath, mod] of Object.entries(topicModules)) {
  const key = filePath.replace(/^.*\/([^/]+)\.json$/, '$1');
  if (key === 'index') continue;
  DATA[key] = mod;
}
