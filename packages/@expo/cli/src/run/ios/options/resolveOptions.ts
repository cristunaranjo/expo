import { getConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import type { OSType } from '../../../start/platforms/ios/simctl';
import { isOSType } from '../../../start/platforms/ios/simctl';
import { resolveBuildCacheProvider } from '../../../utils/build-cache-providers';
import { profile } from '../../../utils/profile';
import { resolveBundlerPropsAsync } from '../../resolveBundlerProps';
import type { BuildProps, Options } from '../XcodeBuild.types';
import { isSimulatorDevice, resolveDeviceAsync } from './resolveDevice';
import { resolveNativeSchemePropsAsync } from './resolveNativeScheme';
import { resolveXcodeProject } from './resolveXcodeProject';

/** Resolve arguments for the `run:ios` command. */
export async function resolveOptionsAsync(
  projectRoot: string,
  options: Options,
  nativeOptions?: NativeBuildOptions
): Promise<BuildProps> {
  const { xcodeProject, scheme, configuration, osType } =
    nativeOptions ?? (await resolveNativeBuildOptionsAsync(projectRoot, options));
  const bundlerProps = await resolveBundlerPropsAsync(projectRoot, options);

  // Returns null when device is "generic" for build-only workflows.
  const device = await profile(resolveDeviceAsync)(options.device, {
    osType,
    xcodeProject,
    scheme,
    configuration,
  });
  const isSimulator = device ? isSimulatorDevice(device) : true;
  const projectConfig = getConfig(projectRoot);
  const buildCacheProvider = await resolveBuildCacheProvider(
    projectConfig.exp?.buildCacheProvider ?? projectConfig.exp.experiments?.buildCacheProvider,
    projectRoot
  );

  // Skip native bundling for Debug device builds to avoid resetting Metro's cache.
  const shouldSkipInitialBundling = configuration === 'Debug' && !isSimulator;

  return {
    ...bundlerProps,
    projectRoot,
    isSimulator,
    xcodeProject,
    device,
    osType,
    configuration,
    shouldSkipInitialBundling,
    buildCache: options.buildCache !== false,
    scheme,
    buildCacheProvider,
  };
}

type NativeBuildOptions = Pick<BuildProps, 'xcodeProject' | 'scheme' | 'configuration' | 'osType'>;

export async function resolveNativeBuildOptionsAsync(
  projectRoot: string,
  options: Options
): Promise<NativeBuildOptions> {
  const xcodeProject = resolveXcodeProject(projectRoot);

  // Resolve the scheme before the device so we can filter devices based on
  // whichever scheme is selected (i.e. don't present TV devices if the scheme cannot be run on a TV).
  const { name: scheme } = await resolveNativeSchemePropsAsync(projectRoot, options, xcodeProject);

  const { configuration, osType: schemeOsType } =
    await IOSConfig.BuildScheme.getBuildConfigurationForSchemeAsync(
      projectRoot,
      scheme,
      options.configuration ?? (options.scheme ? undefined : 'Debug')
    );
  const osType: OSType = isOSType(schemeOsType) ? schemeOsType : 'iOS';
  return { xcodeProject, scheme, configuration, osType };
}
