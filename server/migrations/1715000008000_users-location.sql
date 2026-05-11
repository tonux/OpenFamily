-- Up Migration
-- Per-user location: city + geocoded coordinates. Used by the dashboard
-- weather/clothing widget. All four columns are nullable so existing accounts
-- keep working; the widget shows an empty-state CTA until a city is set.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS city          VARCHAR(120),
    ADD COLUMN IF NOT EXISTS country_code  CHAR(2),
    ADD COLUMN IF NOT EXISTS latitude      NUMERIC(8, 5),
    ADD COLUMN IF NOT EXISTS longitude     NUMERIC(8, 5);

-- Down Migration
ALTER TABLE users
    DROP COLUMN IF EXISTS longitude,
    DROP COLUMN IF EXISTS latitude,
    DROP COLUMN IF EXISTS country_code,
    DROP COLUMN IF EXISTS city;
