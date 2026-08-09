import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { db } from "./client.js";

migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
