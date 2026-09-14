import { vol } from 'memfs';

import { exportEagerAsync } from '../../../export/embed/exportEager';
import rnFixture from '../../../prebuild/__tests__/fixtures/react-native-project';
import { hasRequiredAndroidFilesAsync } from '../../../prebuild/clearNativeFolder';
import { assembleAsync, installAsync } from '../../../start/platforms/android/gradle';
import { CommandError } from '../../../utils/errors';
import { loadEnvFiles } from '../../../utils/nodeEnv';
import { ensureNativeProjectAsync } from '../../ensureNativeProject';
import { startBundlerAsync } from '../../startBundler';
import { resolveBuildModeAsync } from '../resolveBuildModeAsync';
import { runAndroidAsync } from '../runAndroidAsync';

jest.mock('../../../log');
jest.mock('../../../prebuild/clearNativeFolder', () => ({
  hasRequiredAndroidFilesAsync: jest.fn(),
}));
jest.mock('../../ensureNativeProject', () => ({ ensureNativeProjectAsync: jest.fn() }));
jest.mock('../resolveBuildModeAsync', () => ({ resolveBuildModeAsync: jest.fn() }));

jest.mock('../../../utils/port');
jest.mock('../../../utils/nodeEnv', () => ({
  loadEnvFiles: jest.fn(),
}));
jest.mock('../../../export/embed/exportEager', () => ({
  exportEagerAsync: jest.fn(async () => ({})),
}));

jest.mock('../../../start/platforms/android/gradle', () => ({
  assembleAsync: jest.fn(async () => {}),
  installAsync: jest.fn(async () => {}),
}));

jest.mock('../resolveDevice', () => ({
  resolveDeviceAsync: jest.fn(async () => ({
    device: {
      name: 'mock',
      pid: '123',
    },
    installAppAsync: jest.fn(),
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
    getDefaultDevServer: jest.fn(() => ({
      openCustomRuntimeAsync: jest.fn(),
    })),
  })),
}));

