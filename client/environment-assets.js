import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Committed manifest costs, checked by test/environment.test.js. This library
// owns the first kit's textures; subsequent geometry kits borrow them.
export const ENVIRONMENT_ASSET_REGISTRY = Object.freeze({
  '/assets/old-watch/kit.glb': Object.freeze({ bytes: 7584620, triangles: 59078, decodedTextureBytes: 9786696 }),
  '/assets/windward-farm/kit.glb': Object.freeze({ bytes: 2459180, triangles: 26740, decodedTextureBytes: 0 }),
  '/assets/tideglass-market/kit.glb': Object.freeze({ bytes: 2019240, triangles: 22258, decodedTextureBytes: 0 }),
  '/assets/saltwind-harbor/kit.glb': Object.freeze({ bytes: 3263132, triangles: 35510, decodedTextureBytes: 0 }),
  '/assets/driftwood-yard/kit.glb': Object.freeze({ bytes: 2432348, triangles: 26569, decodedTextureBytes: 0 }),
  '/assets/palmheart-camp/kit.glb': Object.freeze({ bytes: 2792952, triangles: 28831, decodedTextureBytes: 0 }),
  '/assets/cinderworks/kit.glb': Object.freeze({ bytes: 2768008, triangles: 30284, decodedTextureBytes: 0 }),
  '/assets/moonwatch/kit.glb': Object.freeze({ bytes: 2444180, triangles: 26784, decodedTextureBytes: 0 }),
  '/assets/island/kit.glb': Object.freeze({ bytes: 1484528, triangles: 16912, decodedTextureBytes: 0 }),
});

const released = new WeakSet(), owners = new WeakMap();

function resources(roots) {
  const result = new Set();
  for (const root of Array.isArray(roots) ? roots : [roots]) root?.traverse(object => {
    if (object.isInstancedMesh) result.add(object);
    if (object.geometry) result.add(object.geometry);
    for (const material of !object.material ? [] : Array.isArray(object.material) ? object.material : [object.material]) {
      result.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        result.add(value);
        for (const image of Array.isArray(value.source?.data) ? value.source.data : [value.source?.data]) if (image?.close) result.add(image);
      }
    }
  });
  return result;
}

function releaseResource(resource) {
  if (released.has(resource) || owners.get(resource)) return;
  released.add(resource);
  if (resource.dispose) resource.dispose();
  else resource.close?.();
}

// A cloned material still borrows its maps and ImageBitmaps. Excluding all
// resources reachable from source roots keeps those alive until the last lease.
export function disposeOwnedResources(roots, borrowedRoots = []) {
  const borrowed = resources(borrowedRoots);
  for (const resource of resources(roots)) if (!borrowed.has(resource)) releaseResource(resource);
}

function assetRoots(asset) { return [...new Set([asset?.scene, ...(asset?.scenes ?? [])].filter(Boolean))]; }

export function textureMemoryBytes(texture) {
  const image = texture.source?.data;
  let width = image?.width ?? 0, height = image?.height ?? 0, bytes = 0;
  if (!width || !height) return 0;
  do {
    bytes += width * height * 4;
    if (!texture.generateMipmaps || (width === 1 && height === 1)) break;
    width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
  } while (true);
  return bytes;
}

export function createEnvironmentAssets({ load = url => new GLTFLoader().loadAsync(url), registry = ENVIRONMENT_ASSET_REGISTRY } = {}) {
  const entries = new Map(), downloaded = new Set();
  let disposed = false;
  function retire(entry) {
    if (entry.references || entry.status === 'loading' || entry.retired) return;
    entry.retired = true;
    if (entries.get(entry.url) === entry) entries.delete(entry.url);
    for (const resource of entry.resources) {
      const count = (owners.get(resource) ?? 1) - 1;
      if (count) owners.set(resource, count); else owners.delete(resource);
      releaseResource(resource);
    }
  }
  function acquire(url) {
    if (disposed) throw new Error('Environment asset cache is disposed');
    if (!/^\/assets\/[a-z0-9-]+\/kit\.glb$/.test(url)) throw new Error('Environment assets must use a local kit URL');
    let entry = entries.get(url);
    if (!entry) {
      entry = { url, references: 0, status: 'loading', resources: new Set(), retired: false };
      entries.set(url, entry);
      entry.ready = Promise.resolve().then(() => load(url)).then(asset => {
        entry.resources = resources(assetRoots(asset));
        for (const resource of entry.resources) owners.set(resource, (owners.get(resource) ?? 0) + 1);
        if (!asset?.scene?.traverse) throw new Error('Environment kit has no scene: ' + url);
        downloaded.add(url); entry.status = 'loaded'; retire(entry);
        return asset;
      }).catch(error => {
        entry.status = 'failed'; retire(entry); throw error;
      });
    }
    entry.references++;
    let active = true;
    return { ready: entry.ready, release() {
      if (!active) return;
      active = false; entry.references--; retire(entry);
    } };
  }
  return { acquire, getStats() {
    const live = [...entries.values()], loaded = live.filter(entry => entry.status === 'loaded');
    const textures = new Set(loaded.flatMap(entry => [...entry.resources].filter(resource => resource.isTexture)));
    const images = new Map();
    for (const texture of textures) {
      const source = texture.source?.data ?? texture.source ?? texture;
      images.set(source, Math.max(images.get(source) ?? 0, textureMemoryBytes(texture)));
    }
    return {
      disposed, loadedURLs: loaded.map(entry => entry.url), loading: live.filter(entry => entry.status === 'loading').length,
      leases: live.reduce((sum, entry) => sum + entry.references, 0),
      downloadedBytes: [...downloaded].reduce((sum, url) => sum + (registry[url]?.bytes ?? 0), 0),
      loadedSourceTriangles: loaded.reduce((sum, entry) => sum + (registry[entry.url]?.triangles ?? 0), 0),
      decodedTextureBytes: [...images.values()].reduce((sum, bytes) => sum + bytes, 0),
      textureCount: textures.size, decodedImages: images.size,
      // All current kits stay resident for the ship/gliding silhouette. Future
      // regions can release leases without touching this accounting contract.
      registeredBytes: Object.values(registry).reduce((sum, entry) => sum + entry.bytes, 0),
    };
  }, dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) retire(entry);
  } };
}
