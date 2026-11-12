/**
 * Builds a signed release AAB for Play Console (internal testing).
 * Usage: node scripts/android-aab.mjs
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

const props = path.join(androidDir, 'keystore.properties');
if (!fs.existsSync(props)) {
  console.error('Missing android/keystore.properties — create the upload keystore first.');
  process.exit(1);
}

const [cmd, args] =
  process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', 'bundleRelease']]
    : [path.join(androidDir, 'gradlew'), ['bundleRelease']];
const result = spawnSync(cmd, args, { cwd: androidDir, stdio: 'inherit', env: process.env });

if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

const aab = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
console.log(`\nAAB ready: ${aab}`);
console.log('Release build — live AdMob units, Play Billing enabled.');
if (fs.existsSync(aab)) {
  const mb = (fs.statSync(aab).size / (1024 * 1024)).toFixed(2);
  console.log(`Size: ${mb} MB`);
}
