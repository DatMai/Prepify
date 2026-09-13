import type { JourneyBlock, JourneyListItem, JourneyTask } from './types';

/**
 * The Journey page renders task lines, but a Daily note carries more than tasks:
 * recall questions the owner wrote as bullets, sub-headings and quotes. Every
 * projected block that sits after a task line and before the next one belongs to
 * that task, so the page can show it inside the task card instead of dropping it.
 *
 * Grouping is positional, not textual: the Nth task line in the blocks is the
 * Nth task, so a task whose text the parser normalised still matches.
 */
export function groupTaskNotes(
  blocks: JourneyBlock[],
  tasks: JourneyTask[],
): Map<string, JourneyBlock[]> {
  const groups = new Map<string, JourneyBlock[]>();
  let pending: JourneyBlock[] = [];
  let index = -1;

  const flush = (): void => {
    const task = index >= 0 ? tasks[index] : undefined;
    if (task && pending.length > 0) {
      groups.set(task.id, [...(groups.get(task.id) ?? []), ...pending]);
    }
    pending = [];
  };

  const appendItem = (ordered: boolean, item: JourneyListItem): void => {
    const last = pending[pending.length - 1];
    if (last && last.kind === 'list' && last.ordered === ordered) {
      last.items.push(item);
      return;
    }
    pending.push({ kind: 'list', ordered, items: [item] });
  };

  for (const block of blocks) {
    // A new top-level section ends the current task's notes.
    if (block.kind === 'heading' && block.level <= 2) {
      flush();
      index = -1;
      continue;
    }

    if (block.kind === 'list' && block.items.some((item) => item.checked !== null)) {
      for (const item of block.items) {
        if (item.checked === null) {
          appendItem(block.ordered, item);
          continue;
        }
        // Each task line opens the group that follows it.
        flush();
        index += 1;
      }
      continue;
    }

    // Copy list blocks: `appendItem` may extend the array it was handed.
    pending.push(block.kind === 'list' ? { ...block, items: [...block.items] } : block);
  }

  flush();
  return groups;
}
