import type { ChangeEvent } from '@expo/metro/metro-file-map';
import { EventEmitter } from 'events';
import path from 'path';

import {
  observeFileChanges,
  waitForMetroToObserveTypeScriptFile,
} from '../waitForMetroToObserveTypeScriptFile';

function createRunner() {
  const watcher = new EventEmitter();
  const server = new EventEmitter();
  const runner = {
    metro: {
      getBundler: () => ({ getBundler: () => ({ getWatcher: () => watcher }) }),
    },
    server,
  } satisfies Parameters<typeof observeFileChanges>[0];
  return { watcher, server, runner };
}

function createChangeEvent(
  rootDir: string,
  filePath: string,
  eventType: 'addedFiles' | 'modifiedFiles' = 'addedFiles'
): ChangeEvent {
  return {
    rootDir,
    changes: {
      addedDirectories: [],
      removedDirectories: [],
      addedFiles: [],
      modifiedFiles: [],
      removedFiles: [],
      [eventType]: [[filePath, { isSymlink: false }]],
    },
  };
}

const projectRoot = path.resolve('/metro-watched-project');

describe(observeFileChanges, () => {
  it.each(['addedFiles', 'modifiedFiles'] as const)(
    'resolves relative %s paths from the event root',
    (eventType) => {
      const { watcher, runner } = createRunner();
      const callback = jest.fn();
      const off = observeFileChanges(
        runner,
        [path.join(projectRoot, '.env.development')],
        callback
      );

      expect(process.cwd()).not.toBe(projectRoot);
      watcher.emit('change', createChangeEvent(projectRoot, '.env.development', eventType));
      expect(callback).toHaveBeenCalledTimes(1);
      off();
      expect(watcher.listenerCount('change')).toBe(0);
    }
  );

  it.each(['addedFiles', 'modifiedFiles'] as const)('preserves absolute %s paths', (eventType) => {
    const { watcher, runner } = createRunner();
    const callback = jest.fn();
    const filePath = path.join(projectRoot, '.env.production');
    observeFileChanges(runner, [filePath], callback);

    watcher.emit('change', createChangeEvent('/different-root', filePath, eventType));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resolves watched files outside the event root', () => {
    const { watcher, runner } = createRunner();
    const callback = jest.fn();
    const filePath = path.resolve(projectRoot, '../shared/.env');
    observeFileChanges(runner, [filePath], callback);

    watcher.emit('change', createChangeEvent(projectRoot, '../shared/.env'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated paths and stops when the server closes', () => {
    const { watcher, server, runner } = createRunner();
    const callback = jest.fn();
    observeFileChanges(runner, [path.join(projectRoot, '.env.development')], callback);

    watcher.emit('change', createChangeEvent(projectRoot, '.env.production'));
    watcher.emit('change', createChangeEvent('/another-project', '.env.development'));
    expect(callback).not.toHaveBeenCalled();

    server.emit('close');
    expect(watcher.listenerCount('change')).toBe(0);
    watcher.emit('change', createChangeEvent(projectRoot, '.env.development'));
    expect(callback).not.toHaveBeenCalled();
  });

  it('still ignores node_modules even when explicitly watched', () => {
    const { watcher, runner } = createRunner();
    const callback = jest.fn();
    const relativePath = 'node_modules/dependency/.env';
    observeFileChanges(runner, [path.join(projectRoot, relativePath)], callback);

    watcher.emit('change', createChangeEvent(projectRoot, relativePath));
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not exclude a relative event based on its root directory name', () => {
    const { watcher, runner } = createRunner();
    const callback = jest.fn();
    const rootDir = path.resolve('/my_node_modules_notes/app');
    observeFileChanges(runner, [path.join(rootDir, '.env')], callback);

    watcher.emit('change', createChangeEvent(rootDir, '.env'));
    watcher.emit('change', createChangeEvent(rootDir, '.env', 'modifiedFiles'));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe(waitForMetroToObserveTypeScriptFile, () => {
  it.each(['tsconfig.json', 'src/index.ts', 'src/index.tsx'])(
    'detects a relative %s addition and removes its listener',
    (filePath) => {
      const { watcher, runner } = createRunner();
      const callback = jest.fn(async () => {});
      waitForMetroToObserveTypeScriptFile(projectRoot, runner, callback);

      watcher.emit('change', createChangeEvent(projectRoot, filePath));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(watcher.listenerCount('change')).toBe(0);
    }
  );

  it('ignores another project config and dependency files', () => {
    const { watcher, runner } = createRunner();
    const callback = jest.fn(async () => {});
    const off = waitForMetroToObserveTypeScriptFile(projectRoot, runner, callback);

    watcher.emit('change', createChangeEvent('/another-project', 'tsconfig.json'));
    watcher.emit('change', createChangeEvent(projectRoot, 'node_modules/dependency/index.ts'));
    expect(callback).not.toHaveBeenCalled();
    off();
    expect(watcher.listenerCount('change')).toBe(0);
  });
});
