import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPrivateBundleLeaks } from '../../scripts/privateBundleScan.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ contentRoot: string; bundleRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-bundle-scan-'));
  temporaryRoots.push(root);
  const contentRoot = path.join(root, 'content');
  const bundleRoot = path.join(root, 'dist');
  await fs.mkdir(contentRoot);
  await fs.mkdir(bundleRoot);
  return { contentRoot, bundleRoot };
}

describe('private bundle scan', () => {
  it('reports a long private corpus string copied into a JavaScript bundle', async () => {
    const { contentRoot, bundleRoot } = await fixture();
    const privateText =
      'A private study explanation that must never ship in the public browser bundle.';
    await fs.writeFile(path.join(contentRoot, 'topic.json'), JSON.stringify({ text: privateText }));
    await fs.writeFile(
      path.join(bundleRoot, 'app.js'),
      `const leaked = ${JSON.stringify(privateText)};`,
    );

    await expect(findPrivateBundleLeaks({ contentRoot, bundleRoot })).resolves.toEqual([
      { source: 'topic.json', bundle: 'app.js', text: privateText },
    ]);
  });

  it('ignores short labels and passes when private text is absent', async () => {
    const { contentRoot, bundleRoot } = await fixture();
    await fs.writeFile(
      path.join(contentRoot, 'topic.json'),
      JSON.stringify({
        label: 'Arrays',
        text: 'A sufficiently long private explanation for the scanner.',
      }),
    );
    await fs.writeFile(path.join(bundleRoot, 'app.js'), 'const label = "Arrays";');

    await expect(findPrivateBundleLeaks({ contentRoot, bundleRoot })).resolves.toEqual([]);
  });
});
