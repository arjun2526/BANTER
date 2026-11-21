import assert from "node:assert/strict";
import { test } from "node:test";
import { isMigrationFile, migrationName, pendingMigrations } from "./migration-plan.mjs";

test("migration keys use the filename", () => {
  assert.equal(migrationName("/migrations/0002_messages.sql"), "0002_messages.sql");
});

test("only SQL migration files are included", () => {
  assert.equal(isMigrationFile("0001_auth.sql"), true);
  assert.equal(isMigrationFile("README.md"), false);
});

test("pending migrations are sorted and already-applied files are skipped", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql", "notes.md"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});
