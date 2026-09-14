package expo.modules.updates

import groovy.json.JsonSlurper
import java.io.File
import java.security.MessageDigest
import org.gradle.api.file.ConfigurableFileTree
import org.gradle.api.model.ObjectFactory

internal data class FingerprintInputPaths(val files: List<File>, val directories: List<File>)

internal fun readFingerprintInputPaths(descriptor: File): FingerprintInputPaths {
  if (!descriptor.exists()) {
    return FingerprintInputPaths(emptyList(), emptyList())
  }
  val value = JsonSlurper().parse(descriptor) as? Map<*, *>
    ?: error("Invalid Expo Updates input descriptor: $descriptor")
  fun paths(key: String): List<File> {
    val paths = value[key] as? List<*>
      ?: error("Invalid Expo Updates input descriptor field '$key': $descriptor")
    return paths.map { path ->
      require(path is String && File(path).isAbsolute) {
        "Invalid Expo Updates input path in '$key': $descriptor"
      }
      File(path)
    }
  }
  return FingerprintInputPaths(paths("files"), paths("directories"))
}

internal fun hashResourceEnvironment(environment: Map<String, String>): Map<String, String> =
  environment.mapValues { (_, value) ->
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
  }

internal fun ancestorPackageFiles(projectRoot: File): List<File> =
  generateSequence(projectRoot) { it.parentFile }.flatMap { directory ->
    listOf("package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pnpm-workspace.yaml", "bun.lock", "bun.lockb", ".gitignore")
      .map { File(directory, it) }
  }.toList()

internal fun resourceFileTree(objects: ObjectFactory, root: File, outputs: Set<File>): ConfigurableFileTree =
  objects.fileTree().apply {
    setDir(root)
    exclude(UPDATES_INPUT_EXCLUDES)
    exclude { element -> outputs.any { element.file.toPath().startsWith(it.toPath()) } }
  }

// Generated native outputs must not become inputs of the resource task that creates them.
internal val UPDATES_INPUT_EXCLUDES = listOf(
  "**/.git/**",
  "**/.gradle/**",
  "**/.cxx/**",
  "**/build/**",
  "**/Pods/**",
  "**/node_modules/**",
  "**/.expo/**"
)
