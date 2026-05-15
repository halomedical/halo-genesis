import fs from 'fs';
import path from 'path';
import type { ExtensionRegistryEntry } from '../../shared/featureFlags';

const REGISTRY_PATH = path.resolve(process.cwd(), 'registry', 'extensions.json');

export function loadExtensionRegistry(): ExtensionRegistryEntry[] {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is ExtensionRegistryEntry =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as ExtensionRegistryEntry).id === 'string'
      )
      .map((entry) => ({
        id: entry.id,
        required_config_keys: Array.isArray(entry.required_config_keys)
          ? entry.required_config_keys.filter((k): k is string => typeof k === 'string')
          : [],
      }));
  } catch (error) {
    console.error('Failed to load extension registry:', error);
    return [];
  }
}
