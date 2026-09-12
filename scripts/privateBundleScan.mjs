import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function filesUnder(root, extension) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return filesUnder(target, extension);
      return entry.isFile() && entry.name.endsWith(extension) ? [target] : [];
    }),
  );
  return files.flat().sort();
}

function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

export async function findPrivateBundleLeaks({ contentRoot, bundleRoot, minimumLength = 40 }) {
  const [contentFiles, bundleFiles] = await Promise.all([
    filesUnder(contentRoot, '.json'),
    filesUnder(bundleRoot, '.js'),
  ]);
  const bundles = await Promise.all(
    bundleFiles.map(async (file) => ({
      file,
      content: await fs.readFile(file, 'utf8'),
    })),
  );
  const leaks = [];

  for (const sourceFile of contentFiles) {
    const parsed = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
    const privateStrings = [
      ...new Set(stringsIn(parsed).filter((text) => text.length >= minimumLength)),
    ];

    for (const text of privateStrings) {
      const escapedText = JSON.stringify(text).slice(1, -1);
      for (const bundle of bundles) {
        if (bundle.content.includes(text) || bundle.content.includes(escapedText)) {
          leaks.push({
            source: path.relative(contentRoot, sourceFile),
            bundle: path.relative(bundleRoot, bundle.file),
            text,
          });
        }
      }
    }
  }

  return leaks;
}

async function main() {
  const projectRoot = process.cwd();
  const leaks = await findPrivateBundleLeaks({
    contentRoot: path.join(projectRoot, 'content'),
    bundleRoot: path.join(projectRoot, 'dist'),
  });

  if (leaks.length > 0) {
    const locations = leaks.map(({ source, bundle }) => `${source} -> ${bundle}`).join('\n');
    throw new Error(`Private corpus text found in the frontend bundle:\n${locations}`);
  }

  process.stdout.write('Private bundle scan passed.\n');
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Private bundle scan failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
