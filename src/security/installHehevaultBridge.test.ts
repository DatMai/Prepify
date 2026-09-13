import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bridgePlistFileName,
  defaultLaunchAgentsDir,
  installBridgePlist,
  renderBridgePlist,
} from '../../scripts/installHehevaultBridge.mjs';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('HeheVault bridge launchd installer', () => {
  it('writes a plist that invokes server/dist/bridge/index.js', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-launchagent-'));
    tempRoots.push(dir);
    const repoRoot = path.join(dir, 'repo');
    const nodeExecutable = '/usr/local/bin/node';
    const expectedEntry = path.join(repoRoot, 'server', 'dist', 'bridge', 'index.js');

    const destination = await installBridgePlist({
      launchAgentsDir: dir,
      repoRoot,
      nodeExecutable,
    });

    expect(destination).toBe(path.join(dir, bridgePlistFileName()));
    const content = await fs.readFile(destination, 'utf8');
    expect(content).toContain('com.prepify.hehevault-bridge');
    expect(content).toContain(nodeExecutable);
    expect(content).toContain(expectedEntry);
    expect(content).toMatch(/server[/\\]dist[/\\]bridge[/\\]index\.js/);
  });

  it('never embeds bridge secrets or the vault path, even when they are in the environment', async () => {
    process.env.OBSIDIAN_BRIDGE_TOKEN = 'sentinel-bridge-token-0123456789abcdef0123456789';
    process.env.OBSIDIAN_VAULT_PATH = '/Users/owner/private/second-brain';
    try {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-launchagent-secret-'));
      tempRoots.push(dir);
      const destination = await installBridgePlist({
        launchAgentsDir: dir,
        repoRoot: path.join(dir, 'repo'),
        nodeExecutable: '/usr/bin/node',
      });

      const content = await fs.readFile(destination, 'utf8');
      expect(content).not.toContain('sentinel-bridge-token');
      expect(content).not.toContain('/Users/owner/private/second-brain');
      expect(content).not.toContain('OBSIDIAN_BRIDGE_TOKEN');
      expect(content).not.toContain('OBSIDIAN_VAULT_PATH');
    } finally {
      delete process.env.OBSIDIAN_BRIDGE_TOKEN;
      delete process.env.OBSIDIAN_VAULT_PATH;
    }
  });

  it('escapes XML metacharacters in the rendered plist', () => {
    const plist = renderBridgePlist({
      nodeExecutable: '/usr/bin/node&co',
      bridgeEntry: '/repo/server/dist/bridge/index<v2>.js',
      workingDirectory: '/repo/"server"',
    });

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('<key>Label</key>');
    expect(plist).toContain('<string>com.prepify.hehevault-bridge</string>');
    expect(plist).toContain('<key>ProgramArguments</key>');
    expect(plist).toContain('<string>/usr/bin/node&amp;co</string>');
    expect(plist).toContain('<string>/repo/server/dist/bridge/index&lt;v2&gt;.js</string>');
    expect(plist).toContain('<string>/repo/&quot;server&quot;</string>');
    expect(plist).not.toContain('/usr/bin/node&co');
    expect(plist).not.toContain('index<v2>');
  });

  it('targets the user LaunchAgents directory by default without touching it', () => {
    expect(defaultLaunchAgentsDir('/home/owner')).toBe(
      path.join('/home/owner', 'Library', 'LaunchAgents'),
    );
    expect(bridgePlistFileName()).toBe('com.prepify.hehevault-bridge.plist');
  });
});
