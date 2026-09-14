package expo.modules.plugin.gradle

import expo.modules.plugin.configuration.ExpoAutolinkingConfig
import org.gradle.api.initialization.Settings
import java.io.File

internal fun Settings.linkConstantsAppConfig(config: ExpoAutolinkingConfig) {
  val constants = config.modules.singleOrNull { it.packageName == "expo-constants" }
    ?.projects?.singleOrNull() ?: return
  val script = File(File(constants.sourceDir).parentFile, "scripts/get-app-config-android-tasks.gradle")
  // Older Constants versions still generate their config in the library project.
  if (!script.isFile) return

  val constantsPath = ":${constants.name}"
  gradle.beforeProject { project ->
    // RNGP can finish evaluating the app before the Constants library is evaluated.
    project.pluginManager.withPlugin("com.android.application") {
      project.extensions.extraProperties.set("expoConstantsProjectPath", constantsPath)
      project.extensions.extraProperties.set("expoConstantsConfigScript", File(script.parentFile, "getAppConfig.js").absolutePath)
      project.apply(mapOf("from" to script))
    }
  }
}
