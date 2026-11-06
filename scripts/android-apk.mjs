/**
 * Builds a debug APK with Android Studio's bundled JBR when JAVA_HOME is unset.
 * Usage: node scripts/android-apk.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');

const studioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
const localSdk = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');

if (!process.env.JAVA_HOME && fs.existsSync(path.join(studioJbr, 'bin', 'java.exe'))) {
  process.env.JAVA_HOME = studioJbr;
}
if (!process.env.ANDROID_HOME && fs.existsSync(localSdk)) {
  process.env.ANDROID_HOME = localSdk;
  process.env.ANDROID_SDK_ROOT = localSdk;
}
if (process.env.JAVA_HOME) {
  process.env.Path = `${path.join(process.env.JAVA_HOME, 'bin')};${process.env.Path || ''}`;
}

if (!fs.existsSync(androidDir)) {
  console.error('android/ is missing. Run: npx cap add android');
  process.exit(1);
}

// Node refuses to spawn .bat files directly, so Windows goes through cmd.exe.
const [cmd, args] =
  process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', 'assembleDebug']]
    : [path.join(androidDir, 'gradlew'), ['assembleDebug']];
const result = spawnSync(cmd, args, { cwd: androidDir, stdio: 'inherit', env: process.env });

if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log(`\nAPK ready: ${apk}`);
if (fs.existsSync(apk)) {
  const mb = (fs.statSync(apk).size / (1024 * 1024)).toFixed(2);
  console.log(`Size: ${mb} MB`);
}
