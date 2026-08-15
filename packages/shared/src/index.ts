/**
 * @smoke/shared — types, cell math, and the mechanics config contract.
 *
 * Nothing in here does I/O. The engine and the mobile app both depend on it;
 * neither may hardcode a gameplay number outside `mechanics/defaults.ts`
 * (ARCHITECTURE §10).
 */

export * from './geo/types.js';
export * from './geo/grid.js';
export * from './geo/greatCircle.js';
export * from './geo/land.js';
export * from './geo/towers.js';
export * from './geo/wind.js';
export * from './mechanics/types.js';
export * from './mechanics/defaults.js';
export * from './mechanics/config.js';
export * from './model/index.js';
