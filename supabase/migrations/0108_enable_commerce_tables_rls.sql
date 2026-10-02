-- All six tables below already have RLS enabled in production. This
-- migration makes that setting reproducible from a fresh database (CI,
-- staging, disaster recovery) instead of only existing as an undocumented,
-- directly-applied live state. Existing policies remain unchanged --
-- favorites_select_own is already defined in 0037_favorites_cart_rls_and_rpcs.sql
-- and simply has no effect until RLS is enabled here.
--
-- This migration does not audit or change table privileges (GRANT/REVOKE),
-- add any new policy, or touch FORCE ROW LEVEL SECURITY.

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_cancellation_requests enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.favorites enable row level security;
