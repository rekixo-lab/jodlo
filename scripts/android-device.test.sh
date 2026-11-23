#!/usr/bin/env bash
# Offline mock tests: never use a real USB-connected phone.
set -Eeuo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo/scripts" "$tmp/bin" "$tmp/sdk/platforms/android-36" "$tmp/sdk/build-tools/36.0.0" "$tmp/jdk17/bin" "$tmp/jdk21/bin"
cp "$source_dir/android-device.sh" "$tmp/repo/scripts/android-device.sh"
cat > "$tmp/jdk17/bin/javac" <<'MOCK_JAVAC'
#!/usr/bin/env bash
printf 'javac 17.0.16\n'
MOCK_JAVAC
cat > "$tmp/jdk21/bin/javac" <<'MOCK_JAVAC21'
#!/usr/bin/env bash
printf 'javac 21.0.1\n'
MOCK_JAVAC21
cat > "$tmp/jdk17/bin/java" <<'MOCK_JAVA'
#!/usr/bin/env bash
printf 'openjdk version "17.0.16"\n' >&2
MOCK_JAVA
cat > "$tmp/jdk21/bin/java" <<'MOCK_JAVA21'
#!/usr/bin/env bash
printf 'openjdk version "21.0.1"\n' >&2
MOCK_JAVA21
chmod +x "$tmp/jdk17/bin/"* "$tmp/jdk21/bin/"*
ln -s "$tmp/jdk17/bin/javac" "$tmp/bin/javac"
cat > "$tmp/bin/gradle" <<'GRADLE'
#!/usr/bin/env bash
set -Eeuo pipefail
printf 'gradle %s\n' "$*" >> "$MOCK_CALLS"
printf 'java-home %s\n' "${JAVA_HOME:-unset}" >> "$MOCK_CALLS"
[[ "${MOCK_BUILD_FAIL:-0}" != 1 ]] || exit 42
if [[ "${MOCK_NO_APK:-0}" != 1 ]]; then
  out="$MOCK_REPO_ROOT/apps/android/app/build/outputs/apk/debug"
  mkdir -p "$out"
  printf 'mock APK\n' > "$out/app-debug.apk"
fi
GRADLE
cat > "$tmp/bin/adb" <<'ADB'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == devices ]]; then
  printf 'List of devices attached\n'
  printf '%s\n' "${MOCK_DEVICES:-}"
  exit 0
fi
printf 'adb %s\n' "$*" >> "$MOCK_CALLS"
if [[ "$*" == *" install -r "* ]]; then
  if [[ "${MOCK_INSTALL_FAIL:-0}" == 1 || "$*" == *"-s ${MOCK_INSTALL_FAIL_DEVICE:-__NO_DEVICE__} install -r "* ]]; then
    printf 'Failure [INSTALL_FAILED_USER_RESTRICTED]\n'
    exit 9
  fi
  printf 'Success\n'
