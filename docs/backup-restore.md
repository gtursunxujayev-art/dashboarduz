# Database backup and restore

How to take a manual backup of the production Postgres before running migrations, and how to restore it.
The app has no backup code; this is an operator procedure.

## What Railway backs up on its own: confirm this first

This repository cannot see the Railway project, so it does not know what Railway backs up automatically.
Before relying on any of it, the owner should check in the Railway dashboard (Postgres service → Backups /
Settings) and write the answers here:

- Are automatic backups enabled for this database, and on which plan? _(owner to confirm)_
- How often are they taken, and how long are they kept? _(owner to confirm)_
- Can a backup be restored into a **new** database (to inspect it) rather than only over the live one? _(owner to confirm)_
- Is point-in-time recovery available? _(owner to confirm)_

Until those are confirmed, treat the manual backup below as the only backup that is known to exist.

## Before every migration: take a manual backup

Run this from a trusted machine, right before `npm run db:migrate:deploy` (README, "Release Path").

1. Install the Postgres client tools with a major version **at least** the server's (`SELECT version();`;
   e.g. `pg_dump` 16 or newer for a Postgres 16 server).
2. Get the owner connection URL from Railway (the Postgres service's public / TCP-proxy URL, the same one used
   for migrations). Keep it in your shell only; do not paste it into files, tickets or chat.
3. Take a compressed, restorable dump:

   ```bash
   pg_dump "$OWNER_DATABASE_URL" --format=custom --no-owner --no-privileges --file "dashboarduz-$(date +%Y%m%d-%H%M).dump"
   ```

   `--format=custom` lets `pg_restore` restore all of it or single tables. `--no-owner --no-privileges` makes the
   dump restorable into a database whose roles differ (e.g. a local copy).
4. Check that the file is usable before you migrate:

   ```bash
   pg_restore --list "dashboarduz-YYYYMMDD-HHMM.dump" | head
   ```

   It must list tables such as `incomes`, `customers` and `_prisma_migrations`. An empty or failing listing means
   there is no usable backup; do not run the migration.
5. Store the file somewhere private and encrypted. It contains customer names, phone numbers and refund card
   numbers. Delete old dumps you no longer need.

## Restore

Always restore into a **new, empty** database first and check it there; only then decide whether to switch the
app to it or to copy data back.

1. Create an empty database (a new Railway Postgres service, or locally `createdb dashboarduz_restore`).
2. Restore:

   ```bash
   pg_restore --dbname "$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error "dashboarduz-YYYYMMDD-HHMM.dump"
   ```

3. Check it: row counts of the main tables, the latest `incomes."createdAt"`, and
   `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;` (it shows which migrations
   the backup already contains).
4. If Row Level Security was enforced on the source (`packages/db/scripts/rls-enforce.sql`, see
   `packages/db/README.md`), the dump does not carry the `dashboarduz_app` / `dashboarduz_system` roles or their
   grants (`--no-owner --no-privileges`). Re-run `rls-enforce.sql` on the restored database as its owner and set the
   role passwords before pointing the app at it.
5. To use the restored database, point `DATABASE_URL` (and `DATABASE_SYSTEM_URL`, if RLS is enforced) of the API
   and the worker at it and redeploy both.

## If a migration fails halfway

A migration file runs as one transaction, so a failed migration leaves no partial changes (exception: the
single-statement `CREATE INDEX CONCURRENTLY` migration, whose header says how to clean up), but it is recorded
as failed and blocks later migrations (`P3009`). Read the error (the migrations in this repo name the offending
rows), fix the data, mark it rolled back with
`npx prisma migrate resolve --rolled-back <migration_name> --schema=packages/db/prisma/schema.prisma`, and deploy
again. Restore from the manual backup only if data was damaged, not merely because a migration failed.
