import type fs from 'fs';
import { vol } from 'memfs';
import path from 'path';

import {
  getApplicationTargetNameForSchemeAsync,
  getArchiveBuildConfigurationForSchemeAsync,
  getBuildConfigurationForSchemeAsync,
  getRunnableSchemesFromXcodeproj,
} from '../BuildScheme';

const fsReal = jest.requireActual('fs') as typeof fs;

jest.mock('fs');

describe(getBuildConfigurationForSchemeAsync, () => {
  const schemePath = 'ios/testproject.xcodeproj/xcshareddata/xcschemes/testproject.xcscheme';
  const scheme = fsReal.readFileSync(
    path.join(__dirname, 'fixtures/testproject.xcscheme'),
    'utf-8'
  );

  beforeEach(() => {
    vol.fromJSON(
      {
        'ios/testproject.xcodeproj/project.pbxproj': fsReal.readFileSync(
          path.join(__dirname, 'fixtures/project-rni.pbxproj'),
          'utf-8'
        ),
        [schemePath]: scheme,
      },
      '/app'
    );
  });

  afterEach(() => vol.reset());

  it('reads the Run configuration instead of the Archive configuration', async () => {
    expect(await getBuildConfigurationForSchemeAsync('/app', 'testproject')).toEqual({
      configuration: 'Debug',
      osType: 'iOS',
    });
  });

  it('uses an explicit configuration when the Run action does not name one', async () => {
    vol.fromJSON(
      {
        [schemePath]: scheme.replace(/(<LaunchAction\s+)buildConfiguration = "Debug"/, '$1'),
      },
      '/app'
    );
    expect(await getBuildConfigurationForSchemeAsync('/app', 'testproject', 'Release')).toEqual({
      configuration: 'Release',
      osType: 'iOS',
    });
    await expect(getBuildConfigurationForSchemeAsync('/app', 'testproject')).rejects.toThrow(
      /Cannot read the Run configuration/
    );
  });

  it('resolves a single application build entry when there is no product runnable', async () => {
    vol.fromJSON(
      {
        [schemePath]: scheme.replace(
          /<BuildableProductRunnable[\s\S]*?<\/BuildableProductRunnable>/g,
          ''
        ),
      },
      '/app'
    );
    expect(await getBuildConfigurationForSchemeAsync('/app', 'testproject')).toEqual({
      configuration: 'Debug',
      osType: 'iOS',
    });
  });

  it('rejects a scheme whose application identifier does not exist', async () => {
    vol.fromJSON(
      {
        [schemePath]: scheme.replaceAll('13B07F861A680F5B00A75B9A', 'MISSING_TARGET'),
      },
      '/app'
    );
    await expect(getBuildConfigurationForSchemeAsync('/app', 'testproject')).rejects.toThrow(
      /does not identify an application target/
    );
  });

  it('rejects an empty scheme file with a target resolution error', async () => {
    vol.fromJSON({ [schemePath]: '' }, '/app');
    await expect(getBuildConfigurationForSchemeAsync('/app', 'testproject')).rejects.toThrow(
      /does not identify an application target/
    );
  });

  it('does not choose silently between duplicate scheme files', async () => {
    vol.fromJSON(
      {
        'ios/testproject.xcodeproj/xcuserdata/local.xcuserdatad/xcschemes/testproject.xcscheme':
          scheme,
      },
      '/app'
    );
    await expect(getBuildConfigurationForSchemeAsync('/app', 'testproject')).rejects.toThrow(
      /defined in multiple files/
    );
  });
});

describe(getRunnableSchemesFromXcodeproj, () => {
  beforeAll(async () => {
    vol.fromJSON(
      {
        'ios/project.xcodeproj/project.pbxproj': fsReal.readFileSync(
          path.join(__dirname, 'fixtures/project-multitarget.pbxproj'),
          'utf-8'
        ),
      },
      '/app'
    );
  });

  afterAll(() => {
    vol.reset();
  });
  it(`parses for runnable schemes`, async () => {
    const schemes = getRunnableSchemesFromXcodeproj('/app');
    expect(schemes).toStrictEqual([
      { name: 'multitarget', osType: 'iOS', type: 'com.apple.product-type.application' },
      { name: 'shareextension', osType: 'iOS', type: 'com.apple.product-type.app-extension' },
    ]);
  });
});

describe(getApplicationTargetNameForSchemeAsync, () => {
  describe('single build action entry', () => {
    beforeAll(async () => {
      vol.fromJSON(
        {
          'ios/testproject.xcodeproj/xcshareddata/xcschemes/testproject.xcscheme':
            fsReal.readFileSync(path.join(__dirname, 'fixtures/testproject.xcscheme'), 'utf-8'),
        },
        '/app'
      );
    });

    afterAll(() => {
      vol.reset();
    });

    it('returns the target name for existing scheme', async () => {
      const target = await getApplicationTargetNameForSchemeAsync('/app', 'testproject');
      expect(target).toBe('testproject');
    });

    it('throws if the scheme does not exist', async () => {
      await expect(() =>
        getApplicationTargetNameForSchemeAsync('/app', 'nonexistentscheme')
      ).rejects.toThrow(/does not exist/);
    });
  });
  describe('multiple build action entries', () => {
    beforeAll(async () => {
      vol.fromJSON(
        {
          'ios/testproject.xcodeproj/xcshareddata/xcschemes/testproject.xcscheme':
            fsReal.readFileSync(path.join(__dirname, 'fixtures/testproject-2.xcscheme'), 'utf-8'),
        },
        '/app'
      );
    });

    afterAll(() => {
      vol.reset();
    });

    it('returns the target name for existing scheme', async () => {
      const target = await getApplicationTargetNameForSchemeAsync('/app', 'testproject');
      expect(target).toBe('testproject');
    });

    it('throws if the scheme does not exist', async () => {
      await expect(() =>
        getApplicationTargetNameForSchemeAsync('/app', 'nonexistentscheme')
      ).rejects.toThrow(/does not exist/);
    });
  });
});

describe(getArchiveBuildConfigurationForSchemeAsync, () => {
  beforeAll(async () => {
    vol.fromJSON(
      {
        'ios/testproject.xcodeproj/xcshareddata/xcschemes/testproject.xcscheme':
          fsReal.readFileSync(path.join(__dirname, 'fixtures/testproject.xcscheme'), 'utf-8'),
      },
      '/app'
    );
  });

  afterAll(() => {
    vol.reset();
  });

  it('returns build configuration name for existing scheme', async () => {
    const buildConfiguration = await getArchiveBuildConfigurationForSchemeAsync(
      '/app',
      'testproject'
    );
    expect(buildConfiguration).toBe('Release');
  });

  it('throws if the scheme does not exist', async () => {
    await expect(() =>
      getArchiveBuildConfigurationForSchemeAsync('/app', 'nonexistentscheme')
    ).rejects.toThrow(/does not exist/);
  });
});
