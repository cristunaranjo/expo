import path from 'path';
import xcode from 'xcode';

import { readXMLAsync, type XMLObject, type XMLValue } from '../utils/XML';
import { findSchemeNames, findSchemePaths } from './Paths';
import { findSignableTargets, getNativeTargets, TargetType } from './Target';
import { getBuildConfigurationForListIdAndName, getPbxproj, unquote } from './utils/Xcodeproj';

interface SchemeXML {
  Scheme?: {
    BuildAction?: {
      BuildActionEntries?: {
        BuildActionEntry?: BuildActionEntryType[];
      }[];
    }[];
    ArchiveAction?: {
      $?: {
        buildConfiguration?: string;
      };
    }[];
  };
}

interface BuildActionEntryType {
  BuildableReference?: {
    $?: {
      BlueprintName?: string;
      BuildableName?: string;
    };
  }[];
}

export function getSchemesFromXcodeproj(projectRoot: string): string[] {
  return findSchemeNames(projectRoot);
}

/** Read the selected application's configuration without evaluating Expo config. */
export async function getBuildConfigurationForSchemeAsync(
  projectRoot: string,
  scheme: string,
  configuration?: string
): Promise<{ configuration: string; osType: string }> {
  const schemePaths = findSchemePaths(projectRoot).filter(
    (file) => path.parse(file).name === scheme
  );
  if (schemePaths.length > 1) {
    throw new Error(`Scheme '${scheme}' is defined in multiple files: ${schemePaths.join(', ')}`);
  }

  const schemePath = schemePaths[0];
  let project: xcode.XcodeProject;
  let targetId: string;
  if (schemePath) {
    const xml = await readXMLAsync({ path: schemePath });
    const schemeXml = getXmlObject(getXmlObject(xml)?.Scheme);
    const launchAction = getFirstXmlElement(schemeXml, 'LaunchAction');
    const runConfiguration = getXmlObject(launchAction?.$)?.buildConfiguration;
    if (configuration === undefined && typeof runConfiguration === 'string') {
      configuration = runConfiguration;
    }

    const runnable = getFirstXmlElement(launchAction, 'BuildableProductRunnable');
    let reference = getFirstXmlElement(runnable, 'BuildableReference');
    if (!reference) {
      const buildAction = getFirstXmlElement(schemeXml, 'BuildAction');
      const entries = getFirstXmlElement(buildAction, 'BuildActionEntries')?.BuildActionEntry;
      const appReferences = (Array.isArray(entries) ? entries : [])
        .map((entry) => getFirstXmlElement(getXmlObject(entry), 'BuildableReference'))
        .filter((entry) => {
          const name = getXmlObject(entry?.$)?.BuildableName;
          return typeof name === 'string' && name.endsWith('.app');
        });
      if (appReferences.length === 1) {
        reference = appReferences[0];
      }
    }

    const attributes = getXmlObject(reference?.$);
    const identifier = attributes?.BlueprintIdentifier;
    const container = attributes?.ReferencedContainer;
    if (
      typeof identifier !== 'string' ||
      typeof container !== 'string' ||
      !container.startsWith('container:')
    ) {
      throw new Error(`Scheme '${scheme}' does not identify an application target`);
    }

    let schemeContainer = path.dirname(schemePath);
    while (!['.xcodeproj', '.xcworkspace'].includes(path.extname(schemeContainer))) {
      const parent = path.dirname(schemeContainer);
      if (parent === schemeContainer) {
        throw new Error(`Cannot resolve the container for scheme '${scheme}'`);
      }
      schemeContainer = parent;
    }
    const projectPath = path.resolve(
      path.dirname(schemeContainer),
      container.slice('container:'.length)
    );
    project = xcode.project(path.join(projectPath, 'project.pbxproj'));
    project.parseSync();
    targetId = identifier;
  } else {
    project = getPbxproj(projectRoot);
    const target = getNativeTargets(project).find(([, target]) => unquote(target.name) === scheme);
    if (!target) {
      throw new Error(`Scheme '${scheme}' does not exist in the native project`);
    }
    targetId = target[0];
  }

  if (configuration === undefined) {
    throw new Error(
      `Cannot read the Run configuration for scheme '${scheme}'. Save its .xcscheme file or pass --configuration.`
    );
  }
  const target = getNativeTargets(project).find(([id]) => id === targetId)?.[1];
  if (!target || !unquote(target.productType).startsWith(TargetType.APPLICATION)) {
    throw new Error(`Scheme '${scheme}' does not identify an application target`);
  }
  const [, buildConfiguration] = getBuildConfigurationForListIdAndName(project, {
    configurationListId: target.buildConfigurationList,
    buildConfiguration: configuration,
  });
  const settings = buildConfiguration.buildSettings;
  const osType =
    unquote(target.productType) === TargetType.WATCH
      ? 'watchOS'
      : settings.SDKROOT === 'appletvos' || 'TVOS_DEPLOYMENT_TARGET' in settings
        ? 'tvOS'
        : settings.SDKROOT === 'xros'
          ? 'xrOS'
          : 'iOS';
  return { configuration, osType };
}

