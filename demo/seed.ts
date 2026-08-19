/**
 * Runnable demo helper: prints the seeded floor as JSON.
 *
 * The seed itself lives in `src/seed.ts` (it is a runtime dependency of the
 * server); this script just renders it for inspection. Run with `npm run seed`.
 */

import { seedScene } from "../src/seed.js";

process.stdout.write(`${JSON.stringify(seedScene(), null, 2)}\n`);
