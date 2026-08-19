// Refreshes the committed snapshot at data/shared_data.db from the original
// football-data-collector database on the local machine. The app reads the
// committed copy (see lib/shared-db.ts) so it works when deployed — this
// script is how that snapshot gets updated when the source data changes.
//
// Usage: npm run sync:shared-db
// Then: git add data/shared_data.db && git commit && git push (and redeploy).

import { copyFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH =
  "C:\\Users\\lperr\\OneDrive\\Documents\\football-data-collector\\shared_data.db";
const DEST_PATH = path.join(process.cwd(), "data", "shared_data.db");

try {
  copyFileSync(SOURCE_PATH, DEST_PATH);
  console.log(`Synced ${SOURCE_PATH} -> ${DEST_PATH}`);
} catch (error) {
  console.error(`Failed to sync shared DB: ${error.message}`);
  process.exit(1);
}
