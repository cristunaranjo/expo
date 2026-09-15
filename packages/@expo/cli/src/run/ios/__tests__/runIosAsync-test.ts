import {
  type CalculateFingerprintHashProps,
  type ResolveBuildCacheProps,
  type UploadBuildCacheProps,
  getConfig,
} from '@expo/config';
import { vol } from 'memfs';

import { exportEagerAsync } from '../../../export/embed/exportEager';
import { Log } from '../../../log';
import * as BuildCacheProviders from '../../../utils/build-cache-providers';
import * as CocoaPods from '../../../utils/cocoapods';
import { loadEnvFiles } from '../../../utils/nodeEnv';
import * as Prompts from '../../../utils/prompts';
import * as NativeProject from '../../ensureNativeProject';
import { logProjectLogsLocation } from '../../hints';
import { startBundlerAsync } from '../../startBundler';
import { buildAsync } from '../XcodeBuild';
import type { Options } from '../XcodeBuild.types';
import { getLaunchInfoForBinaryAsync, launchAppAsync } from '../launchApp';
import {
  createNativeProjectFixture,
  createScheme,
  schemePath,
} from '../options/__tests__/nativeProjectFixture';
import { isSimulatorDevice, resolveDeviceAsync } from '../options/resolveDevice';
import { runIosAsync } from '../runIosAsync';

declare namespace globalThis {
  let __DEV__: boolean | undefined;
}

jest.mock('@expo/config', () => {
  const config = jest.requireActual<typeof import('@expo/config')>('@expo/config');
  return { ...config, getConfig: jest.fn(config.getConfig) };
});

jest.mock('../../hints', () => ({
  logProjectLogsLocation: jest.fn(),
  logDeviceArgument: jest.fn(),
}));

jest.mock('../../../log');

jest.mock('../../../utils/port');
jest.mock('../../../utils/nodeEnv', () => ({
  loadEnvFiles: jest.fn(),
}));
jest.mock('../../../export/embed/exportEager', () => ({
  exportEagerAsync: jest.fn(async () => ({})),
}));

jest.mock('../options/resolveDevice', () => ({
  isSimulatorDevice: jest.fn(() => true),
  resolveDeviceAsync: jest.fn(async () => ({
    name: 'mock',
    udid: '123',
  })),
}));

jest.mock('../../../utils/env', () => ({
  env: {
    CI: false,
  },
  envIsHeadless: () => false,
}));

jest.mock('../../startBundler', () => ({
  startBundlerAsync: jest.fn(() => ({
    startAsync: jest.fn(),
  })),
}));

jest.mock('../../../start/platforms/ios/AppleDeviceManager', () => ({
  AppleDeviceManager: {
    resolveAsync: async () => ({
      device: {},
    }),
  },
}));

jest.mock('../XcodeBuild', () => ({
  logPrettyItem: jest.fn(),
  buildAsync: jest.fn(async () => '...'),
  getAppBinaryPath: jest.fn(() => '/mock_binary'),
}));

jest.mock('../launchApp', () => ({
  launchAppAsync: jest.fn(async () => {}),
  getLaunchInfoForBinaryAsync: jest.fn(async () => ({})),
}));

const mockPlatform = (value: typeof process.platform) =>
  Object.defineProperty(process, 'platform', {
    value,
  });

const platform = process.platform;

afterEach(() => {
  mockPlatform(platform);
});

