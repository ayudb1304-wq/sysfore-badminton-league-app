// CP-0.5: prove the Drizzle client can INSERT + SELECT against the live DB.
// Run with `npm run db:smoke` after setting DATABASE_URL in .env.local.
// Cleans up its own writes so it can be run repeatedly.

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

const SMOKE_ID = "__smoke";

async function main() {
  await db
    .delete(schema.categories)
    .where(eq(schema.categories.id, SMOKE_ID));

  await db.insert(schema.categories).values({
    id: SMOKE_ID,
    name: "Smoke Test Category",
    groupFormat: "single_game_15",
  });

  const rows = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, SMOKE_ID));

  if (rows.length !== 1 || rows[0].name !== "Smoke Test Category") {
    throw new Error(`Smoke read mismatch: ${JSON.stringify(rows)}`);
  }

  await db
    .delete(schema.categories)
    .where(eq(schema.categories.id, SMOKE_ID));

  console.log("CP-0.5 PASS — INSERT + SELECT + DELETE round-trip via Drizzle.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
