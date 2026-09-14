import fs from 'fs';
import os from 'os';
import path from 'path';

import { resolveWorkflowForBuildAsync } from '../resolveWorkflowForBuild';
import { resolveWorkflowAsync } from '../workflow';

jest.mock('../workflow', () => ({
  ...jest.requireActual('../workflow'),
  resolveWorkflowAsync: jest.fn(),
}));

describe(resolveWorkflowForBuildAsync, () => {
  const originalEnv = process.env;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-updates-workflow-'));
    process.env = { __EXPO_CONFIG_MODE: 'production' };
    jest.mocked(resolveWorkflowAsync).mockReset().mockResolvedValue('generic');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('uses the selected dotenv files after removing inherited dotenv values', async () => {
    fs.writeFileSync(path.join(projectRoot, '.env.production'), 'WORKFLOW_VALUE=child');
    fs.writeFileSync(
      path.join(projectRoot, 'app.config.js'),
      'throw new Error("Do not evaluate config");'
    );
    process.env.WORKFLOW_VALUE = 'parent';
    process.env.__EXPO_ENV_LOADED = JSON.stringify(['WORKFLOW_VALUE']);

    await expect(resolveWorkflowForBuildAsync(projectRoot)).resolves.toBe('generic');

    expect(process.env.WORKFLOW_VALUE).toBe('child');
    expect(process.env.NODE_ENV).toBe('production');
    expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
    expect(resolveWorkflowAsync).toHaveBeenCalledWith(projectRoot, 'android');
  });

  it.each([
    ['EXPO_UPDATES_WORKFLOW_OVERRIDE', 'managed', 'managed'],
    ['EXPO_UPDATES_FINGERPRINT_OVERRIDE', 'fixed-hash', 'overridden'],
  ])('honors %s without querying Git', async (name, value, expected) => {
    process.env[name] = value;
    await expect(resolveWorkflowForBuildAsync(projectRoot)).resolves.toBe(expected);
    expect(resolveWorkflowAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid workflow override', async () => {
    process.env.EXPO_UPDATES_WORKFLOW_OVERRIDE = 'invalid';
    await expect(resolveWorkflowForBuildAsync(projectRoot)).rejects.toThrow('Invalid workflow');
  });

  it('requires an explicit config mode', async () => {
    delete process.env.__EXPO_CONFIG_MODE;
    await expect(resolveWorkflowForBuildAsync(projectRoot)).rejects.toThrow(
      'Must provide a config mode'
    );
  });
});
