export interface OfflineManifest {
  schemaVersion: number;
  version: string;
  assets: string[];
}
export function isApplicationAsset(path: string): boolean;
export function workerSource(
  manifest: Pick<OfflineManifest, "version" | "assets">,
): string;
export function buildOffline(outDir?: string): Promise<OfflineManifest>;