fi
if [[ "$*" == *" shell am start -n "* ]]; then printf 'Starting: Intent\n'; fi
ADB
chmod +x "$tmp/bin/gradle" "$tmp/bin/adb"
export PATH="$tmp/bin:$PATH"
export ANDROID_HOME="$tmp/sdk" ANDROID_SDK_ROOT="$tmp/sdk"
export MOCK_REPO_ROOT="$tmp/repo" MOCK_CALLS="$tmp/calls"
export JAVA_HOME="$tmp/jdk17"
apk="$tmp/repo/apps/android/app/build/outputs/apk/debug/app-debug.apk"
reset() {
  : > "$MOCK_CALLS"
  rm -f "$apk"
  MOCK_DEVICES=""
  export MOCK_DEVICES
  unset ANDROID_SERIAL MOCK_BUILD_FAIL MOCK_NO_APK MOCK_INSTALL_FAIL MOCK_INSTALL_FAIL_DEVICE JODLO_JDK17_HOME JODLO_JDK_HOME JODLO_GOOGLE_WEB_CLIENT_ID
  rm -f "$tmp/repo/apps/android/app/google-services.json"
  export JAVA_HOME="$tmp/jdk17"
}
ok() {
  if ! bash "$tmp/repo/scripts/android-device.sh" "$@" >"$tmp/result" 2>&1; then
    cat "$tmp/result" >&2
    echo "Unexpected failure: $*" >&2; exit 1
  fi
}
bad() {
  if bash "$tmp/repo/scripts/android-device.sh" "$@" >"$tmp/result" 2>&1; then
    cat "$tmp/result" >&2
    echo "Expected command to refuse: $*" >&2; exit 1
  fi
}
has() {
  grep -Fq -- "$1" "$MOCK_CALLS" || { echo "Expected call not found: $1" >&2; exit 1; }
}
lacks() {
  if grep -Fq -- "$1" "$MOCK_CALLS"; then echo "Unexpected call: $1" >&2; exit 1; fi
}
reset
# An outdated SDK must stop BEFORE Gradle, packaging or ADB installation.
rmdir "$tmp/sdk/platforms/android-36"
bad build
lacks gradle
grep -Fq 'Android SDK platform 36 missing' "$tmp/result"
mkdir -p "$tmp/sdk/platforms/android-36"
rmdir "$tmp/sdk/build-tools/36.0.0"
bad build
lacks gradle
grep -Fq 'Android build-tools 36.0.0 missing' "$tmp/result"
mkdir -p "$tmp/sdk/build-tools/36.0.0"
echo '✓ missing Android 16 SDK/build tools cannot build or install'

reset
MOCK_DEVICES=="$tmp/jdk21"
ok run
has "java-home $tmp/jdk21"
has 'adb -s D1 install -r '
has 'adb -s D1 shell am start -n com.rekixo.jodlo/.MainActivity'
echo '✓ Java 21 alone builds, installs and launches safely'

reset
export JAVA_HOME="$tmp/jdk21"
ok build
has "java-home $tmp/jdk21"
echo '✓ existing JAVA_HOME=JDK21 is selected automatically'

reset
MOCK_DEVICES=$'D1\tdevice'
export JODLO_JDK_HOME="$tmp/no-such-jdk"
bad run
lacks gradle
lacks 'adb -s '
grep -Fq 'No full JDK 17 or 21 found' "$tmp/result"
echo '✓ invalid JDK override refuses build and install'

reset
MOCK_DEVICES=$'D1\tdevice'
export JODLO_JDK17_HOME="$tmp/jdk21"
bad run
lacks gradle
lacks 'adb -s '
echo '✓ legacy JDK17-only override rejects JDK21'

