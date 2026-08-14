/**
 * Re-export of the shared test database harness, which lives in `src/testing`
 * so the mobile app's end-to-end test can drive the same database and the same
 * migrations that the engine's tests do.
 */

export {
  createTestDatabase,
  createUser,
  createFlock,
} from '../src/testing/database.js';
export type { TestDatabase, SupabaseRole } from '../src/testing/database.js';
