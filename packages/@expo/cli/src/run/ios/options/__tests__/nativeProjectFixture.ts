import rnFixture from '../../../../prebuild/__tests__/fixtures/react-native-project';

export const schemePath = 'ios/ReactNativeProject.xcodeproj/xcshareddata/xcschemes';

export function createScheme(configuration: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme version="1.3">
  <LaunchAction buildConfiguration="${configuration}">
    <BuildableProductRunnable>
      <BuildableReference BlueprintIdentifier="13B07F861A680F5B00A75B9A"
        BlueprintName="ReactNativeProject" BuildableName="ReactNativeProject.app"
        ReferencedContainer="container:ReactNativeProject.xcodeproj" />
    </BuildableProductRunnable>
  </LaunchAction>
  <ArchiveAction buildConfiguration="Release" />
</Scheme>`;
}

export function createNativeProjectFixture(configuration = 'Debug') {
  const pbxproj = 'ios/ReactNativeProject.xcodeproj/project.pbxproj';
  return {
    ...rnFixture,
    [pbxproj]:
      configuration === 'Debug' || configuration === 'Release'
        ? rnFixture[pbxproj]
        : rnFixture[pbxproj].replaceAll('name = Debug;', `name = ${configuration};`),
    [`${schemePath}/ReactNativeProject.xcscheme`]: createScheme(configuration),
  };
}
