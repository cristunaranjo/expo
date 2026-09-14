import type { ChangeEvent } from '@expo/metro/metro-file-map';
import type FileMap from '@expo/metro/metro-file-map';
import path from 'path';

import type { ServerLike } from '../BundlerDevServer';
import { debugEvent } from './typegenEvents';

interface MetroFileWatcherRunner {
  metro: {
    getBundler(): {
      getBundler(): {
        getWatcher(): {
          addListener(...args: Parameters<FileMap['addListener']>): void;
          removeListener(...args: Parameters<FileMap['removeListener']>): void;
        };
      };
    };
  };
  server: Pick<ServerLike, 'addListener'>;
}

/**
 * Use the native file watcher / Metro ruleset to detect if a
 * TypeScript file is added to the project during development.
 */
export function waitForMetroToObserveTypeScriptFile(
  projectRoot: string,
  runner: MetroFileWatcherRunner,
  callback: () => Promise<void>
): () => void {
  // TODO(@kitten): This is highly inefficient. We shouldn't watch all changes to determine this
  // and instead use startup heuristic and do a pre-bundling check
  const watcher = runner.metro.getBundler().getBundler().getWatcher();
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

  const listener = ({ changes, rootDir }: ChangeEvent) => {
    for (const change of changes.addedFiles) {
      const filePath = path.resolve(rootDir, change[0]);
      if (/node_modules/.test(change[0])) {
        // We need to ignore node_modules because Metro will add all of the files in node_modules to the watcher.
        continue;
      } else if (/\.tsx?$/.test(filePath) || filePath === tsconfigPath) {
        // If the user adds a TypeScript file to the observable files in their project.
        debugEvent('ts_file_added', { path: debugEvent.path(filePath) });
        callback();
        off();
        return;
      }
    }
  };

  watcher.addListener('change', listener);
  const off = () => {
    watcher.removeListener('change', listener);
  };
  runner.server.addListener?.('close', off);
  return off;
}

export function observeFileChanges(
  runner: MetroFileWatcherRunner,
  files: string[],
  callback: () => void | Promise<void>
): () => void {
  const watcher = runner.metro.getBundler().getBundler().getWatcher();
  const watchFilePaths = new Set(files);

  const listener = ({ changes, rootDir }: ChangeEvent) => {
    for (const change of changes.addedFiles) {
      const filePath = path.resolve(rootDir, change[0]);
      if (/node_modules/.test(change[0])) {
        // We need to ignore node_modules because Metro will add all of the files in node_modules to the watcher.
        continue;
      } else if (watchFilePaths.has(filePath)) {
        debugEvent('file_observed', { path: debugEvent.path(filePath) });
        callback();
        return;
      }
    }
    for (const change of changes.modifiedFiles) {
      const filePath = path.resolve(rootDir, change[0]);
      if (/node_modules/.test(change[0])) {
        // We need to ignore node_modules because Metro will add all of the files in node_modules to the watcher.
        continue;
      } else if (watchFilePaths.has(filePath)) {
        debugEvent('file_observed', { path: debugEvent.path(filePath) });
        callback();
        return;
      }
    }
  };
  watcher.addListener('change', listener);
  const off = () => {
    watcher.removeListener('change', listener);
  };
  runner.server.addListener?.('close', off);
  return off;
}

export function observeAnyFileChanges(
  runner: MetroFileWatcherRunner,
  callback: (events: ChangeEvent) => void | Promise<void>
): () => void {
  const watcher = runner.metro.getBundler().getBundler().getWatcher();

  const listener = (event: ChangeEvent) => {
    callback(event);
  };

  watcher.addListener('change', listener);

  const off = () => {
    watcher.removeListener('change', listener);
  };

  runner.server.addListener?.('close', off);
  return off;
}
