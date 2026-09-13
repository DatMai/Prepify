import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LABEL = 'com.prepify.hehevault-bridge';
const PLIST_FILE_NAME = `${LABEL}.plist`;

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the launchd plist from resolved repository and Node paths only. The
 * bridge token and the vault path are never inputs here and never appear in
 * the generated plist.
 */
export function renderBridgePlist({ nodeExecutable, bridgeEntry, workingDirectory }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeExecutable)}</string>
    <string>${escapeXml(bridgeEntry)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
</dict>
</plist>
`;
}

export function bridgePlistFileName() {
  return PLIST_FILE_NAME;
}

export function defaultLaunchAgentsDir(homeDir = os.homedir()) {
  return path.join(homeDir, 'Library', 'LaunchAgents');
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Writes `com.prepify.hehevault-bridge.plist` into `launchAgentsDir` (defaults
 * to `~/Library/LaunchAgents`). This is an explicit human setup step: it only
 * renders a file and never loads, unloads, or replaces a running agent.
 */
export async function installBridgePlist({
  launchAgentsDir = defaultLaunchAgentsDir(),
  repoRoot = defaultRepoRoot(),
  nodeExecutable = process.execPath,
} = {}) {
  const bridgeEntry = path.join(repoRoot, 'server', 'dist', 'bridge', 'index.js');
  const workingDirectory = path.join(repoRoot, 'server');
  const plist = renderBridgePlist({ nodeExecutable, bridgeEntry, workingDirectory });

  await fs.mkdir(launchAgentsDir, { recursive: true });
  const destination = path.join(launchAgentsDir, PLIST_FILE_NAME);
  await fs.writeFile(destination, plist, 'utf8');
  return destination;
}

async function main() {
  const destination = await installBridgePlist();
  console.log(`Installed ${destination}`);
  console.log(`Start it with: launchctl load ${destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
