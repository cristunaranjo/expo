package expo.modules.updates

import com.android.build.api.variant.AndroidComponentsExtension
import com.facebook.react.ReactExtension
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.ConfigurableFileTree
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import org.slf4j.LoggerFactory
import java.io.File
import java.util.Locale
import javax.inject.Inject

abstract class ExpoUpdatesPlugin : Plugin<Project> {
  override fun apply(project: Project) {
    val reactExtension = project.extensions.findByType(ReactExtension::class.java) ?: run {
      logger.warn("Stop expo-updates resource generation because ReactExtension is not registered")
      return
    }

    val androidComponents = project.extensions.getByType(AndroidComponentsExtension::class.java)

    if (isNativeDebuggingEnabled(project)) {
      logger.warn("Disable all react.debuggableVariants because EX_UPDATES_NATIVE_DEBUG=1")
      reactExtension.debuggableVariants.set(listOf())
    }

    val updatesPackageDirectory by lazy {
      project.providers.exec {
        val args = reactExtension.nodeExecutableAndArgs.get() + listOf("--print", "require('path').dirname(require.resolve('expo-updates/package.json'))")
        it.commandLine(if (Os.isFamily(Os.FAMILY_WINDOWS)) listOf("cmd", "/c") + args else args)
        it.workingDir(reactExtension.root.get().asFile)
      }.standardOutput.asText.map { it.trim() }
    }

    androidComponents.onVariants(androidComponents.selector().all()) { variant ->
      val targetName = variant.name.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
      val isDebuggableVariant = isDebuggableVariant(variant.name, reactExtension.debuggableVariants.get())
      val configMode = getConfigMode(
        inheritedMode = System.getenv("__EXPO_CONFIG_MODE"),
        isDebuggableVariant = isDebuggableVariant
      )
      val projectWorkflow = project.providers.exec {
        val args = reactExtension.nodeExecutableAndArgs.get() + listOf(
          "${updatesPackageDirectory.get()}/utils/build/resolveWorkflowForBuild.js",
          reactExtension.root.get().asFile.absolutePath
        )
        it.commandLine(if (Os.isFamily(Os.FAMILY_WINDOWS)) listOf("cmd", "/c") + args else args)
        it.environment("__EXPO_CONFIG_MODE", configMode)
        it.workingDir(reactExtension.root.get().asFile)
      }.standardOutput.asText.map { output ->
        output.trim().also { require(it in listOf("managed", "generic", "overridden")) { "Invalid Expo Updates workflow: $it" } }
      }

      val createUpdatesResourcesTask = project.tasks.register("create${targetName}UpdatesResources", CreateUpdatesResourcesTask::class.java) {
        it.description = "expo-updates: Create updates resources for ${targetName}."
        it.projectRoot.set(reactExtension.root.map { directory -> directory.asFile.absolutePath })
        it.nodeExecutableAndArgs.set(reactExtension.nodeExecutableAndArgs)
        it.debuggableVariant.set(isDebuggableVariant)
        it.configMode.set(configMode)
        it.entryFile.set(detectedEntryFile(reactExtension).absolutePath)
        it.updatesPackageDirectory.set(updatesPackageDirectory)
        it.projectWorkflow.set(projectWorkflow)
        it.resourceEnvironment.set(project.providers.environmentVariablesPrefixedBy("EXPO_").map(::hashResourceEnvironment))
        for (name in listOf("PATH", "NODE_PATH", "NODE_OPTIONS", "BABEL_ENV")) {
          it.resourceEnvironment.put(name, project.providers.environmentVariable(name)
            .map { value -> hashResourceEnvironment(mapOf(name to value)).getValue(name) }.orElse("unset"))
        }
        it.inheritedDotenvMarker.set(project.providers.environmentVariable("__EXPO_ENV_LOADED").orElse(""))
        it.excludedOutputDirectories.from(project.rootProject.allprojects.map { subproject -> subproject.layout.buildDirectory })
        it.fingerprintInputFile.set(project.layout.buildDirectory.file("intermediates/expo-updates/${variant.name}/fingerprint-inputs.json"))
      }
      variant.sources.assets?.addGeneratedSourceDirectory(createUpdatesResourcesTask, CreateUpdatesResourcesTask::assetDir)
    }
  }

  abstract class CreateUpdatesResourcesTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @get:Inject
    abstract val objects: ObjectFactory

