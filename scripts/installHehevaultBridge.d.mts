export interface RenderBridgePlistOptions {
  nodeExecutable: string;
  bridgeEntry: string;
  workingDirectory: string;
}

export function renderBridgePlist(options: RenderBridgePlistOptions): string;

export interface InstallBridgePlistOptions {
  launchAgentsDir?: string;
  repoRoot?: string;
  nodeExecutable?: string;
}

export function installBridgePlist(options?: InstallBridgePlistOptions): Promise<string>;

export function bridgePlistFileName(): string;
export function defaultLaunchAgentsDir(homeDir?: string): string;
