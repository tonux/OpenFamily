-- Up Migration
-- Multi-currency support: each user picks a preferred currency.
-- Nullable so existing accounts are prompted to confirm on next login.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS currency;
