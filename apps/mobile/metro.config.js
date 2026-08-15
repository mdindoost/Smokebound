// Metro needs to be told two things about this monorepo.
//
// 1. Source lives in packages/shared and dependencies may be hoisted to the
//    workspace root.
// 2. `@smoke/shared` and `@smoke/engine` are Node ESM packages: their internal
//    imports carry explicit `.js` extensions, which is what Node requires and
//    what their own build emits. Metro resolves TypeScript sources and has no
//    idea that `./grid.js` means `./grid.ts`. Rather than make the shared
//    packages Node-incorrect to suit the bundler, resolution falls back here.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hierarchical lookup stays on: npm workspaces hoist react-native and friends to
// the workspace root, and Metro's own bootstrap resolves them from there.

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    // `./grid.js` → `./grid`, which Metro then resolves to grid.ts.
    if (moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
