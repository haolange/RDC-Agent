#!/usr/bin/env node
/**
 * Release config gate.
 *
 * Asserts electron-builder.json has appId/files/platforms, no always-on secrets,
 * and that SBOM/checksum script paths exist.
 *
 * Signing / notarize (env-gated, never commit secrets):
 *   Windows: CSC_LINK, CSC_KEY_PASSWORD (or WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD)
 *   macOS signing: CSC_LINK, CSC_KEY_PASSWORD
 *   macOS notarize: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 *     (or APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER)
 *   CI packs with CSC_IDENTITY_AUTO_DISCOVERY=false unless a release job sets the above.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`[release-config] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const builderPath = 'electron-builder.json';
if (!existsSync(path.join(repoRoot, builderPath))) {
  fail('electron-builder.json is missing.');
  process.exit(1);
}

const builder = JSON.parse(read(builderPath));
const builderText = read(builderPath);

if (typeof builder.appId !== 'string' || !builder.appId.trim()) {
  fail('electron-builder.json must set a non-empty appId.');
}
if (!Array.isArray(builder.files) || builder.files.length === 0) {
  fail('electron-builder.json must declare a files whitelist.');
} else if (!builder.files.includes('out/**/*')) {
  fail('electron-builder.json files must include out/**/*.');
}

for (const platform of ['win', 'mac', 'linux']) {
  if (!builder[platform] || typeof builder[platform] !== 'object') {
    fail(`electron-builder.json must declare platform config: ${platform}`);
  }
}

const secretPatterns = [
  /BEGIN (?:RSA |EC )?PRIVATE KEY/,
  /"certificatePassword"\s*:\s*"[^"]+"/,
  /"cscKeyPassword"\s*:\s*"[^"]+"/i,
  /"APPLE_APP_SPECIFIC_PASSWORD"\s*:\s*"[^"]+"/,
  /sk-[a-zA-Z0-9]{10,}/,
  /-----BEGIN CERTIFICATE-----/,
];
for (const pattern of secretPatterns) {
  if (pattern.test(builderText)) {
    fail(`electron-builder.json must not embed always-on secrets (${pattern}).`);
  }
}

for (const forbiddenKey of [
  'certificatePassword',
  'cscKeyPassword',
  'publisherName',
]) {
  if (Object.prototype.hasOwnProperty.call(builder.win ?? {}, forbiddenKey)
    && typeof builder.win[forbiddenKey] === 'string'
    && builder.win[forbiddenKey].length > 0
    && !String(builder.win[forbiddenKey]).includes('${env.')) {
    fail(`win.${forbiddenKey} must not be a committed plaintext secret.`);
  }
}

if (builder.mac?.notarize === true) {
  // Allowed only as an env-gated release toggle; credentials must come from APPLE_* env.
  console.log('[release-config] mac.notarize=true relies on APPLE_* env at release time.');
} else if (builder.mac && builder.mac.notarize !== false && builder.mac.notarize != null) {
  const teamId = builder.mac.notarize?.teamId;
  if (typeof teamId === 'string' && teamId.length > 0 && !teamId.includes('${env.')) {
    fail('mac.notarize.teamId must be env-gated (${env.APPLE_TEAM_ID}) or omitted.');
  }
}

const requiredScripts = [
  'scripts/release/generate-checksums.mjs',
  'scripts/release/generate-sbom.mjs',
  'scripts/check-release-config.mjs',
];
for (const relativePath of requiredScripts) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    fail(`Required release script missing: ${relativePath}`);
  }
}

const packageJson = JSON.parse(read('package.json'));
for (const [name, command] of [
  ['check:release-config', 'node scripts/check-release-config.mjs'],
  ['release:checksums', 'node scripts/release/generate-checksums.mjs'],
  ['release:sbom', 'node scripts/release/generate-sbom.mjs'],
]) {
  if (packageJson.scripts?.[name] !== command) {
    fail(`package.json scripts.${name} must be \`${command}\`.`);
  }
}

if (!String(packageJson.scripts?.['check:gates'] ?? '').includes('check-release-config.mjs')) {
  fail('check:gates must wire check-release-config.mjs.');
}

if (!process.exitCode) {
  console.log('[release-config] OK');
}