reset
export JAVA_HOME="$tmp/jdk21"
export JODLO_JDK_HOME="$tmp/jdk17"
ok build
has "java-home $tmp/jdk17"
echo '✓ explicit JDK17 override remains supported'
reset
bad install
lacks gradle
echo '✓ no device: no build or install'
reset
MOCK_DEVICES=$'D1\tunauthorized'
bad run
lacks gradle
echo '✓ unauthorized: no build or install'
reset
MOCK_DEVICES=$'D1\toffline'
bad run
lacks gradle
echo '✓ offline: no build or install'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
bad run
lacks gradle
echo '✓ multiple devices: refuse automatic selection'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
ok install --serial D2
has 'gradle -p '
has 'adb -s D2 install -r '
lacks 'adb -s D1 install'
lacks 'shell am start'
echo '✓ explicit serial: build and install only target'
reset
MOCK_DEVICES=$'D1\tdevice'
ok run
has 'adb -s D1 install -r '
has 'adb -s D1 shell am start -n com.rekixo.jodlo/.MainActivity'
echo '✓ one command: build, install, launch'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export ANDROID_SERIAL=D1
ok run
has 'adb -s D1 install -r '
lacks 'adb -s D2 install'
echo '✓ ANDROID_SERIAL selects correct device'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_BUILD_FAIL=1
bad run
lacks 'adb -s '
echo '✓ failed build never installs'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_NO_APK=1
bad install
lacks 'adb -s '
echo '✓ missing APK never installs'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_INSTALL_FAIL=1
bad run
has 'adb -s D1 install -r '
lacks 'shell am start'
echo '✓ install failure never launches/uninstalls'
reset
ok build
has 'gradle -p '
lacks 'adb -s '
echo '✓ build mode works without device'
reset
ok devices
lacks gradle
echo '✓ devices mode never builds'
reset
bad run --serial
lacks gradle
echo '✓ malformed serial never builds'
# Only synthetic/local mock inputs. Never contact providers or a real device.
mkdir -p "$tmp/repo/apps/android/app"
mock_fcm() {
cat > "$tmp/repo/apps/android/app/google-services.json" <<'MOCK_FCM_JSON'
{
  "project_info": {"project_id": "jodlo-operator-test"},
  "client": [{
    "client_info": {"android_client_info": {"package_name": "com.rekixo.jodlo"}},
    "api_key": [{"current_key": "mock_key_for_local_offline_tests"}]
  }]
}
MOCK_FCM_JSON
}
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
bad call-qa --customer D1 --worker D2
lacks gradle
lacks 'adb -s '
echo '✓ two-phone mode refuses missing real OAuth before build/install'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ two-phone mode refuses missing FCM config'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D1
lacks gradle
echo '✓ QA requires two distinct phones'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tunauthorized'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D2
lacks gradle
lacks 'adb -s '
echo '✓ unauthorized Worker phone blocks all installation'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
export MOCK_INSTALL_FAIL_DEVICE=D2
bad call-qa --customer D1 --worker D2
has 'adb -s D1 install -r '
has 'adb -s D2 install -r '
lacks 'shell am start'
echo '✓ second install failure cannot launch either phone'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice\nD3\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
ok call-qa --customer D2 --worker D1
has 'gradle -p '
has '-PjodloEnableAgora=true'
has '-PjodloEnableFcm=true'
has '-PjodloApiOrigin=https://api.jodlo.rekixo.com'
has '-PjodloGoogleWebClientId=1234567890-publicqa.apps.googleusercontent.com'
has 'adb -s D2 install -r '
has 'adb -s D1 install -r '
has 'adb -s D2 shell am start'
has 'adb -s D1 shell am start'
lacks 'adb -s D3 '
[[ "$(grep -c '^gradle ' "$MOCK_CALLS")" == 1 ]]
echo '✓ one explicitly configured QA build goes only to two named authorized phones'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-ci-only.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ synthetic Google OAuth client refused'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
sed -i 's/jodlo-operator-test/jodlo-ci-synthetic-not-real/' "$tmp/repo/apps/android/app/google-services.json"
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ synthetic Firebase config refused'

echo 'JODLO Android device CLI: existing and two-phone mock safety cases passed.'
D1\tdevice'
export JODLO_JDK_HOME="$tmp/jdk21"
ok run
has "java-home $tmp/jdk21"
has 'adb -s D1 install -r '
has 'adb -s D1 shell am start -n com.rekixo.jodlo/.MainActivity'
echo '✓ Java 21 alone builds, installs and launches safely'

reset
export JAVA_HOME="$tmp/jdk21"
ok build
has "java-home $tmp/jdk21"
echo '✓ existing JAVA_HOME=JDK21 is selected automatically'

reset
MOCK_DEVICES=$'D1\tdevice'
export JODLO_JDK_HOME="$tmp/no-such-jdk"
bad run
lacks gradle
lacks 'adb -s '
grep -Fq 'No full JDK 17 or 21 found' "$tmp/result"
echo '✓ invalid JDK override refuses build and install'

reset
MOCK_DEVICES=$'D1\tdevice'
export JODLO_JDK17_HOME="$tmp/jdk21"
bad run
lacks gradle
lacks 'adb -s '
echo '✓ legacy JDK17-only override rejects JDK21'

