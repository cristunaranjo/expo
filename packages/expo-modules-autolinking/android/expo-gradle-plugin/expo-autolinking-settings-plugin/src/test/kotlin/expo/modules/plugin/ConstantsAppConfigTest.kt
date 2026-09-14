package expo.modules.plugin

import expo.modules.plugin.configuration.ExpoAutolinkingConfig
import expo.modules.plugin.configuration.ExpoModule
import expo.modules.plugin.configuration.GradleProject
import expo.modules.plugin.gradle.linkConstantsAppConfig
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.gradle.api.Action
import org.gradle.api.Project
import org.gradle.api.initialization.Settings
import org.gradle.api.invocation.Gradle
import org.gradle.api.plugins.AppliedPlugin
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ConstantsAppConfigTest {
  @get:Rule
  val temporaryFolder = TemporaryFolder()

  private val gradle = mockk<Gradle>(relaxed = true)
  private val settings = mockk<Settings> {
    every { getGradle() } returns this@ConstantsAppConfigTest.gradle
  }

  @Test
  fun `registers the Constants script before each application is evaluated`() {
    val constants = temporaryFolder.newFolder("expo-constants")
    File(constants, "android").mkdirs()
    val script = File(constants, "scripts/get-app-config-android-tasks.gradle")
    script.parentFile.mkdirs()
    script.writeText("")
    val beforeProject = slot<Action<Project>>()
    every { gradle.beforeProject(capture(beforeProject)) } returns Unit

    settings.linkConstantsAppConfig(config(constants))

    for (name in listOf(":app", ":secondApp")) {
      val project = mockk<Project>(relaxed = true)
      every { project.path } returns name
      val applicationPlugin = slot<Action<AppliedPlugin>>()
      every {
        project.pluginManager.withPlugin("com.android.application", capture(applicationPlugin))
      } returns Unit
      beforeProject.captured.execute(project)
      verify(exactly = 0) { project.apply(any<Map<String, *>>()) }

      applicationPlugin.captured.execute(mockk())
      verify {
        project.extensions.extraProperties.set("expoConstantsProjectPath", ":constantsLibrary")
        project.extensions.extraProperties.set("expoConstantsConfigScript", File(script.parentFile, "getAppConfig.js").absolutePath)
        project.apply(mapOf("from" to script))
      }
    }
  }

  @Test
  fun `leaves older Constants versions using their library script`() {
    val constants = temporaryFolder.newFolder("older-constants")
    settings.linkConstantsAppConfig(config(constants))
    verify(exactly = 0) { gradle.beforeProject(any<Action<Project>>()) }
  }

  @Test
  fun `does not register a script when Constants is not linked`() {
    settings.linkConstantsAppConfig(ExpoAutolinkingConfig())
    verify(exactly = 0) { gradle.beforeProject(any<Action<Project>>()) }
  }

  private fun config(constants: File) = ExpoAutolinkingConfig(
    modules = listOf(
      ExpoModule(
        packageName = "expo-constants",
        packageVersion = "58.0.0",
        projects = listOf(GradleProject("constantsLibrary", File(constants, "android").absolutePath))
      )
    )
  )
}
