-- Enable PostgreSQL extensions required by the approved Preshopps schema design.
-- Structural schema only: no tables, enums, functions, triggers, RLS, storage,
-- or seed data are created here (see the approved migration strategy).

-- pg_trgm: trigram similarity, used for PostgreSQL-based marketplace keyword
-- search (PRD §15.1) and future trigram indexes on listing/shop text fields.
create extension if not exists pg_trgm with schema extensions;

-- moddatetime: trigger helper for maintaining updated_at columns, used by
-- later structural migrations once tables exist.
create extension if not exists moddatetime with schema extensions;
