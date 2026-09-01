-- Create the enum types required by the approved Preshopps schema design.
-- Structural schema only: no tables, functions, triggers, RLS, storage,
-- or seed data are created here (see the approved migration strategy).

create type user_role_enum as enum (
  'admin',
  'super_admin'
);

create type restriction_type_enum as enum (
  'seller_suspended',
  'buyer_restricted',
  'account_suspended'
);

create type shop_status_enum as enum (
  'active',
  'away'
);

create type listing_status_enum as enum (
  'draft',
  'available',
  'reserved',
  'paused',
  'sold',
  'archived'
);

create type listing_type_enum as enum (
  'preloved',
  'brand_new'
);

create type listing_condition_enum as enum (
  'brand_new',
  'like_new',
  'very_good',
  'good',
  'fair'
);

create type fulfillment_method_enum as enum (
  'meetup',
  'pickup',
  'local_delivery',
  'shipping'
);

create type vehicle_registration_status_enum as enum (
  'registered',
  'expired_registration',
  'for_renewal'
);

create type rental_period_enum as enum (
  'daily',
  'weekly',
  'monthly',
  'other'
);

create type rental_availability_enum as enum (
  'available',
  'unavailable',
  'paused'
);

create type order_status_enum as enum (
  'pending',
  'accepted',
  'ready',
  'handed_over_or_shipped',
  'received_confirmed',
  'completed',
  'declined',
  'cancelled',
  'expired',
  'disputed'
);

create type order_item_status_enum as enum (
  'pending',
  'accepted',
  'declined'
);

create type cancellation_request_status_enum as enum (
  'pending',
  'confirmed',
  'rejected'
);

create type conversation_type_enum as enum (
  'listing_inquiry',
  'general_shop'
);

create type dispute_status_enum as enum (
  'opened',
  'under_review',
  'resolved'
);
