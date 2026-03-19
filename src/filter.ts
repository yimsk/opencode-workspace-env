/** Prefixes that indicate nix build-system internals */
const EXCLUDED_PREFIXES = ["DIRENV_", "NIX_BUILD_", "__"];

/** Known nix build-system variables that should not leak into shell env */
const EXCLUDED_VARS = new Set([
  "name",
  "system",
  "builder",
  "out",
  "src",
  "outputs",
  "phases",
  "prePhases",
  "preConfigurePhases",
  "preBuildPhases",
  "preInstallPhases",
  "preFixupPhases",
  "preDistPhases",
  "postPhases",
  "buildPhase",
  "configurePhase",
  "installPhase",
  "fixupPhase",
  "distPhase",
  "unpackPhase",
  "patchPhase",
  "checkPhase",
  "buildInputs",
  "nativeBuildInputs",
  "propagatedBuildInputs",
  "propagatedNativeBuildInputs",
  "depsBuildBuild",
  "depsBuildBuildPropagated",
  "depsBuildHost",
  "depsBuildHostPropagated",
  "depsBuildTarget",
  "depsBuildTargetPropagated",
  "depsHostHost",
  "depsHostHostPropagated",
  "depsTargetTarget",
  "depsTargetTargetPropagated",
  "stdenv",
  "strictDeps",
  "shell",
  "dontAddDisableDepTrack",
  "initialPath",
  "cmakeFlags",
  "mesonFlags",
  "DETERMINISTIC_BUILD",
  "SOURCE_DATE_EPOCH",
]);

export function isExcludedEnvKey(key: string): boolean {
  if (EXCLUDED_VARS.has(key)) {
    return true;
  }
  return EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));
}
