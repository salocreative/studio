-- Ensure 'manager' exists in user_role enum (idempotent).
-- Must be in its own migration: new enum values cannot be used in the same transaction.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';
