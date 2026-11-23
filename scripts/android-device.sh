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
npm run android:call-qa -- --customer CUSTOMER_SERIAL --worker WORKER_SERIAL
# Two-phone mode needs real JODLO Google Web OAuth and ignored google-services.json.
Alternatively set ANDROID_SERIAL=DEVICE_SERIAL for normal one-phone modes.
USAGE
}
mode="${1:-run}"
if (( $# > 0 )); then shift; fi
case "$mode" in devices|build|install|run|call-qa) ;; help|--help|-h) usage; exit 0 ;; *) usage >&2; die "Unknown mode: $mode";; esac
serial="${ANDROID_SERIAL:-}"
customer_serial=""
worker_serial=""
while (( $# > 0 )); do
  case "$1" in
    --serial|-s)
      (( $# >= 2 )) || die "Missing device serial"
      serial="$2"
      [[ -n "$serial" && "$serial" != -* && "$serial" != *$'\n'* ]] || die "Invalid device serial"
      shift 2
      ;;
    --customer|--worker)
      (( $# >= 2 )) || die "Missing phone serial after $1"
      [[ "$2" =~ ^[A-Za-z0-9._:-]+$ ]] || die "Invalid phone serial"
      if [[ "$1" == --customer ]]; then
        [[ -z "$customer_serial" ]] || die "Customer serial set twice"
        customer_serial="$2"
      else
        [[ -z "$worker_serial" ]] || die "Worker serial set twice"
        worker_serial="$2"
      fi
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
if [[ "$mode" == call-qa ]]; then
  [[ -z "$serial" ]] || die "call-qa needs --customer and --worker, not ANDROID_SERIAL/--serial"
  [[ -n "$customer_serial" && -n "$worker_serial" ]] ||
    die "Specify BOTH --customer CUSTOMER_SERIAL and --worker WORKER_SERIAL"
  [[ "$customer_serial" != "$worker_serial" ]] ||
    die "Customer and Worker must be DIFFERENT devices"
else
  [[ -z "$customer_serial" && -z "$worker_serial" ]] ||
    die "--customer/--worker can only be used in call-qa mode"
fi

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
chosen_devices=()
if [[ "$mode" == install || "$mode" == run || "$mode" == call-qa ]]; then
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
  if [[ "$mode" == call-qa ]]; then
    for wanted in "$customer_serial" "$worker_serial"; do
      found=0
      for id in "${ready[@]}"; do
        if [[ "$id" == "$wanted" ]]; then found=1; break; fi
      done
      (( found == 1 )) ||
        die "QA phone '$wanted' not ready/authorized. Check adb devices and USB approval."
      chosen_devices+=("$wanted")
    done
  elif [[ -n "$serial" ]]; then
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
  if [[ "$mode" != call-qa ]]; then chosen_devices=("$chosen"); fi
  printf 'JODLO: Selected device(s): %s\n' "${chosen_devices[*]}"
fi

[[ -d "$sdk/platforms/android-36" ]] || die "Android SDK platform 36 missing. Install sdkmanager 'platforms;android-36'."
[[ -d "$sdk/build-tools/36.0.0" ]] || die "Android build-tools 36.0.0 missing. Install sdkmanager 'build-tools;36.0.0'."
# Android Gradle Plugin 8.10.1 requires Gradle 8.11.1; Java 17/21 are supported.
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
elif [[ -x "$HOME/.local/opt/gradle-8.11.1/bin/gradle" ]]; then
  gradle_bin="$HOME/.local/opt/gradle-8.11.1/bin/gradle"
else
  die "Gradle missing. Install Gradle 8.11.1."
fi
# Two-phone QA is opt-in; ordinary debug APK has no Google/Agora/FCM config.
gradle_qa_args=()
if [[ "$mode" == call-qa ]]; then
  web_id="${JODLO_GOOGLE_WEB_CLIENT_ID:-}"
  web_id_regex='^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$'
  [[ "$web_id" =~ $web_id_regex && "$web_id" != *ci-only* && "$web_id" != *synthetic* ]] ||
    die "Set real JODLO_GOOGLE_WEB_CLIENT_ID (public WEB OAuth client, no CI fixture)"
  config="$root/apps/android/app/google-services.json"
  [[ -f "$config" && ! -L "$config" ]] ||
    die "Real non-symlink JODLO google-services.json required for FCM QA"
  command -v node >/dev/null 2>&1 || die "Node.js required for local FCM project validation"
  # File shape check only, not a proof of Google ownership or FCM delivery.
  if ! node - "$config" <<'JODLO_FCM_PREFLIGHT'
const fs = require("node:fs");
let data;
try { data = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); }
catch { process.exit(1); }
const project = data?.project_info?.project_id;
const clients = data?.client ?? [];
const valid = typeof project === "string" && project.length > 2 &&
  !/synthetic|example|ci-only|not-real/i.test(project) &&
  Array.isArray(clients) && clients.some(c =>
    c?.client_info?.android_client_info?.package_name === "com.rekixo.jodlo" &&
    (c?.api_key ?? []).some(k => typeof k?.current_key === "string" &&
      k.current_key.length > 15 &&
      !/synthetic|example|ci-only|not-real/i.test(k.current_key)));
if (!valid) process.exit(1);
JODLO_FCM_PREFLIGHT
  then
    die "FCM config lacks JODLO Android app/project/key or contains CI example values"
  fi
  gradle_qa_args=(
    -PjodloApiOrigin=https://api.jodlo.rekixo.com
    "-PjodloGoogleWebClientId=$web_id"
    -PjodloEnableAgora=true
    -PjodloEnableFcm=true
  )
  printf 'JODLO: Two-phone QA build with API, Google, Agora and FCM enabled.\n'
  printf 'JODLO: No call, payment, email or cloud deployment initiated.\n'
fi

apk="$root/apps/android/app/build/outputs/apk/debug/app-debug.apk"
printf 'JODLO: Building local debug APK...\n'
"$gradle_bin" -p "$root/apps/android" -PincludeAndroidApp=true "${gradle_qa_args[@]}" :app:assembleDebug --no-daemon
[[ -s "$apk" ]] || die "Build returned without a nonempty APK: $apk"
printf 'JODLO: APK ready: %s\n' "$apk"
if [[ "$mode" == build ]]; then exit 0; fi

for selected_device in "${chosen_devices[@]}"; do
  printf 'JODLO: Installing on %s (no uninstall or data removal)...\n' "$selected_device"
  if ! output="$("$adb_bin" -s "$selected_device" install -r "$apk" 2>&1)"; then
    printf '%s\n' "$output" >&2
    die "ADB install failed. No uninstall, auto retry or data removal."
  fi
  printf '%s\n' "$output"
  [[ "$output" == *Success* ]] || die "ADB did not confirm a successful install."
  printf 'JODLO: Installed on %s\n' "$selected_device"
done
if [[ "$mode" == run || "$mode" == call-qa ]]; then
  for selected_device in "${chosen_devices[@]}"; do
    printf 'JODLO: Launching on %s...\n' "$selected_device"
    "$adb_bin" -s "$selected_device" shell am start -n 'com.rekixo.jodlo/.MainActivity'
  done
fi
if [[ "$mode" == call-qa ]]; then
  printf 'JODLO: Both apps opened. Sign in separately and manually authorize any call.\n'
  printf 'JODLO: A successful build does NOT prove live call, FCM or credit readiness.\n'
fi
