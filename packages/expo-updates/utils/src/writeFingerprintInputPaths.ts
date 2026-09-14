import type { FingerprintSource } from 'expo/fingerprint';
import fs from 'fs';
import path from 'path';

/** Records file dependencies for Gradle without packaging them in the app's assets. */
export function writeFingerprintInputPaths(
  outputFile: string,
  projectRoot: string,
  sources: FingerprintSource[]
): void {
  const files = new Set<string>();
  const directories = new Set<string>();
  for (const source of sources) {
    if (source.type === 'contents') {
      continue;
    }
    const paths = source.type === 'dir' ? directories : files;
    paths.add(path.resolve(projectRoot, source.filePath));
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const temporaryFile = `${outputFile}.tmp`;
  fs.writeFileSync(
    temporaryFile,
    JSON.stringify({ files: [...files].sort(), directories: [...directories].sort() })
  );
  fs.renameSync(temporaryFile, outputFile);
}