function getXmlObject(value: XMLValue | undefined): XMLObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function getFirstXmlElement(parent: XMLObject | undefined, name: string): XMLObject | undefined {
  const elements = parent?.[name];
  return Array.isArray(elements) ? getXmlObject(elements[0]) : undefined;
}

export function getRunnableSchemesFromXcodeproj(
  projectRoot: string,
  { configuration = 'Debug' }: { configuration?: string } = {}
): { name: string; osType: string; type: string }[] {
  const project = getPbxproj(projectRoot);

  return findSignableTargets(project).map(([, target]) => {
    let osType = 'iOS';
    const type = unquote(target.productType);

    if (type === TargetType.WATCH) {
      osType = 'watchOS';
    } else if (
      // (apps) com.apple.product-type.application
      // (app clips) com.apple.product-type.application.on-demand-install-capable
      // NOTE(EvanBacon): This matches against `watchOS` as well so we check for watch first.
      type.startsWith(TargetType.APPLICATION)
    ) {
      // Attempt to resolve the platform SDK for each target so we can filter devices.
      const xcConfigurationList =
        project.hash.project.objects.XCConfigurationList[target.buildConfigurationList];

      if (xcConfigurationList) {
        const buildConfiguration =
          xcConfigurationList.buildConfigurations.find(
            (value: { comment: string; value: string }) => value.comment === configuration
          ) || xcConfigurationList.buildConfigurations[0];
        if (buildConfiguration?.value) {
          const xcBuildConfiguration =
            project.hash.project.objects.XCBuildConfiguration?.[buildConfiguration.value];

          const buildSdkRoot = xcBuildConfiguration?.buildSettings.SDKROOT;
          if (
            buildSdkRoot === 'appletvos' ||
            'TVOS_DEPLOYMENT_TARGET' in xcBuildConfiguration?.buildSettings
          ) {
            // Is a TV app...
            osType = 'tvOS';
          } else if (buildSdkRoot === 'iphoneos') {
            osType = 'iOS';
          }
        }
      }
    }

    return {
      name: unquote(target.name),
      osType,
      type: unquote(target.productType),
    };
  });
}

async function readSchemeAsync(
  projectRoot: string,
  scheme: string
): Promise<SchemeXML | undefined> {
  const allSchemePaths = findSchemePaths(projectRoot);
  // NOTE(cedric): test on POSIX or UNIX separators, where UNIX needs to be double-escaped in the template literal and regex
  const re = new RegExp(`[\\\\/]${scheme}.xcscheme`, 'i');
  const schemePath = allSchemePaths.find((i) => re.exec(i));
  if (schemePath) {
    return (await readXMLAsync({ path: schemePath })) as unknown as SchemeXML | undefined;
  } else {
    throw new Error(`scheme '${scheme}' does not exist, make sure it's marked as shared`);
  }
}

export async function getApplicationTargetNameForSchemeAsync(
  projectRoot: string,
  scheme: string
): Promise<string> {
  const schemeXML = await readSchemeAsync(projectRoot, scheme);
  const buildActionEntry =
    schemeXML?.Scheme?.BuildAction?.[0]?.BuildActionEntries?.[0]?.BuildActionEntry;
  const targetName =
    buildActionEntry?.length === 1
      ? getBlueprintName(buildActionEntry[0])
      : getBlueprintName(
          buildActionEntry?.find((entry) => {
            return entry.BuildableReference?.[0]?.['$']?.BuildableName?.endsWith('.app');
          })
        );
  if (!targetName) {
    throw new Error(`${scheme}.xcscheme seems to be corrupted`);
  }
  return targetName;
}

export async function getArchiveBuildConfigurationForSchemeAsync(
  projectRoot: string,
  scheme: string
): Promise<string> {
  const schemeXML = await readSchemeAsync(projectRoot, scheme);
  const buildConfiguration = schemeXML?.Scheme?.ArchiveAction?.[0]?.['$']?.buildConfiguration;
  if (!buildConfiguration) {
    throw new Error(`${scheme}.xcscheme seems to be corrupted`);
  }
  return buildConfiguration;
}

function getBlueprintName(entry?: BuildActionEntryType): string | undefined {
  return entry?.BuildableReference?.[0]?.['$']?.BlueprintName;
}