describe(runAndroidAsync, () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.__EXPO_CONFIG_MODE;
    delete process.env.__EXPO_ENV_LOADED;
    jest.mocked(hasRequiredAndroidFilesAsync).mockResolvedValue(true);
    jest.mocked(resolveBuildModeAsync).mockResolvedValue({
      variant: 'debug',
      mode: 'development',
    });
  });

  afterEach(() => {
    vol.reset();
    process.env = originalEnv;
  });

  function addProject() {
    vol.fromJSON(
      {
        ...rnFixture,
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({ version: '53.0.0' }),
      },
      '/'
    );
  }

  it('uses production mode for a release variant', async () => {
    jest.mocked(resolveBuildModeAsync).mockResolvedValue({
      variant: 'demoRelease',
      mode: 'production',
    });
    vol.fromJSON(
      {
        ...rnFixture,
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({
          version: '53.0.0',
        }),
      },
      '/'
    );

    await runAndroidAsync('/', { variant: 'demoRelease' });

    expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode: 'production' });
    expect(startBundlerAsync).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({ mode: 'production' })
    );
  });

  it(`runs android`, async () => {
    vol.fromJSON(
      {
        ...rnFixture,
        '/package.json': JSON.stringify({}),
        'node_modules/expo/package.json': JSON.stringify({
          version: '53.0.0',
        }),
      },
      '/'
    );

    await runAndroidAsync('/', {});

    expect(assembleAsync).toHaveBeenCalledWith('/android', {
      appName: 'app',
      buildCache: false,
      port: 8081,
      variant: 'debug',
      architectures: '',
    });

    expect(installAsync).toHaveBeenCalledWith('/android', {
      appName: 'app',
      port: 8081,
      variant: 'debug',
    });
  });

  it.each([
    { requested: 'qa', variant: 'qa', mode: 'production' },
    { requested: 'qa', variant: 'qa', mode: 'development' },
    { requested: undefined, variant: 'debug', mode: 'production' },
    { requested: 'DEMODEBUG', variant: 'demoDebug', mode: 'development' },
    { requested: 'RELEASE', variant: 'release', mode: 'production' },
  ] as const)('uses Gradle mode $mode for $requested', async ({ requested, variant, mode }) => {
    addProject();
    jest.mocked(resolveBuildModeAsync).mockResolvedValue({ variant, mode });
    process.env.NODE_ENV = mode === 'development' ? 'production' : 'development';
    process.env.EXPO_PUBLIC_OLD = 'stale dotenv value';
    process.env.__EXPO_ENV_LOADED = JSON.stringify(['EXPO_PUBLIC_OLD']);
    process.env.SHELL_VALUE = 'keep';
    process.env.__EXPO_CONFIG_MODE = mode === 'development' ? 'production' : 'development';

    await runAndroidAsync('/', { variant: requested });

    expect(resolveBuildModeAsync).toHaveBeenCalledWith('/', requested ?? 'debug');
    expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode });
    expect(jest.mocked(resolveBuildModeAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]!
    );
    expect(assembleAsync).toHaveBeenCalledWith('/android', expect.objectContaining({ variant }));
    expect(startBundlerAsync).toHaveBeenCalledWith('/', expect.objectContaining({ mode }));
    expect(process.env.NODE_ENV).toBe(mode);
    expect(process.env.EXPO_PUBLIC_OLD).toBeUndefined();
    expect(process.env.__EXPO_ENV_LOADED).toBeUndefined();
    expect(process.env.SHELL_VALUE).toBe('keep');
    expect(process.env.__EXPO_CONFIG_MODE).toBe(
      mode === 'development' ? 'production' : 'development'
    );
    if (mode === 'production') {
      expect(exportEagerAsync).toHaveBeenCalledWith(
        '/',
        expect.objectContaining({ dev: false, platform: 'android' })
      );
    } else {
      expect(exportEagerAsync).not.toHaveBeenCalled();
    }
  });

  it.each([
    { requested: undefined, variant: 'debug', mode: 'development' },
    { requested: 'DEBUGOPTIMIZED', variant: 'debugOptimized', mode: 'development' },
    { requested: 'RELEASE', variant: 'release', mode: 'production' },
  ] as const)('generates a missing project before resolving $variant', async (testCase) => {
    addProject();
    jest.mocked(hasRequiredAndroidFilesAsync).mockResolvedValue(false);
    jest.mocked(resolveBuildModeAsync).mockResolvedValue({
      variant: testCase.variant,
      mode: testCase.mode,
    });
    process.env.__EXPO_CONFIG_MODE = testCase.mode === 'development' ? 'production' : 'development';

    await runAndroidAsync('/', { variant: testCase.requested });

    expect(loadEnvFiles).toHaveBeenNthCalledWith(1, '/', { mode: testCase.mode });
    expect(ensureNativeProjectAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(ensureNativeProjectAsync).mock.invocationCallOrder[0]!
    );
    expect(jest.mocked(ensureNativeProjectAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(resolveBuildModeAsync).mock.invocationCallOrder[0]!
    );
    expect(assembleAsync).toHaveBeenCalledWith(
      '/android',
      expect.objectContaining({ variant: testCase.variant })
    );
    expect(process.env.__EXPO_CONFIG_MODE).toBe(
      testCase.mode === 'development' ? 'production' : 'development'
    );
  });

  it('requires Prebuild before selecting a custom variant in a missing project', async () => {
    jest.mocked(hasRequiredAndroidFilesAsync).mockResolvedValue(false);

    await expect(runAndroidAsync('/', { variant: 'qa' })).rejects.toThrow('Run prebuild first');

    expect(loadEnvFiles).not.toHaveBeenCalled();
    expect(ensureNativeProjectAsync).not.toHaveBeenCalled();
    expect(resolveBuildModeAsync).not.toHaveBeenCalled();
  });

  it('stops before building if Gradle uses production for debug after Prebuild used development', async () => {
    jest.mocked(hasRequiredAndroidFilesAsync).mockResolvedValue(false);
    jest.mocked(resolveBuildModeAsync).mockResolvedValue({ variant: 'debug', mode: 'production' });
    process.env.EX_UPDATES_NATIVE_DEBUG = '1';

    await expect(runAndroidAsync('/', {})).rejects.toThrow(
      "Android variant 'debug' uses production according to react.debuggableVariants, but Prebuild used development"
    );

    expect(ensureNativeProjectAsync).toHaveBeenCalledTimes(1);
    expect(assembleAsync).not.toHaveBeenCalled();
    expect(startBundlerAsync).not.toHaveBeenCalled();
  });

  it('propagates unknown or disabled variant errors before loading config', async () => {
    jest
      .mocked(resolveBuildModeAsync)
      .mockRejectedValue(
        new CommandError('ANDROID_BUILD_MODE', 'Unknown or disabled Android variant')
      );

    await expect(runAndroidAsync('/', { variant: 'missing' })).rejects.toThrow(
      'Unknown or disabled'
    );

    expect(loadEnvFiles).not.toHaveBeenCalled();
    expect(ensureNativeProjectAsync).not.toHaveBeenCalled();
    expect(assembleAsync).not.toHaveBeenCalled();
  });

  it('does not require Gradle to install an external binary', async () => {
    addProject();
    vol.writeFileSync('/app.apk', 'apk');

    await runAndroidAsync('/', { binary: '/app.apk' });

    expect(resolveBuildModeAsync).not.toHaveBeenCalled();
    expect(assembleAsync).not.toHaveBeenCalled();
    expect(loadEnvFiles).toHaveBeenCalledWith('/', { mode: 'development' });
  });
});
