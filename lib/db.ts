import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/drizzle/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

// One connection for the whole process. Supabase poolers cap concurrency;
// keep `max` modest so we don't exhaust the pooler's slot count.
const queryClient = postgres(url, { max: 10, prepare: false });

export const db = drizzle(queryClient, { schema });
export { schema };
