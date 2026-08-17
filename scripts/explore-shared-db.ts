import { listTables, getSampleRows, query } from "../lib/shared-db";

const tables = listTables();

console.log(`Found ${tables.length} tables:\n`);

for (const table of tables) {
  console.log(`=== ${table.name} (${table.rowCount} rows) ===`);
  console.log("Columns:", table.columns.map((c) => `${c.name} (${c.type})`).join(", "));
  console.log("Sample rows:");
  console.log(JSON.stringify(getSampleRows(table.name, 3), null, 2));
  console.log();
}

const leagues = query<{ league_id: number; league_name: string; count: number }>(
  "SELECT league_id, league_name, COUNT(*) AS count FROM matches GROUP BY league_id, league_name ORDER BY league_name",
);
console.log("Leagues:", JSON.stringify(leagues, null, 2));

const seasons = query<{ season: string; count: number }>(
  "SELECT season, COUNT(*) AS count FROM matches GROUP BY season ORDER BY season",
);
console.log("Seasons:", JSON.stringify(seasons, null, 2));
