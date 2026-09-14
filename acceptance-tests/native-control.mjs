import {apiVersion} from 'obsidian';
import {installControl} from './control.mjs';
import Core from './observer-core.cjs';
import Reader from './native-reader.cjs';
import Versions from './native-versions.cjs';

// Bundled separately as reviewed action/read code. Installs no observer plugin or registrations.
export function install(config) {
  const ids = new Core.Identities();
  return installControl(config, {
    elementId: node => ids.id(node, 'element'),
    proof: (leaf, owner, leafId) => Reader.ownerProof(leaf, owner, ids, leafId),
    capture: (leaf, guard, request, leafId) => Reader.readCurrent({leaf, leafId, request, mode: config.mode, guard, ids,
      getPlugin: () => window.app.plugins.getPlugin('numerals'), versions: Versions.versions(window, apiVersion), faults: []}),
  });
}
