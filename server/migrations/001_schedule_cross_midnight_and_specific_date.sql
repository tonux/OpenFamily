-- Up Migration
-- DEPRECATED — superseded by 1715000004000_schedule-cross-midnight-and-extras.sql.
-- This file used to be a standalone SQL script that operators ran manually
-- before node-pg-migrate was introduced. It is kept (and emptied) only to
-- preserve historical filename ordering on installations that may have
-- already applied it. The actual schedule_entries fixes now live in the
-- properly-timestamped migration in the same directory.
SELECT 1;

-- Down Migration
SELECT 1;