describe(runIosAsync, () => {
  afterEach(() => vol.reset());

  describe('build cache', () => {
    const calculateFingerprintHash = jest.fn<Promise<string>, [CalculateFingerprintHashProps]>();
    const resolveBuildCache = jest.fn<Promise<string | null>, [ResolveBuildCacheProps]>();
    const uploadBuildCache = jest.fn<Promise<string | null>, [UploadBuildCacheProps]>();

    beforeEach(() => {
      mockPlatform('darwin');
      vol.fromJSON(
        {
          ...createNativeProjectFixture(),
          [`${schemePath}/ReleaseClient.xcscheme`]: createScheme('Release'),
          'package.json': '{}',
          'node_modules/expo/package.json': '{"version":"58.0.0"}',
        },
        '/'
      );
      calculateFingerprintHash.mockReset().mockResolvedValue('fingerprint');
      resolveBuildCache.mockReset().mockResolvedValue(null);
      uploadBuildCache.mockReset().mockResolvedValue(null);
      jest.spyOn(BuildCacheProviders, 'resolveBuildCacheProvider').mockResolvedValue({
        plugin: {
          calculateFingerprintHash,
          resolveBuildCache,
          uploadBuildCache,
        },
        options: {},
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it.each<{ options: Options; scheme: string; configuration: string }>([
      {
        options: { scheme: 'ReleaseClient' },
        scheme: 'ReleaseClient',
        configuration: 'Release',
      },
      {
        options: { scheme: 'ReleaseClient', device: 'generic' },
        scheme: 'ReleaseClient',
        configuration: 'Release',
      },
      {
        options: { scheme: 'ReleaseClient', configuration: 'Debug' },
        scheme: 'ReleaseClient',
        configuration: 'Debug',
      },
      {
        options: { scheme: true },
        scheme: 'ReleaseClient',
        configuration: 'Release',
      },
      { options: {}, scheme: 'ReactNativeProject', configuration: 'Debug' },
    ])(
      'passes resolved configuration $configuration to cache hooks for $options',
      async ({ options, scheme, configuration }) => {
        if (options.device === 'generic') {
          jest.mocked(resolveDeviceAsync).mockResolvedValueOnce(null);
        }
        if (options.scheme === true) {
          jest.spyOn(Prompts, 'selectAsync').mockResolvedValueOnce(scheme);
        }

        await runIosAsync('/', options);

        const selection = { scheme, configuration };
        expect(buildAsync).toHaveBeenCalledWith(expect.objectContaining(selection));
        expect(resolveBuildCache).toHaveBeenCalledWith(
          expect.objectContaining({
            runOptions: expect.objectContaining(selection),
          }),
          {}
        );
        expect(uploadBuildCache).toHaveBeenCalledWith(
          expect.objectContaining({
            buildPath: '/mock_binary',
            runOptions: expect.objectContaining(selection),
          }),
          {}
        );
        expect(calculateFingerprintHash).toHaveBeenCalledTimes(2);
        for (const [props] of calculateFingerprintHash.mock.calls) {
          expect(props.runOptions).toEqual(expect.objectContaining(selection));
        }
        expect(launchAppAsync).toHaveBeenCalledTimes(options.device === 'generic' ? 0 : 1);
      }
    );

    it('launches the cached Release binary for a scheme with a Release Run configuration', async () => {
      vol.fromJSON({ 'release.app/Info.plist': '', 'debug.app/Info.plist': '' }, '/');
      resolveBuildCache.mockImplementation(async ({ runOptions }) =>
        'configuration' in runOptions && runOptions.configuration === 'Release'
          ? '/release.app'
          : '/debug.app'
      );
      jest.mocked(getLaunchInfoForBinaryAsync).mockResolvedValueOnce({
        bundleId: 'com.example.app',
        schemes: ['example'],
      });

      await runIosAsync('/', { scheme: 'ReleaseClient' });

      expect(launchAppAsync).toHaveBeenCalledWith(
        '/release.app',
        expect.anything(),
        expect.anything(),
        'com.example.app'
      );
      expect(buildAsync).not.toHaveBeenCalled();
      expect(exportEagerAsync).not.toHaveBeenCalled();
      expect(calculateFingerprintHash).toHaveBeenCalledTimes(1);
      expect(uploadBuildCache).not.toHaveBeenCalled();
    });
  });

  it.each([
    { configuration: 'Release', mode: 'production' },
    { configuration: 'StagingRelease', mode: 'production' },
    { configuration: 'DebugStaging', mode: 'development' },
    { configuration: 'debugStaging', mode: 'production' },
  ])('uses $mode mode for $configuration', async ({ configuration, mode }) => {
    mockPlatform('darwin');
    vol.fromJSON(
      {
        ...createNativeProjectFixture(configuration),
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({
          version: '53.0.0',
        }),
      },
      '/'
    );

    await runIosAsync('/', { configuration });

    expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode });
    expect(startBundlerAsync).toHaveBeenCalledWith('/', expect.objectContaining({ mode }));
    expect(exportEagerAsync).toHaveBeenCalledTimes(mode === 'production' ? 1 : 0);
    expect(buildAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration,
        eagerBundleOptions: mode === 'production' ? '{}' : undefined,
      })
    );
  });

  it(`asserts that the function only runs on darwin machines`, async () => {
    mockPlatform('win32');
    await expect(runIosAsync('/', {})).rejects.toThrow(/EXIT_CALLED/);
    expect(Log.exit).toHaveBeenCalledWith(expect.stringMatching(/eas build -p ios/));
  });

  it(`runs ios on simulator`, async () => {
    mockPlatform('darwin');
    vol.fromJSON(
      {
        ...createNativeProjectFixture(),
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({
          version: '53.0.0',
        }),
      },
      '/'
    );

    await runIosAsync('/', {});

    expect(buildAsync).toHaveBeenCalledWith({
      buildCache: true,
      buildCacheProvider: undefined,
      configuration: 'Debug',
      device: { name: 'mock', udid: '123' },
      eagerBundleOptions: undefined,
      isSimulator: true,
      osType: 'iOS',
      port: 8081,
      projectRoot: '/',
      scheme: 'ReactNativeProject',
      shouldSkipInitialBundling: false,
      shouldStartBundler: true,
      xcodeProject: { isWorkspace: false, name: '/ios/ReactNativeProject.xcodeproj' },
    });

    expect(launchAppAsync).toHaveBeenCalledWith(
      '/mock_binary',
      expect.anything(),
      {
        device: { name: 'mock', udid: '123' },
        isSimulator: true,
        shouldStartBundler: true,
      },
      undefined
    );

    expect(logProjectLogsLocation).toHaveBeenCalled();
  });

  it(`runs ios on device`, async () => {
    jest.mocked(resolveDeviceAsync).mockResolvedValueOnce({
      name: "Evan's phone",
      model: 'iPhone13,4',
      osVersion: '15.4.1',
      deviceType: 'device',
      udid: '00008101-001964A22629003A',
      connectionType: 'USB',
      osType: 'iOS',
    });
    jest.mocked(isSimulatorDevice).mockReturnValueOnce(false);
    mockPlatform('darwin');
    vol.fromJSON(
      {
        ...createNativeProjectFixture(),
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({
          version: '53.0.0',
        }),
      },
      '/'
    );

    await runIosAsync('/', { device: '00008101-001964A22629003A' });

    expect(buildAsync).toHaveBeenCalledWith({
      buildCache: true,
      buildCacheProvider: undefined,
      configuration: 'Debug',
      device: {
        deviceType: 'device',
        model: 'iPhone13,4',
        name: "Evan's phone",
        osVersion: '15.4.1',
        udid: '00008101-001964A22629003A',
        connectionType: 'USB',
        osType: 'iOS',
      },
      eagerBundleOptions: undefined,
      isSimulator: false,
      osType: 'iOS',
      port: 8081,
      projectRoot: '/',
      scheme: 'ReactNativeProject',
      shouldSkipInitialBundling: true,
      shouldStartBundler: true,
      xcodeProject: { isWorkspace: false, name: '/ios/ReactNativeProject.xcodeproj' },
    });

    expect(launchAppAsync).toHaveBeenCalledWith(
      '/mock_binary',
      expect.anything(),
      {
        device: {
          deviceType: 'device',
          model: 'iPhone13,4',
          name: "Evan's phone",
          osVersion: '15.4.1',
          udid: '00008101-001964A22629003A',
          connectionType: 'USB',
          osType: 'iOS',
        },
        isSimulator: false,
        shouldStartBundler: true,
      },
      undefined
    );

    expect(logProjectLogsLocation).toHaveBeenCalled();
  });

  it('loads the selected scheme mode before evaluating app config', async () => {
    mockPlatform('darwin');
    vol.fromJSON(
      {
        ...createNativeProjectFixture(),
        [`${schemePath}/DebugClient.xcscheme`]: createScheme('Release'),
        'package.json': '{}',
        'node_modules/expo/package.json': '{"version":"53.0.0"}',
        '.env.production': 'EXPO_PUBLIC_RUN_IOS_MODE=production-file',
        '.env.development': 'EXPO_PUBLIC_RUN_IOS_MODE=development-file',
      },
      '/'
    );
    const originalEnv = process.env;
    const originalDev = globalThis.__DEV__;
    process.env = { ...originalEnv, NODE_ENV: 'development' };
    delete process.env.__EXPO_ENV_LOADED;
    delete process.env.EXPO_PUBLIC_RUN_IOS_MODE;
    jest
      .mocked(loadEnvFiles)
      .mockImplementationOnce(
        jest.requireActual<typeof import('../../../utils/nodeEnv')>('../../../utils/nodeEnv')
          .loadEnvFiles
      );
    jest.mocked(getConfig).mockImplementationOnce((...args) => {
      expect(process.env.NODE_ENV).toBe('production');
      expect(process.env.EXPO_PUBLIC_RUN_IOS_MODE).toBe('production-file');
      return jest.requireActual<typeof import('@expo/config')>('@expo/config').getConfig(...args);
    });
    try {
      await runIosAsync('/', { scheme: 'DebugClient' });
      expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode: 'production' });
      expect(jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(getConfig).mock.invocationCallOrder[0]!
      );
      expect(buildAsync).toHaveBeenCalledWith(
        expect.objectContaining({ scheme: 'DebugClient', configuration: 'Release' })
      );
      expect(exportEagerAsync).toHaveBeenCalledTimes(1);
      expect(startBundlerAsync).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({ mode: 'production' })
      );
    } finally {
      process.env = originalEnv;
      globalThis.__DEV__ = originalDev;
    }
  });

  it('uses the workspace created by CocoaPods without changing the selected scheme mode', async () => {
    mockPlatform('darwin');
    vol.fromJSON(
      {
        ...createNativeProjectFixture(),
        [`${schemePath}/DebugClient.xcscheme`]: createScheme('Release'),
        'package.json': '{}',
        'node_modules/expo/package.json': '{"version":"53.0.0"}',
      },
      '/'
    );
    const syncPods = jest
      .spyOn(CocoaPods, 'maybePromptToSyncPodsAsync')
      .mockImplementationOnce(async () => {
        expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode: 'production' });
        vol.fromJSON({ 'ios/ReactNativeProject.xcworkspace/contents.xcworkspacedata': '' }, '/');
      });
    try {
      await runIosAsync('/', { scheme: 'DebugClient', install: true });
      expect(syncPods).toHaveBeenCalledWith('/');
      expect(loadEnvFiles).toHaveBeenCalledTimes(1);
      expect(buildAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          scheme: 'DebugClient',
          configuration: 'Release',
          xcodeProject: { isWorkspace: true, name: '/ios/ReactNativeProject.xcworkspace' },
        })
      );
    } finally {
      syncPods.mockRestore();
    }
  });

  it('rejects scheme-only selection before Prebuild when no native project exists', async () => {
    mockPlatform('darwin');
    vol.fromJSON({ 'package.json': '{}' }, '/');
    await expect(runIosAsync('/', { scheme: 'DebugClient' })).rejects.toThrow(
      /Run configuration before the iOS project exists/
    );
    expect(loadEnvFiles).not.toHaveBeenCalled();
    expect(buildAsync).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Release'])(
    'sets the generation mode before Prebuild for configuration %s',
    async (configuration) => {
      mockPlatform('darwin');
      vol.fromJSON(
        {
          'package.json': '{}',
          'node_modules/expo/package.json': '{"version":"53.0.0"}',
        },
        '/'
      );
      const ensureNativeProject = jest
        .spyOn(NativeProject, 'ensureNativeProjectAsync')
        .mockImplementationOnce(async () => {
          expect(loadEnvFiles).toHaveBeenCalledWith('/', {
            mode: configuration === 'Release' ? 'production' : 'development',
          });
          vol.fromJSON(createNativeProjectFixture(), '/');
          return false;
        });
      try {
        await runIosAsync('/', { configuration });
        expect(loadEnvFiles).toHaveBeenCalledTimes(1);
        expect(buildAsync).toHaveBeenCalledWith(
          expect.objectContaining({ configuration: configuration ?? 'Debug' })
        );
      } finally {
        ensureNativeProject.mockRestore();
      }
    }
  );
});
