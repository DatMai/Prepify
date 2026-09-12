export interface PrivateBundleLeak {
  source: string;
  bundle: string;
  text: string;
}

export interface PrivateBundleScanOptions {
  contentRoot: string;
  bundleRoot: string;
  minimumLength?: number;
}

export function findPrivateBundleLeaks(
  options: PrivateBundleScanOptions,
): Promise<PrivateBundleLeak[]>;
