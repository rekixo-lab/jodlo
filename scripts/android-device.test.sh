#!/usr/bin/env bash
# Offline mock tests: never use a real USB-connected phone.
set -Eeuo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo/scripts" "$tmp/bin" "$tmp/sdk/platforms/android-35" "$tmp/sdk/build-tools/35.0.0" "$tmp/jdk17/bin" "$tmp/jdk21/bin"
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
  if [[ "${MOCK_INSTALL_FAIL:-0}" == 1 ]]; then
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
  unset ANDROID_SERIAL MOCK_BUILD_FAIL MOCK_NO_APK MOCK_INSTALL_FAIL JODLO_JDK17_HOME
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
MOCK_DEVICES=
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
echo 'JODLO Android connected-device CLI: all offline safety cases passed.'
D1\tdevice'
export JODLO_JDK17_HOME="$tmp/jdk21"
bad run
lacks gradle
lacks 'adb -s '
grep -Fq 'Java 17 JDK not found' "$tmp/result"
echo '✓ JDK 21 or JRE fails fast before Gradle and device installation'
reset
MOCK_DEVICES=
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
echo 'JODLO Android connected-device CLI: all offline safety cases passed.'
D1\tdevice'
export JAVA_HOME="$tmp/jdk21"
ok build
has "java-home $tmp/jdk17"
echo '✓ wrong JAVA_HOME recovers to full JDK 17 on PATH'
reset
MOCK_DEVICES=
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
echo 'JODLO Android connected-device CLI: all offline safety cases passed.'
D1\tdevice'
export JODLO_JDK17_HOME="$tmp/jdk17"
ok build
has "java-home $tmp/jdk17"
echo '✓ explicit valid JDK 17 override works'
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
echo 'JODLO Android connected-device CLI: all offline safety cases passed.'
