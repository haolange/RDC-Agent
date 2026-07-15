import fs from 'node:fs';
import path from 'node:path';
import type { ProviderCatalogCompileInput } from './compiler';

function readJsonDirectory(directory: string): unknown[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8')) as unknown);
}

export function loadProviderCatalogManifestInput(manifestRoot: string): ProviderCatalogCompileInput {
  return {
    identities: readJsonDirectory(path.join(manifestRoot, 'identities')),
    profiles: readJsonDirectory(path.join(manifestRoot, 'profiles')),
    surfaces: readJsonDirectory(path.join(manifestRoot, 'surfaces')),
  };
}

export function listProviderCatalogManifestFiles(manifestRoot: string): string[] {
  return ['identities', 'profiles', 'surfaces'].flatMap((directory) => (
    fs.readdirSync(path.join(manifestRoot, directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(manifestRoot, directory, entry.name))
  ));
}
