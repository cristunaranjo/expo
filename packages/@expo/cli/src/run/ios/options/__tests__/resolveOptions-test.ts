import { vol } from 'memfs';

import rnFixture from '../../../../prebuild/__tests__/fixtures/react-native-project';
import { selectAsync } from '../../../../utils/prompts';
import { isSimulatorDevice } from '../resolveDevice';
import { resolveOptionsAsync } from '../resolveOptions';
import { createNativeProjectFixture, createScheme, schemePath } from './nativeProjectFixture';

jest.mock('../../../../utils/port');
jest.mock('../../../../utils/prompts');

jest.mock('../resolveDevice', () => ({
  isSimulatorDevice: jest.fn(() => true),
  resolveDeviceAsync: jest.fn(async () => ({
    name: 'mock',
    udid: '123',
  })),
}));

const fixture = {
  ...createNativeProjectFixture(),
  [`${schemePath}/MyScheme.xcscheme`]: createScheme('Debug'),
  'package.json': JSON.stringify({}),
  'node_modules/expo/package.json': JSON.stringify({
    version: '53.0.0',
  }),
};

describe(resolveOptionsAsync, () => {
  afterEach(() => vol.reset());

  it(`resolves default options`, async () => {
    vol.fromJSON(fixture, '/');

    expect(await resolveOptionsAsync('/', {})).toEqual({
      buildCache: true,
      configuration: 'Debug',
      device: { name: 'mock', udid: '123' },
      isSimulator: true,
      osType: 'iOS',
      port: 8081,
      projectRoot: '/',
      scheme: 'ReactNativeProject',
      shouldSkipInitialBundling: false,
      shouldStartBundler: true,
      xcodeProject: { isWorkspace: false, name: '/ios/ReactNativeProject.xcodeproj' },
    });
  });
  it(`resolves complex options`, async () => {
    vol.fromJSON(fixture, '/');

    jest.mocked(isSimulatorDevice).mockImplementationOnce(() => false);

    expect(
      await resolveOptionsAsync('/', {
        buildCache: false,
        bundler: true,
        device: 'search',
        install: true,
        port: 8081,
        configuration: 'Release',
        scheme: 'MyScheme',
      })
    ).toEqual({
      buildCache: false,
      configuration: 'Release',
      device: { name: 'mock', udid: '123' },
      isSimulator: false,
      osType: 'iOS',
      port: 8081,
      projectRoot: '/',
      scheme: 'MyScheme',
      shouldSkipInitialBundling: false,
      shouldStartBundler: true,
      xcodeProject: { isWorkspace: false, name: '/ios/ReactNativeProject.xcodeproj' },
    });
  });

  describe.each([
    { target: 'simulator', isSimulator: true },
    { target: 'device', isSimulator: false },
  ])('on a $target', ({ isSimulator }) => {
    it.each(['Debug', 'DebugStaging', 'debugStaging'])(
      'respects --no-bundler without forcing SKIP_BUNDLING for %s',
      async (configuration) => {
        vol.fromJSON({ ...fixture, ...createNativeProjectFixture(configuration) }, '/');
        jest.mocked(isSimulatorDevice).mockReturnValueOnce(isSimulator);

        expect(await resolveOptionsAsync('/', { bundler: false, configuration })).toEqual(
          expect.objectContaining({
            configuration,
            shouldSkipInitialBundling: configuration === 'Debug' && !isSimulator,
            shouldStartBundler: false,
          })
        );
      }
    );
  });

  it('respects --no-bundler without an explicit configuration', async () => {
    vol.fromJSON(fixture, '/');

    expect(await resolveOptionsAsync('/', { bundler: false })).toEqual(
      expect.objectContaining({ shouldStartBundler: false })
    );
  });

  it('uses the Run configuration of an explicit scheme without inferring from its name', async () => {
    vol.fromJSON(
      {
        ...fixture,
        [`${schemePath}/DebugClient.xcscheme`]: createScheme('Release'),
      },
      '/'
    );

    expect(await resolveOptionsAsync('/', { scheme: 'DebugClient' })).toEqual(
      expect.objectContaining({
        scheme: 'DebugClient',
        configuration: 'Release',
      })
    );
  });

  it('lets an explicit configuration override the scheme Run action', async () => {
    vol.fromJSON(
      {
        ...fixture,
        [`${schemePath}/DebugClient.xcscheme`]: createScheme('Release'),
      },
      '/'
    );

    expect(
      await resolveOptionsAsync('/', {
        scheme: 'DebugClient',
        configuration: 'Debug',
      })
    ).toEqual(
      expect.objectContaining({
        scheme: 'DebugClient',
        configuration: 'Debug',
      })
    );
  });

  it('defaults to Debug without a scheme even when its Run action uses Release', async () => {
    vol.fromJSON({ ...fixture, ...createNativeProjectFixture('Release') }, '/');

    expect(await resolveOptionsAsync('/', {})).toEqual(
      expect.objectContaining({
        scheme: 'ReactNativeProject',
        configuration: 'Debug',
      })
    );
  });

  it('rejects a missing scheme', async () => {
    vol.fromJSON(fixture, '/');
    await expect(
      resolveOptionsAsync('/', { scheme: 'Missing', configuration: 'Debug' })
    ).rejects.toThrow(/scheme.*Missing.*does not exist/i);
  });

  it('rejects a configuration missing from the selected application target', async () => {
    vol.fromJSON(fixture, '/');
    await expect(resolveOptionsAsync('/', { configuration: 'Staging' })).rejects.toThrow(
      /configuration.*Staging.*does not exist/i
    );
  });

  it.each(['Debug', 'Release'])(
    'preserves an autogenerated scheme with explicit %s configuration',
    async (configuration) => {
      vol.fromJSON(
        {
          ...rnFixture,
          'package.json': '{}',
          'node_modules/expo/package.json': '{"version":"53.0.0"}',
        },
        '/'
      );
      expect(
        await resolveOptionsAsync('/', {
          scheme: 'ReactNativeProject',
          configuration,
        })
      ).toEqual(
        expect.objectContaining({
          scheme: 'ReactNativeProject',
          configuration,
        })
      );
    }
  );

  it('defaults to Debug with an autogenerated scheme', async () => {
    vol.fromJSON(
      {
        ...rnFixture,
        'package.json': '{}',
        'node_modules/expo/package.json': '{"version":"53.0.0"}',
      },
      '/'
    );
    expect(await resolveOptionsAsync('/', {})).toEqual(
      expect.objectContaining({
        scheme: 'ReactNativeProject',
        configuration: 'Debug',
      })
    );
  });

  it('requires an explicit configuration when an autogenerated scheme has no readable Run action', async () => {
    vol.fromJSON({ ...rnFixture, 'package.json': '{}' }, '/');
    await expect(resolveOptionsAsync('/', { scheme: 'ReactNativeProject' })).rejects.toThrow(
      /Cannot read the Run configuration/
    );
  });

  it.each([
    'ios/Client.xcworkspace/xcshareddata/xcschemes',
    'ios/ReactNativeProject.xcodeproj/xcuserdata/local.xcuserdatad/xcschemes',
  ])('reads schemes with punctuation in their names from %s', async (directory) => {
    vol.fromJSON(
      {
        ...fixture,
        [`${directory}/client.beta[1].xcscheme`]: createScheme('Release'),
      },
      '/'
    );
    expect(await resolveOptionsAsync('/', { scheme: 'client.beta[1]' })).toEqual(
      expect.objectContaining({
        scheme: 'client.beta[1]',
        configuration: 'Release',
      })
    );
  });

  it('uses the Run configuration after the user selects a custom scheme', async () => {
    vol.fromJSON(
      {
        ...fixture,
        [`${schemePath}/DebugClient.xcscheme`]: createScheme('Release'),
      },
      '/'
    );
    jest.mocked(selectAsync).mockResolvedValueOnce('DebugClient');
    expect(await resolveOptionsAsync('/', { scheme: true })).toEqual(
      expect.objectContaining({
        scheme: 'DebugClient',
        configuration: 'Release',
      })
    );
  });

  it('validates the application project referenced by a workspace scheme', async () => {
    vol.fromJSON(
      {
        ...fixture,
        'ios/Other.xcodeproj/project.pbxproj': rnFixture[
          'ios/ReactNativeProject.xcodeproj/project.pbxproj'
        ].replaceAll('name = Debug;', 'name = QA;'),
        'ios/Client.xcworkspace/xcshareddata/xcschemes/Client.xcscheme': createScheme('QA').replace(
          'container:ReactNativeProject.xcodeproj',
          'container:Other.xcodeproj'
        ),
      },
      '/'
    );
    expect(await resolveOptionsAsync('/', { scheme: 'Client' })).toEqual(
      expect.objectContaining({ configuration: 'QA' })
    );
    await expect(
      resolveOptionsAsync('/', { scheme: 'Client', configuration: 'Debug' })
    ).rejects.toThrow(/configuration.*Debug.*does not exist/i);
  });
});
