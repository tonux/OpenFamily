-- Up Migration
-- Monthly bank / credit-card statement import.
--
-- Why two tables instead of pushing straight into budget_entries:
--   A statement is a document with its own facts — closing balance, minimum
--   due, due date, credit limit, interest rate — that have no place on an
--   individual expense row. Keeping them lets the UI answer "how much do I
--   owe and by when", which a pile of budget_entries never can.
--
--   The staging table (bank_statement_transactions) also gives us the
--   human-in-the-loop step the receipt scanner already has: the model
--   proposes, the user reviews and edits, and only a confirmed statement
--   writes into budget_entries. Financial amounts never autosave.
--
-- Deduplication happens at two levels:
--   * bank_statements.content_hash — re-uploading the same PDF is rejected
--     with 409 instead of doubling every transaction.
--   * bank_statement_transactions.dedup_hash — a line already present in a
--     previously imported statement (overlapping periods, corrected
--     statements) is flagged 'duplicate' and excluded from the import by
--     default. The user can still force it in from the review table.

CREATE TABLE IF NOT EXISTS bank_statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- pending_review: parsed, waiting for the user to confirm.
    -- imported:       confirmed, budget_entries rows created.
    -- failed:         parsing or extraction failed; kept for diagnostics.
    status VARCHAR(20) NOT NULL DEFAULT 'pending_review',

    -- Identity of the account the statement belongs to.
    issuer VARCHAR(120),
    account_label VARCHAR(120),
    card_last4 VARCHAR(4),
    currency VARCHAR(3) NOT NULL DEFAULT 'CAD',

    -- Statement period.
    statement_date DATE,
    period_start DATE,
    period_end DATE,

    -- Money facts read off the summary block.
    previous_balance NUMERIC(12, 2),
    new_balance NUMERIC(12, 2),
    total_purchases NUMERIC(12, 2),
    total_payments NUMERIC(12, 2),
    total_cash_advances NUMERIC(12, 2),
    total_fees NUMERIC(12, 2),
    minimum_due NUMERIC(12, 2),
    due_date DATE,
    credit_limit NUMERIC(12, 2),
    available_credit NUMERIC(12, 2),
    interest_rate_purchases NUMERIC(5, 2),
    rewards_earned NUMERIC(10, 2),

    -- Provenance and diagnostics.
    source_filename VARCHAR(255),
    file_key VARCHAR(512),
    content_hash VARCHAR(64) NOT NULL,
    page_count INTEGER,
    ai_model VARCHAR(100),

    -- sum(transactions) - total_purchases. Zero means the parse reconciles
    -- with the bank's own summary; anything else is surfaced in the UI as a
    -- warning rather than silently trusted.
    reconciliation_delta NUMERIC(12, 2),
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,

    imported_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT bank_statements_status_check
        CHECK (status IN ('pending_review', 'imported', 'failed')),
    CONSTRAINT bank_statements_user_content_unique
        UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_bank_statements_user
    ON bank_statements (user_id, statement_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_statements_status
    ON bank_statements (user_id, status);

CREATE TABLE IF NOT EXISTS bank_statement_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Order the line appeared in on the statement; keeps the review table
    -- stable and lets us show "line 34 of 68" in error messages.
    line_no INTEGER NOT NULL DEFAULT 0,

    transaction_date DATE NOT NULL,
    posted_date DATE,
    description VARCHAR(255) NOT NULL,
    merchant VARCHAR(160),

    -- Always stored positive; direction lives in is_expense, exactly like
    -- budget_entries so the confirm step is a straight copy.
    amount NUMERIC(12, 2) NOT NULL,
    is_expense BOOLEAN NOT NULL DEFAULT TRUE,

    category VARCHAR(50) NOT NULL DEFAULT 'Autre',
    assigned_to UUID REFERENCES family_members(id) ON DELETE SET NULL,
    confidence VARCHAR(10) NOT NULL DEFAULT 'medium',

    -- pending:   awaiting the user's decision (default)
    -- imported:  copied into budget_entries
    -- ignored:   user excluded it (card payments, internal transfers…)
    -- duplicate: matches a line from an earlier statement
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    dedup_hash VARCHAR(64) NOT NULL,
    budget_entry_id UUID REFERENCES budget_entries(id) ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT bank_statement_tx_status_check
        CHECK (status IN ('pending', 'imported', 'ignored', 'duplicate')),
    CONSTRAINT bank_statement_tx_confidence_check
        CHECK (confidence IN ('high', 'medium', 'low')),
    CONSTRAINT bank_statement_tx_amount_positive
        CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_tx_statement
    ON bank_statement_transactions (statement_id, line_no);
CREATE INDEX IF NOT EXISTS idx_bank_statement_tx_dedup
    ON bank_statement_transactions (user_id, dedup_hash);
CREATE INDEX IF NOT EXISTS idx_bank_statement_tx_entry
    ON bank_statement_transactions (budget_entry_id);

-- Where a budget entry came from. 'manual' keeps every pre-existing row
-- correct without a backfill; the UI uses this to badge imported rows and to
-- let the user filter them out.
ALTER TABLE budget_entries
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_budget_entries_source
    ON budget_entries (user_id, source);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_bank_statements_updated_at') THEN
        CREATE TRIGGER update_bank_statements_updated_at
        BEFORE UPDATE ON bank_statements
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_bank_statement_tx_updated_at'
    ) THEN
        CREATE TRIGGER update_bank_statement_tx_updated_at
        BEFORE UPDATE ON bank_statement_transactions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Down Migration
DROP INDEX IF EXISTS idx_budget_entries_source;
ALTER TABLE budget_entries DROP COLUMN IF EXISTS source;
DROP TABLE IF EXISTS bank_statement_transactions CASCADE;
DROP TABLE IF EXISTS bank_statements CASCADE;