    @get:Input
    abstract val projectRoot: Property<String>

    @get:Input
    abstract val nodeExecutableAndArgs: ListProperty<String>

    @get:Input
    abstract val debuggableVariant: Property<Boolean>

    @get:Input
    abstract val configMode: Property<String>

    @get:Input
    abstract val entryFile: Property<String>

    @get:Internal
    abstract val updatesPackageDirectory: Property<String>

    @get:Input
    abstract val projectWorkflow: Property<String>

    @get:Input
    abstract val resourceEnvironment: MapProperty<String, String>

    @get:Input
    abstract val inheritedDotenvMarker: Property<String>

    @get:Internal
    val excludedOutputDirectories: ConfigurableFileCollection = objects.fileCollection()

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    val sourceFiles: ConfigurableFileTree
      get() = resourceFileTree(objects, File(projectRoot.get()), excludedOutputDirectories.files)

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.ABSOLUTE)
    val dependencyFiles: ConfigurableFileCollection
      get() {
        val sources = readFingerprintInputPaths(fingerprintInputFile.get().asFile)
        return objects.fileCollection().from(
          sources.files,
          sources.directories.map { resourceFileTree(objects, it, excludedOutputDirectories.files) },
          ancestorPackageFiles(File(projectRoot.get())),
          File(entryFile.get())
        )
      }

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    val resourceScriptFiles: ConfigurableFileTree
      get() = objects.fileTree().setDir(File(updatesPackageDirectory.get(), "utils/build"))

    @get:Input
    val dependencyDirectoryState: Map<String, Boolean>
      get() = readFingerprintInputPaths(fingerprintInputFile.get().asFile).directories
        .associate { it.absolutePath to it.isDirectory }

    @get:OutputFile
    abstract val fingerprintInputFile: RegularFileProperty

    @get:OutputDirectory
    abstract val assetDir: DirectoryProperty

    @TaskAction
    fun exec() {
      assetDir.get().asFile.deleteRecursively()
      assetDir.get().asFile.mkdirs()
      val expoUpdatesDir = updatesPackageDirectory.get()
      execOperations.exec {
        val args = mutableListOf<String>().apply {
          addAll(nodeExecutableAndArgs.get())
          add("${expoUpdatesDir}/utils/build/createUpdatesResources.js")
          add("android")
          add(projectRoot.get())
          add(assetDir.get().toString())
          add(if (debuggableVariant.get()) "only-fingerprint" else "all")
          add(entryFile.get())
          add(debuggableVariant.get().toString())
          add(fingerprintInputFile.get().asFile.absolutePath)
        }

        if (Os.isFamily(Os.FAMILY_WINDOWS)) {
          it.commandLine("cmd", "/c", *args.toTypedArray())
        } else {
          it.commandLine(args)
        }

        it.environment("__EXPO_CONFIG_MODE", configMode.get())
        it.workingDir(projectRoot)
      }
    }
  }

  companion object {
    internal val logger by lazy {
      LoggerFactory.getLogger(ExpoUpdatesPlugin::class.java)
    }
  }
}

internal fun getConfigMode(
  inheritedMode: String?,
  isDebuggableVariant: Boolean
): String = when {
  inheritedMode != null -> inheritedMode
  isDebuggableVariant -> "development"
  else -> "production"
}

internal fun isDebuggableVariant(variantName: String, debuggableVariants: List<String>): Boolean =
  debuggableVariants.any { it.equals(variantName, ignoreCase = true) }

/**
 * Synced implementation from [RNGP](https://github.com/facebook/react-native/blob/9bdd777fd766ff/packages/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/PathUtils.kt#L20-L33)
 */
private fun detectedEntryFile(config: ReactExtension): File {
  val envVariableOverride = System.getenv("ENTRY_FILE") ?: null
  val entryFile = config.entryFile.orNull?.asFile
  val reactRoot = config.root.get().asFile
  return when {
    envVariableOverride != null -> File(reactRoot, envVariableOverride)
    entryFile != null -> entryFile
    File(reactRoot, "index.android.js").exists() -> File(reactRoot, "index.android.js")
    else -> File(reactRoot, "index.js")
  }
}

private fun isNativeDebuggingEnabled(project: Project): Boolean {
  if (System.getenv("EX_UPDATES_NATIVE_DEBUG") == "1") {
    return true
  }
  return project.findProperty("EX_UPDATES_NATIVE_DEBUG") == "true"
}
