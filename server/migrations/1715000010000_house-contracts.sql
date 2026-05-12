-- Up Migration
-- Phase 2 of the "Maison" section: recurring contracts & bills (EDF, eau,
-- internet, assurance, prêt…). Each row is a long-lived "template" that
-- carries the next due date; "mark as paid" advances next_due_date by the
-- frequency interval and (optionally) creates a budget_entries row so the
-- expense flows into the existing Budget module without manual entry.

CREATE TABLE IF NOT EXISTS house_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    provider VARCHAR(80),
    -- Free-form text in DB; the API enforces an enum so future categories
    -- don't require a migration.
    category VARCHAR(32) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    frequency VARCHAR(24) NOT NULL,
    -- Anchor for recurrence. Always populated; advanced server-side on
    -- "pay" actions.
    next_due_date DATE NOT NULL,
    payment_method VARCHAR(24),
    client_number VARCHAR(80),
    notes TEXT,
    -- Soft-disable lets the user keep the history without seeing inactive
    -- contracts in active lists / dashboard alerts.
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- When true, paying a contract creates a budget_entries row for the
    -- amount automatically. Default ON so the value is immediate; the user
    -- can opt out per-contract (e.g. for a contract paid by a third party).
    auto_create_budget_entry BOOLEAN NOT NULL DEFAULT true,
    -- Budget category to use when auto-creating entries. Falls back to
    -- 'Maison' at the route layer if NULL.
    budget_category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_contracts_user ON house_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_house_contracts_due
    ON house_contracts(user_id, next_due_date)
    WHERE is_active = true;

CREATE TRIGGER update_house_contracts_updated_at
    BEFORE UPDATE ON house_contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_contracts_updated_at ON house_contracts;
DROP INDEX IF EXISTS idx_house_contracts_due;
DROP INDEX IF EXISTS idx_house_contracts_user;
DROP TABLE IF EXISTS house_contracts;
