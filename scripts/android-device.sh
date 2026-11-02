#!/usr/bin/env bash
# Local-only debug build and connected-device install. No cloud, Play Store or uninstall.
set -Eeuo pipefail
die() { printf 'JODLO: ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
cat <<'USAGE'
npm run android:devices   # inspect USB/emulator connections
npm run android:build     # build debug APK only
npm run android:install   # build + install on one ready device
npm run android:run       # build + install + launch
npm run android:run -- --serial DEVICE_SERIAL  # choose among multiple devices
Alternatively set ANDROID_SERIAL=DEVICE_SERIAL.
USAGE
}
mode="${1:-run}"
if (( $# > 0 )); then shift; fi
case "$mode" in devices|build|install|run) ;; help|--help|-h) usage; exit 0 ;; *) usage >&2; die "Unknown mode: $mode";; esac
serial="${ANDROID_SERIAL:-}"
while (( $# > 0 )); do
  case "$1" in
    --serial|-s)
      (( $# >= 2 )) || die "Missing device serial"
      serial="$2"
      [[ -n "$serial" && "$serial" != -* && "$serial" != *$'\n'* ]] || die "Invalid device serial"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd -- "$script_dir/.." && pwd)"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
[[ "$sdk" == /* ]] || die "ANDROID_HOME must be an absolute path."
export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk"

adb_bin=""
if command -v adb >/dev/null 2>&1; then
  adb_bin="$(command -v adb)"
elif [[ -x "$sdk/platform-tools/adb" ]]; then
  adb_bin="$sdk/platform-tools/adb"
fi

if [[ "$mode" == devices ]]; then
  [[ -n "$adb_bin" ]] || die "adb missing. Install Android platform-tools."
  "$adb_bin" devices -l
  exit
fi

chosen=""
if [[ "$mode" == install || "$mode" == run ]]; then
  [[ -n "$adb_bin" ]] || die "adb missing. Install platform-tools and enable USB debugging."
  if ! listing="$("$adb_bin" devices 2>&1)"; then
    printf '%s\n' "$listing" >&2
    die "Could not enumerate Android devices."
  fi
  ready=()
  other_state=""
  while IFS= read -r line; do
    line="${line%$'\r'}"
    read -r id state _ <<< "$line"
    [[ -n "${id:-}" ]] || continue
    if [[ "$state" == device ]]; then
      ready+=("$id")
    elif [[ -n "$serial" && "$id" == "$serial" ]]; then
      other_state="$state"
    fi
  done <<< "$listing"
  if [[ -n "$serial" ]]; then
    for id in "${ready[@]}"; do
      if [[ "$id" == "$serial" ]]; then chosen="$id"; break; fi
    done
    [[ -n "$chosen" ]] || die "Device '$serial' is not ready (${other_state:-not connected}). Check adb devices and accept USB debugging."
  else
    case "${#ready[@]}" in
      0)
        printf '%s\n' "$listing" >&2
        die "No authorized Android device. Connect USB, unlock phone, enable USB debugging, accept RSA prompt."
        ;;
      1) chosen="${ready[0]}" ;;
      *)
        printf 'JODLO: Ready devices:\n' >&2
        printf '  %s\n' "${ready[@]}" >&2
        die "Multiple ready devices: specify npm run android:run -- --serial DEVICE_SERIAL"
        ;;
    esac
  fi
  printf 'JODLO: Device selected: %s\n' "$chosen"
fi

[[ -d "$sdk/platforms/android-35" ]] || die "Android SDK platform 35 missing. Install sdkmanager 'platforms;android-35'."
[[ -d "$sdk/build-tools/35.0.0" ]] || die "Android build-tools 35.0.0 missing. Install sdkmanager 'build-tools;35.0.0'."
# Gradle 8.10.2 can build JODLO on a full JDK 17 OR 21.
# Both :core and :app still compile Java 17 bytecode.
# Respect the developer's already working JAVA_HOME; never change system Java.
jdk_candidates=()
if [[ -n "${JODLO_JDK_HOME:-}" ]]; then
  jdk_candidates+=("$JODLO_JDK_HOME")
elif [[ -n "${JODLO_JDK17_HOME:-}" ]]; then
  # Historical explicit setting remains JDK17 only.
  jdk_candidates+=("$JODLO_JDK17_HOME")
else
  if [[ -n "${JAVA_HOME:-}" ]]; then jdk_candidates+=("$JAVA_HOME"); fi
  if command -v javac >/dev/null 2>&1; then
    resolved_javac="$(readlink -f "$(command -v javac)" 2>/dev/null || true)"
    if [[ -n "$resolved_javac" && -x "$resolved_javac" ]]; then
      jdk_candidates+=("$(dirname "$(dirname "$resolved_javac")")")
    fi
  fi
  for standard_jdk in /usr/lib/jvm/java-17-openjdk-* /usr/lib/jvm/java-21-openjdk-* \
    /usr/lib/jvm/temurin-17-* /usr/lib/jvm/temurin-21-* \
    "$HOME/.sdkman/candidates/java/current"; do
    if [[ -d "$standard_jdk" ]]; then jdk_candidates+=("$standard_jdk"); fi
  done
fi
jdk_home=""
jdk_major=""
for candidate in "${jdk_candidates[@]}"; do
  [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]] || continue
  version="$("$candidate/bin/javac" -version 2>&1)" || continue
  case "$version" in
    "javac 17"|"javac 17."*) major=17 ;;
    "javac 21"|"javac 21."*) major=21 ;;
    *) continue ;;
  esac
  if [[ -n "${JODLO_JDK17_HOME:-}" && "$major" != 17 ]]; then continue; fi
  jdk_home="$candidate"
  jdk_major="$major"
  break
done
[[ -n "$jdk_home" ]] || die "No full JDK 17 or 21 found (java + javac). Your existing JDK 21 works: set JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 or JODLO_JDK_HOME=/path/to/jdk. Legacy JODLO_JDK17_HOME accepts Java 17 only."
export JAVA_HOME="$jdk_home"
export PATH="$JAVA_HOME/bin:$PATH"
printf 'JODLO: Using full JDK %s: %s (Java 17 bytecode target)\n' "$jdk_major" "$JAVA_HOME"
if command -v gradle >/dev/null 2>&1; then
  gradle_bin="$(command -v gradle)"
elif [[ -x "$HOME/.local/opt/gradle-8.10.2/bin/gradle" ]]; then
  gradle_bin="$HOME/.local/opt/gradle-8.10.2/bin/gradle"
else
  die "Gradle missing. Install Gradle 8.10.2."
fi
apk="$root/apps/android/app/build/outputs/apk/debug/app-debug.apk"
printf 'JODLO: Building local debug APK...\n'
"$gradle_bin" -p "$root/apps/android" -PincludeAndroidApp=true :app:assembleDebug --no-daemon
[[ -s "$apk" ]] || die "Build returned without a nonempty APK: $apk"
printf 'JODLO: APK ready: %s\n' "$apk"
if [[ "$mode" == build ]]; then exit 0; fi

printf 'JODLO: Installing on %s (no uninstall or data removal)...\n' "$chosen"
if ! output="$("$adb_bin" -s "$chosen" install -r "$apk" 2>&1)"; then
  printf '%s\n' "$output" >&2
  die "ADB install failed. If another-signature version exists, manual uninstall removes app data; never done automatically."
fi
printf '%s\n' "$output"
[[ "$output" == *Success* ]] || die "ADB did not confirm a successful install."
printf 'JODLO: Installed on %s\n' "$chosen"
if [[ "$mode" == run ]]; then
  printf 'JODLO: Launching app...\n'
  "$adb_bin" -s "$chosen" shell am start -n 'com.rekixo.jodlo/.MainActivity'
fi