reset
export JAVA_HOME="$tmp/jdk21"
export JODLO_JDK_HOME="$tmp/jdk17"
ok build
has "java-home $tmp/jdk17"
echo '✓ explicit JDK17 override remains supported'
reset
bad install
lacks gradle
echo '✓ no device: no build or install'
reset
MOCK_DEVICES=$'D1\tunauthorized'
bad run
lacks gradle
echo '✓ unauthorized: no build or install'
reset
MOCK_DEVICES=$'D1\toffline'
bad run
lacks gradle
echo '✓ offline: no build or install'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
bad run
lacks gradle
echo '✓ multiple devices: refuse automatic selection'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
ok install --serial D2
has 'gradle -p '
has 'adb -s D2 install -r '
lacks 'adb -s D1 install'
lacks 'shell am start'
echo '✓ explicit serial: build and install only target'
reset
MOCK_DEVICES=$'D1\tdevice'
ok run
has 'adb -s D1 install -r '
has 'adb -s D1 shell am start -n com.rekixo.jodlo/.MainActivity'
echo '✓ one command: build, install, launch'
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export ANDROID_SERIAL=D1
ok run
has 'adb -s D1 install -r '
lacks 'adb -s D2 install'
echo '✓ ANDROID_SERIAL selects correct device'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_BUILD_FAIL=1
bad run
lacks 'adb -s '
echo '✓ failed build never installs'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_NO_APK=1
bad install
lacks 'adb -s '
echo '✓ missing APK never installs'
reset
MOCK_DEVICES=$'D1\tdevice'
export MOCK_INSTALL_FAIL=1
bad run
has 'adb -s D1 install -r '
lacks 'shell am start'
echo '✓ install failure never launches/uninstalls'
reset
ok build
has 'gradle -p '
lacks 'adb -s '
echo '✓ build mode works without device'
reset
ok devices
lacks gradle
echo '✓ devices mode never builds'
reset
bad run --serial
lacks gradle
echo '✓ malformed serial never builds'
# Only synthetic/local mock inputs. Never contact providers or a real device.
mkdir -p "$tmp/repo/apps/android/app"
mock_fcm() {
cat > "$tmp/repo/apps/android/app/google-services.json" <<'MOCK_FCM_JSON'
{
  "project_info": {"project_id": "jodlo-operator-test"},
  "client": [{
    "client_info": {"android_client_info": {"package_name": "com.rekixo.jodlo"}},
    "api_key": [{"current_key": "mock_key_for_local_offline_tests"}]
  }]
}
MOCK_FCM_JSON
}
reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
bad call-qa --customer D1 --worker D2
lacks gradle
lacks 'adb -s '
echo '✓ two-phone mode refuses missing real OAuth before build/install'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ two-phone mode refuses missing FCM config'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D1
lacks gradle
echo '✓ QA requires two distinct phones'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tunauthorized'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D2
lacks gradle
lacks 'adb -s '
echo '✓ unauthorized Worker phone blocks all installation'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
export MOCK_INSTALL_FAIL_DEVICE=D2
bad call-qa --customer D1 --worker D2
has 'adb -s D1 install -r '
has 'adb -s D2 install -r '
lacks 'shell am start'
echo '✓ second install failure cannot launch either phone'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice\nD3\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
ok call-qa --customer D2 --worker D1
has 'gradle -p '
has '-PjodloEnableAgora=true'
has '-PjodloEnableFcm=true'
has '-PjodloApiOrigin=https://api.jodlo.rekixo.com'
has '-PjodloGoogleWebClientId=1234567890-publicqa.apps.googleusercontent.com'
has 'adb -s D2 install -r '
has 'adb -s D1 install -r '
has 'adb -s D2 shell am start'
has 'adb -s D1 shell am start'
lacks 'adb -s D3 '
[[ "$(grep -c '^gradle ' "$MOCK_CALLS")" == 1 ]]
echo '✓ one explicitly configured QA build goes only to two named authorized phones'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-ci-only.apps.googleusercontent.com'
mock_fcm
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ synthetic Google OAuth client refused'

reset
MOCK_DEVICES=$'D1\tdevice\nD2\tdevice'
export JODLO_GOOGLE_WEB_CLIENT_ID='1234567890-publicqa.apps.googleusercontent.com'
mock_fcm
sed -i 's/jodlo-operator-test/jodlo-ci-synthetic-not-real/' "$tmp/repo/apps/android/app/google-services.json"
bad call-qa --customer D1 --worker D2
lacks gradle
echo '✓ synthetic Firebase config refused'

echo 'JODLO Android device CLI: existing and two-phone mock safety cases passed.'
