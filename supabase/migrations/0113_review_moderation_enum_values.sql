-- ============================================================
-- 0113_review_moderation_enum_values.sql
--
-- Phase 1 whole-review moderation: adds the review_removed and
-- review_restored values to the notification and email-outbox enums.
--
-- Deliberately a separate migration with no other statements. Postgres
-- does not allow a newly added enum value to be used in the same
-- transaction that added it, so the functions that emit these events
-- (0115_review_moderation_rpcs.sql) must run in a later migration.
-- This follows the same rule and pattern as 0095 (notification enum) and
-- 0102 (email enum).
-- ============================================================

alter type public.notification_type_enum add value if not exists 'review_removed';
alter type public.notification_type_enum add value if not exists 'review_restored';

alter type public.email_event_type_enum add value if not exists 'review_removed';
alter type public.email_event_type_enum add value if not exists 'review_restored';
