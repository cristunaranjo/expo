import { consumeConfigEnvMode, getOriginalEnv, loadProjectEnv } from '@expo/env';
import assert from 'assert';

import { resolveWorkflowAsync, validateWorkflow } from './workflow';

export async function resolveWorkflowForBuildAsync(projectRoot: string) {
  process.env = getOriginalEnv();
  const mode = consumeConfigEnvMode();
  assert(mode, 'Must provide a config mode');
  loadProjectEnv(projectRoot, { mode });
  if (process.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE) {
    return 'overridden';
  }
  if (process.env.EXPO_UPDATES_WORKFLOW_OVERRIDE) {
    return validateWorkflow(process.env.EXPO_UPDATES_WORKFLOW_OVERRIDE);
  }
  return resolveWorkflowAsync(projectRoot, 'android');
}

if (require.main === module) {
  const projectRoot = process.argv[2];
  assert(projectRoot, 'Must provide a project root');
  resolveWorkflowForBuildAsync(projectRoot)
    .then(console.log)
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
