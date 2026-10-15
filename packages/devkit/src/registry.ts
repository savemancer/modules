import type { GameModule, ModuleManifest } from '@savemancer/sdk';

const manifests = import.meta.glob<ModuleManifest>('../../../modules/*/module.json', { eager: true, import: 'default' });
const loaders = import.meta.glob<GameModule>('../../../modules/*/src/index.ts', { import: 'default' });

export function listManifests(): ModuleManifest[] {
  return Object.values(manifests).sort((a, b) => a.game.localeCompare(b.game));
}

export function loadModule(id: string): Promise<GameModule> {
  const loader = loaders[`../../../modules/${id}/src/index.ts`];
  if (!loader) throw new Error(`module not found: ${id}`);
  return loader();
}
