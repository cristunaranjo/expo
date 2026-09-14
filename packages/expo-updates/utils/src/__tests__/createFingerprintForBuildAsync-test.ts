import fs from 'fs';
import os from 'os';
import path from 'path';

import { createFingerprintAsync } from '../createFingerprintAsync';
import { createFingerprintForBuildAsync } from '../createFingerprintForBuildAsync';

jest.mock('../createFingerprintAsync');
jest.mock('../workflow', () => ({
  ...jest.requireActual('../workflow'),
  resolveWorkflowAsync: jest.fn().mockResolvedValue('generic'),
}));

describe(createFingerprintForBuildAsync, () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env;
  let projectRoot: string;
  let destination: string;
  let descriptor: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-updates-fingerprint-'));
    destination = path.join(projectRoot, 'assets');
    descriptor = path.join(projectRoot, 'inputs.json');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}');
    fs.writeFileSync(descriptor, JSON.stringify({ files: ['/old/input'], directories: [] }));
    process.env = {};
    jest.mocked(createFingerprintAsync).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it.each([undefined, '1', { policy: 'appVersion' }])(
    'clears old input paths when runtime version %j does not use fingerprinting',
    async (runtimeVersion) => {
      fs.writeFileSync(path.join(projectRoot, 'app.json'), JSON.stringify({ runtimeVersion }));

      await createFingerprintForBuildAsync('android', projectRoot, destination, descriptor);

      expect(JSON.parse(fs.readFileSync(descriptor, 'utf8'))).toEqual({
        files: [],
        directories: [],
      });
      expect(createFingerprintAsync).not.toHaveBeenCalled();
    }
  );

  it('clears old input paths when the fingerprint is overridden', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'app.json'),
      JSON.stringify({ runtimeVersion: { policy: 'fingerprint' } })
    );
    process.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE = 'provided-hash';

    await createFingerprintForBuildAsync('android', projectRoot, destination, descriptor);

    expect(fs.readFileSync(path.join(destination, 'fingerprint'), 'utf8')).toBe('provided-hash');
    expect(JSON.parse(fs.readFileSync(descriptor, 'utf8'))).toEqual({ files: [], directories: [] });
    expect(createFingerprintAsync).not.toHaveBeenCalled();
  });

  it('keeps input metadata separate from the generated app assets', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'app.json'),
      JSON.stringify({ runtimeVersion: { policy: 'fingerprint' } })
    );
    jest.mocked(createFingerprintAsync).mockResolvedValue({
      hash: 'calculated-hash',
      sources: [{ type: 'file', filePath: 'native.js', reasons: [], hash: 'source-hash' }],
    });

    await createFingerprintForBuildAsync('android', projectRoot, destination, descriptor);

    expect(fs.readdirSync(destination)).toEqual(['fingerprint']);
    expect(JSON.parse(fs.readFileSync(descriptor, 'utf8'))).toEqual({
      files: [path.join(projectRoot, 'native.js')],
      directories: [],
    });
  });
});
