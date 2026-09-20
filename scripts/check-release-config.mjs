#!/usr/bin/env node
/**
 * Release config gate.
 *
 * Asserts electron-builder.json has appId/files/platforms, no always-on secrets,
 * and that SBOM/checksum script paths exist.
 *
 * Signing (env-gated, never commit secrets):
 *   Windows release channel: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD
 *     (CSC_LINK / CSC_KEY_PASSWORD also accepted).
 *   Local `pnpm run pack` stays unsigned.
 *   Required for release or tag builds, except explicit version-matched prereleases.
 * Product is Windows-only; mac/linux electron-builder targets are forbidden.
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

for (const platform of ['win']) {
  if (!builder[platform] || typeof builder[platform] !== 'object') {
    fail(`electron-builder.json must declare platform config: ${platform}`);
  }
}
if (builder.mac || builder.linux) {
  fail('electron-builder.json must not declare mac/linux targets; product is Windows-only.');
}

const secretPatterns = [
  /BEGIN (?:RSA |EC )?PRIVATE KEY/,
  /"certificatePassword"\s*:\s*"[^"]+"/,
  /"cscKeyPassword"\s*:\s*"[^"]+"/i,
  /"APPLE_APP_SPECIFIC_PASSWORD"\s*:\s*"[^"]+"/,
  /sk-[a-zA-Z0-9]{10,}/,
  /-----BEGIN CERTIFICATE-----/,
];

const windowsTargets = (builder.win?.target ?? []).map(target => typeof target === 'string' ? target : target.target);
if (!windowsTargets.includes('zip') || !windowsTargets.includes('nsis')) fail('Windows distribution must include zip and nsis.');
if (builder.win?.artifactName?.includes('-setup') || !builder.nsis?.artifactName?.includes('-setup')) {
  fail('Only the NSIS installer artifact name may contain -setup.');
}
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
  fail('mac.notarize is forbidden; product is Windows-only.');
}

const packageJson = JSON.parse(read('package.json'));
const channel = process.env.RDC_AGENT_RELEASE_CHANNEL;
const tagRef = process.env.GITHUB_REF?.startsWith('refs/tags/') ? process.env.GITHUB_REF : undefined;
const prereleaseVersion = /^\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(packageJson.version);
const unsignedPrerelease = channel === 'prerelease' && prereleaseVersion
  && (!tagRef || tagRef === `refs/tags/v${packageJson.version}`);
if (channel === 'prerelease' && !unsignedPrerelease) {
  fail('Unsigned prerelease requires a prerelease package version and an exactly matching tag (when set).');
}
const requireWinSign = channel === 'release' || Boolean(tagRef && !unsignedPrerelease);
if (requireWinSign) {
  const link = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
  const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;
  if (!link) {
    fail('Release channel requires WIN_CSC_LINK (or CSC_LINK).');
  }
  if (!password) {
    fail('Release channel requires WIN_CSC_KEY_PASSWORD (or CSC_KEY_PASSWORD).');
  }
} else {
  console.log(unsignedPrerelease
    ? '[release-config] Explicit prerelease may stay unsigned; publish as a disclosed GitHub prerelease only.'
    : '[release-config] local/CI pack may stay unsigned (RDC_AGENT_RELEASE_CHANNEL is not release).');
}

const requiredScripts = [
  'scripts/release/generate-checksums.mjs',
  'scripts/release/generate-sbom.mjs',
  'scripts/release/verify-package.mjs',
  'scripts/check-release-config.mjs',
];
for (const relativePath of requiredScripts) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    fail(`Required release script missing: ${relativePath}`);
  }
}

for (const [name, command] of [
  ['check:release-config', 'node scripts/check-release-config.mjs'],
  ['release:checksums', 'node scripts/release/generate-checksums.mjs'],
  ['release:sbom', 'node scripts/release/generate-sbom.mjs'],
  ['check:release-package', 'node scripts/release/verify-package.mjs'],
]) {
  if (packageJson.scripts?.[name] !== command) {
    fail(`package.json scripts.${name} must be \`${command}\`.`);
  }
}

if (!String(packageJson.scripts?.['check:gates'] ?? '').includes('check-release-config.mjs')) {
  fail('check:gates must wire check-release-config.mjs.');
}
if (!String(packageJson.scripts?.['check:gates'] ?? '').includes('check-acceptance-ledger.mjs')) {
  fail('check:gates must wire check-acceptance-ledger.mjs.');
}
if (!String(packageJson.scripts?.['check:gates'] ?? '').includes('check-legacy-residue.mjs')) {
  fail('check:gates must wire check-legacy-residue.mjs.');
}
if (packageJson.scripts?.['check:acceptance-ledger'] !== 'node scripts/check-acceptance-ledger.mjs') {
  fail('package.json scripts.check:acceptance-ledger must be `node scripts/check-acceptance-ledger.mjs`.');
}

if (!process.exitCode) {
  console.log('[release-config] OK');
}
