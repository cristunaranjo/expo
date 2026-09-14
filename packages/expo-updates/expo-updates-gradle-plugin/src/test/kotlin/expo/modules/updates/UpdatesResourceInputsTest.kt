package expo.modules.updates

import java.io.File
import org.gradle.testfixtures.ProjectBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UpdatesResourceInputsTest {
  @get:Rule val temporaryFolder = TemporaryFolder()

  @Test
  fun `missing descriptor starts without discovered dependencies`() {
    assertEquals(
      FingerprintInputPaths(emptyList(), emptyList()),
      readFingerprintInputPaths(File(temporaryFolder.root, "missing.json"))
    )
  }

  @Test
  fun `reads separate file and directory dependencies`() {
    val descriptor = temporaryFolder.newFile("inputs.json")
    val source = temporaryFolder.newFile("plugin.js")
    val nativeDirectory = temporaryFolder.newFolder("native")
    descriptor.writeText("""{"files":["${source.invariantSeparatorsPath}"],"directories":["${nativeDirectory.invariantSeparatorsPath}"]}""")
    assertEquals(
      FingerprintInputPaths(listOf(source), listOf(nativeDirectory)),
      readFingerprintInputPaths(descriptor)
    )
  }

  @Test(expected = IllegalArgumentException::class)
  fun `rejects a relative dependency path`() {
    val descriptor = temporaryFolder.newFile("inputs.json")
    descriptor.writeText("""{"files":["relative.js"],"directories":[]}""")
    readFingerprintInputPaths(descriptor)
  }

  @Test
  fun `environment inputs change without recording raw values`() {
    val initial = hashResourceEnvironment(mapOf("EXPO_PUBLIC_VALUE" to "before"))
    val changed = hashResourceEnvironment(mapOf("EXPO_PUBLIC_VALUE" to "after"))
    assertEquals(initial, hashResourceEnvironment(mapOf("EXPO_PUBLIC_VALUE" to "before")))
    assertFalse(initial == changed)
    assertFalse(initial.values.any { it.contains("before") })
    assertTrue(initial.values.all { it.length == 64 })
  }

  @Test
  fun `tracks ancestor dependency manifests lockfiles and ignore files`() {
    val root = temporaryFolder.newFolder("workspace")
    val app = File(root, "apps/mobile")
    val inputs = ancestorPackageFiles(app)
    assertTrue(inputs.contains(File(root, "pnpm-lock.yaml")))
    assertTrue(inputs.contains(File(root, ".gitignore")))
    assertTrue(inputs.contains(File(root, "package.json")))
    assertTrue(inputs.contains(File(app, ".gitignore")))
  }

  @Test
  fun `tracks source and dotenv files but excludes generated native outputs`() {
    val project = ProjectBuilder.builder().withProjectDir(temporaryFolder.root).build()
    val task = project.tasks.register("resources", ExpoUpdatesPlugin.CreateUpdatesResourcesTask::class.java).get()
    task.projectRoot.set(temporaryFolder.root.absolutePath)
    val config = temporaryFolder.newFile("app.config.js")
    val dotenv = temporaryFolder.newFile(".env.production")
    val nativeSource = File(temporaryFolder.newFolder("android", "app", "src"), "Main.kt").apply { writeText("source") }
    val generated = File(temporaryFolder.newFolder("android", "app", "build"), "generated.txt").apply { writeText("output") }
    val customOutput = File(temporaryFolder.newFolder("out"), "generated.txt").apply { writeText("output") }
    task.excludedOutputDirectories.from(customOutput.parentFile)

    assertTrue(task.sourceFiles.files.containsAll(listOf(config, dotenv, nativeSource)))
    assertFalse(task.sourceFiles.files.contains(generated))
    assertFalse(task.sourceFiles.files.contains(customOutput))
  }

  @Test
  fun `tracks discovered dependencies and missing directory creation`() {
    val project = ProjectBuilder.builder().withProjectDir(temporaryFolder.root).build()
    val task = project.tasks.register("resources", ExpoUpdatesPlugin.CreateUpdatesResourcesTask::class.java).get()
    task.projectRoot.set(temporaryFolder.root.absolutePath)
    task.entryFile.set(File(temporaryFolder.root, "index.js").absolutePath)
    val descriptor = temporaryFolder.newFile("inputs.json")
    task.fingerprintInputFile.set(descriptor)
    val missingFile = File(temporaryFolder.root, "missing.js")
    val missingDirectory = File(temporaryFolder.root, "missing-native")
    descriptor.writeText("""{"files":["${missingFile.invariantSeparatorsPath}"],"directories":["${missingDirectory.invariantSeparatorsPath}"]}""")

    assertTrue(task.dependencyFiles.files.contains(missingFile))
    assertEquals(mapOf(missingDirectory.absolutePath to false), task.dependencyDirectoryState)
    missingDirectory.mkdirs()
    assertEquals(mapOf(missingDirectory.absolutePath to true), task.dependencyDirectoryState)
    val source = File(missingDirectory, "Native.kt").apply { writeText("source") }
    assertTrue(task.dependencyFiles.files.contains(source))

    descriptor.writeText("""{"files":[],"directories":[]}""")
    assertFalse(task.dependencyFiles.files.contains(missingFile))
    assertFalse(task.dependencyFiles.files.contains(source))
  }
}
