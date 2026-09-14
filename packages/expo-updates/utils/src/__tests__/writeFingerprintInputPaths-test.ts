import fs from 'fs';
import os from 'os';
import path from 'path';

import { writeFingerprintInputPaths } from '../writeFingerprintInputPaths';

describe(writeFingerprintInputPaths, () => {
  let projectRoot: string;
  let outputFile: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-updates-inputs-'));
    outputFile = path.join(projectRoot, 'build', 'fingerprint-inputs.json');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('records local and external file, directory, and package dependencies without config contents', () => {
    writeFingerprintInputPaths(outputFile, projectRoot, [
      { type: 'file', filePath: 'plugin.js', reasons: [], hash: 'plugin' },
      { type: 'file', filePath: 'plugin.js', reasons: [], hash: 'plugin' },
      { type: 'dir', filePath: '../shared/android', reasons: [], hash: 'native' },
      {
        type: 'package',
        filePath: '../node_modules/native-module/package.json',
        name: 'native-module',
        version: '1.0.0',
        reasons: [],
        hash: 'package',
      },
      {
        type: 'contents',
        id: 'expoConfig',
        contents: 'private config',
        reasons: [],
        hash: 'config',
      },
      { type: 'file', filePath: '../missing.txt', reasons: [], hash: null },
    ]);

    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8'))).toEqual({
      files: [
        path.resolve(projectRoot, '../node_modules/native-module/package.json'),
        path.resolve(projectRoot, '../missing.txt'),
        path.join(projectRoot, 'plugin.js'),
      ].sort(),
      directories: [path.resolve(projectRoot, '../shared/android')],
    });
    expect(fs.readFileSync(outputFile, 'utf8')).not.toContain('private config');
    expect(fs.existsSync(`${outputFile}.tmp`)).toBe(false);
  });

  it('removes dependencies that are no longer part of the fingerprint', () => {
    writeFingerprintInputPaths(outputFile, projectRoot, [
      { type: 'file', filePath: 'removed.js', reasons: [], hash: 'before' },
    ]);
    writeFingerprintInputPaths(outputFile, projectRoot, []);

    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8'))).toEqual({ files: [], directories: [] });
  });
});
