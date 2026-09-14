import spawnAsync from '@expo/spawn-async';

import { AbortCommandError } from '../../../utils/errors';
import { resolveBuildModeAsync } from '../resolveBuildModeAsync';

const prefix = 'EXPO_ANDROID_BUILD_MODE=';

function mockReport(value: unknown) {
  jest.mocked(spawnAsync).mockResolvedValue({
    pid: 1,
    status: 0,
    signal: null,
    output: ['', ''],
    stdout: `Gradle configuration output\n${prefix}${JSON.stringify(value)}\n`,
    stderr: '',
  });
}

describe(resolveBuildModeAsync, () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it.each(['development', 'production'] as const)('accepts the reported %s mode', async (mode) => {
    mockReport({ version: 1, projectPath: ':app', variant: 'demoDebug', mode });
    process.env = {
      ...originalEnv,
      EXPO_PUBLIC_OLD: 'stale',
      SHELL_VALUE: 'keep',
      __EXPO_ENV_LOADED: JSON.stringify(['EXPO_PUBLIC_OLD']),
      __EXPO_CONFIG_MODE: 'production',
    };

    expect(await resolveBuildModeAsync('/project', 'DEMODEBUG')).toEqual({
      variant: 'demoDebug',
      mode,
    });
    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/android/gradlew',
      expect.arrayContaining([
        ':app:expoResolveBuildMode',
        '--init-script',
        '-Pexpo.android.variant=DEMODEBUG',
      ]),
      expect.objectContaining({
        cwd: '/project/android',
        env: expect.objectContaining({ SHELL_VALUE: 'keep', __EXPO_CONFIG_MODE: 'production' }),
      })
    );
    const childEnv = jest.mocked(spawnAsync).mock.calls[0]![2]!.env;
    expect(childEnv).not.toHaveProperty('EXPO_PUBLIC_OLD');
    expect(childEnv).not.toHaveProperty('__EXPO_ENV_LOADED');
    expect(process.env.EXPO_PUBLIC_OLD).toBe('stale');
  });

  it.each([
    { version: 2, projectPath: ':app', variant: 'debug', mode: 'development' },
    { version: 1, projectPath: ':other', variant: 'debug', mode: 'development' },
    { version: 1, projectPath: ':app', variant: 'release', mode: 'production' },
    { version: 1, projectPath: ':app', variant: 'debug', mode: 'staging' },
    null,
  ])('rejects a mismatched report %j', async (report) => {
    mockReport(report);
    await expect(resolveBuildModeAsync('/project', 'debug')).rejects.toThrow(
      'Gradle returned an invalid build mode report'
    );
  });

  it('uses the Windows Gradle wrapper', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockReport({ version: 1, projectPath: ':app', variant: 'debug', mode: 'development' });

    await resolveBuildModeAsync('/project', 'debug');

    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/android/gradlew.bat',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it.each(['', prefix + '{invalid', prefix + '{}\n' + prefix + '{}'])(
    'rejects missing, malformed, or multiple reports',
    async (stdout) => {
      mockReport(null);
      jest.mocked(spawnAsync).mockResolvedValueOnce({
        pid: 1,
        status: 0,
        signal: null,
        output: ['', ''],
        stdout,
        stderr: '',
      });
      await expect(resolveBuildModeAsync('/project', 'debug')).rejects.toThrow(/Gradle/);
    }
  );

  it('rejects an empty variant before spawning Gradle', async () => {
    await expect(resolveBuildModeAsync('/project', '')).rejects.toThrow('--variant');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('preserves a Gradle failure', async () => {
    const error = new Error('Unknown or disabled Android variant');
    jest.mocked(spawnAsync).mockRejectedValueOnce(error);
    await expect(resolveBuildModeAsync('/project', 'missing')).rejects.toBe(error);
  });

  it('handles cancellation', async () => {
    jest.mocked(spawnAsync).mockRejectedValueOnce({ status: 130 });
    await expect(resolveBuildModeAsync('/project', 'debug')).rejects.toBeInstanceOf(
      AbortCommandError
    );
  });
});
