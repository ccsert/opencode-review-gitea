---
name: review-sql
description: Review checklist for SQL, database migrations and data access changes (.sql files, migration directories, ORM models, query builders, schema changes).
---

# SQL and Migration Review Checklist

Identify the database engine from the diff or repository files before judging syntax or locking behavior. Do not assume a dialect the diff does not show.

## Queries
- Queries assembled with string concatenation or interpolation of external values.
- Missing `WHERE` on `UPDATE`/`DELETE`; joins that multiply rows unexpectedly; `SELECT *` in code paths that depend on column order.
- Unbounded result sets without `LIMIT` or pagination on tables that grow.
- `NULL` semantics: `= NULL`, `NOT IN` with nullable subqueries, aggregates over empty sets.
- New query patterns filtering or sorting on columns without a supporting index.

## Migrations
- Destructive changes (drop column/table, type narrowing) without a data migration or a deploy-order plan; code still reading the dropped column.
- Operations that rewrite or lock large tables during deploy (adding a non-null column with default on older engines, creating indexes without `CONCURRENTLY`/online options where the engine supports them).
- Non-reversible migrations where the project's other migrations provide `down` steps.
- Constraint changes that existing data may violate (new `NOT NULL`, unique, foreign key) without backfill.

## Transactions and consistency
- Multi-statement writes without a transaction; read-modify-write without locking or optimistic version checks.
- Long transactions holding locks across network calls.

## Do not report
- Keyword casing or formatting preferences.
- Index suggestions without a query in the diff that needs them.
