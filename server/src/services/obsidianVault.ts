import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DailyFormatError,
  appendEvidence,
  parseDaily,
  replaceJournal,
  revisionFor,
  setTaskCompleted,
  touchUpdated,
  type JourneyJournal,
  type ParsedDaily,
} from './obsidianMarkdown';

export interface JourneySnapshot extends ParsedDaily {
  date: string;
  revision: string;
  mtimeMs: number;
  obsidianUri: string;
}

export class VaultError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RawDaily {
  filePath: string;
  content: string;
  mode: number;
  mtimeMs: number;
}
interface VaultConfig {
  enabled: boolean;
  vaultPath?: string;
  timeZone: string;
}
interface VaultDependencies {
  now?: () => Date;
  randomId?: () => string;
}

export interface ObsidianVault {
  getTodayJourney(): Promise<JourneySnapshot>;
  updateTodayTask(input: {
    taskId: string;
    completed: boolean;
    evidence?: string;
    expectedRevision: string;
    eventId?: string;
  }): Promise<JourneySnapshot>;
  saveTodayJournal(journal: JourneyJournal, expectedRevision: string): Promise<JourneySnapshot>;
  addTodayEvidence(input: {
    evidence: string;
    expectedRevision: string;
    eventId: string;
  }): Promise<JourneySnapshot>;
}

export function dateInTimeZone(now = new Date(), timeZone = 'Asia/Ho_Chi_Minh'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function createObsidianVault(
  config: VaultConfig,
  dependencies: VaultDependencies = {},
): ObsidianVault {
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;
  let mutationQueue: Promise<void> = Promise.resolve();

  function vaultRoot(): string {
    if (!config.enabled) throw new VaultError(503, 'vault_disabled', 'Obsidian sync is disabled');
    if (!config.vaultPath) {
      throw new VaultError(503, 'vault_not_configured', 'Obsidian vault path is not configured');
    }
    return path.resolve(config.vaultPath);
  }

  async function resolveTodayFile(date: string): Promise<string> {
    const configuredRoot = vaultRoot();
    let root: string;
    let dailyDir: string;
    try {
      root = await fs.realpath(configuredRoot);
      dailyDir = await fs.realpath(path.join(root, 'Daily'));
    } catch {
      throw new VaultError(
        503,
        'vault_unavailable',
        'The configured Obsidian vault is unavailable',
      );
    }
    if (path.dirname(dailyDir) !== root || path.basename(dailyDir) !== 'Daily') {
      throw new VaultError(403, 'vault_scope_invalid', 'Daily directory is outside the vault');
    }
    const candidate = path.join(dailyDir, `${date}.md`);
    let stats;
    try {
      stats = await fs.lstat(candidate);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new VaultError(404, 'daily_not_prepared', `Daily note ${date} does not exist`);
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new VaultError(403, 'vault_scope_invalid', 'Daily note must be a regular file');
    }
    const resolved = await fs.realpath(candidate);
    if (path.dirname(resolved) !== dailyDir) {
      throw new VaultError(403, 'vault_scope_invalid', 'Daily note escaped the allowed directory');
    }
    return resolved;
  }

  async function readRawDaily(date: string): Promise<RawDaily> {
    const filePath = await resolveTodayFile(date);
    const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
    return { filePath, content, mode: stats.mode, mtimeMs: stats.mtimeMs };
  }

  function snapshot(date: string, raw: RawDaily): JourneySnapshot {
    try {
      return {
        date,
        revision: revisionFor(raw.content),
        mtimeMs: raw.mtimeMs,
        obsidianUri: `obsidian://open?vault=${encodeURIComponent(path.basename(vaultRoot()))}&file=${encodeURIComponent(`Daily/${date}.md`)}`,
        ...parseDaily(raw.content),
      };
    } catch (error) {
      if (error instanceof DailyFormatError) {
        throw new VaultError(422, 'daily_structure_invalid', error.message);
      }
      throw error;
    }
  }

  async function atomicWrite(raw: RawDaily, content: string): Promise<void> {
    const tempPath = path.join(
      path.dirname(raw.filePath),
      `.${path.basename(raw.filePath)}.${process.pid}.${randomId()}.tmp`,
    );
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(tempPath, 'wx', raw.mode & 0o777);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, raw.filePath);
      const directory = await fs.open(path.dirname(raw.filePath), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      if (handle) await handle.close();
      await fs.rm(tempPath, { force: true });
    }
  }

  async function withMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = mutationQueue;
    let release: () => void = () => undefined;
    mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async function mutateToday(
    expectedRevision: string,
    transform: (content: string, date: string) => string,
    eventId?: string,
  ): Promise<JourneySnapshot> {
    return withMutationLock(async () => {
      const date = dateInTimeZone(now(), config.timeZone);
      const raw = await readRawDaily(date);
      const actualRevision = revisionFor(raw.content);
      if (actualRevision !== expectedRevision) {
        if (eventId && raw.content.includes(`<!-- prepify:event id="${eventId}" -->`)) {
          return snapshot(date, raw);
        }
        throw new VaultError(412, 'vault_conflict', 'Daily note changed; reload before saving');
      }
      let next: string;
      try {
        next = transform(raw.content, date);
      } catch (error) {
        if (error instanceof DailyFormatError) {
          throw new VaultError(422, 'daily_structure_invalid', error.message);
        }
        throw error;
      }
      if (next === raw.content) return snapshot(date, raw);
      await atomicWrite(raw, next);
      return snapshot(date, await readRawDaily(date));
    });
  }

  return {
    async getTodayJourney() {
      const date = dateInTimeZone(now(), config.timeZone);
      return snapshot(date, await readRawDaily(date));
    },
    async updateTodayTask(input) {
      if (input.completed && !input.evidence?.trim()) {
        throw new VaultError(
          400,
          'evidence_required',
          'Evidence is required before completing a task',
        );
      }
      return mutateToday(
        input.expectedRevision,
        (content, date) => {
          let next = setTaskCompleted(content, input.taskId, input.completed);
          if (input.evidence && input.eventId)
            next = appendEvidence(next, input.evidence, input.eventId);
          return touchUpdated(next, date);
        },
        input.eventId,
      );
    },
    async saveTodayJournal(journal, expectedRevision) {
      return mutateToday(expectedRevision, (content, date) =>
        touchUpdated(replaceJournal(content, journal), date),
      );
    },
    async addTodayEvidence(input) {
      return mutateToday(
        input.expectedRevision,
        (content, date) =>
          touchUpdated(appendEvidence(content, input.evidence, input.eventId), date),
        input.eventId,
      );
    },
  };
}
