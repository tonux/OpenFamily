-- Up Migration
-- AI layer infrastructure: cache for deterministic classifications, audit log
-- of every model call (for quotas and observability), and persisted chat
-- conversations for the future assistant feature.

-- Deterministic classifications cache (e.g. "panais" -> "Légumes"). Saves
-- 90%+ of model calls once warmed up, so it's worth the small storage cost.
CREATE TABLE IF NOT EXISTS ai_classification_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(50) NOT NULL,
    input_normalized VARCHAR(255) NOT NULL,
    output_value VARCHAR(255) NOT NULL,
    model VARCHAR(100) NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scope, input_normalized)
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_scope_input
    ON ai_classification_cache (scope, input_normalized);

-- Audit log of every interaction with the model. Used to (a) enforce per-user
-- monthly quotas, (b) trace latency / cost regressions, (c) debug user
-- complaints about wrong outputs. The prompt body is NOT stored here — only
-- metrics — to keep PII out of the logs.
CREATE TABLE IF NOT EXISTS ai_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    status VARCHAR(20) NOT NULL,
    error_code VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user_month
    ON ai_interactions (user_id, created_at);

-- Persisted chat conversations (one per assistant thread, per user).
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
    ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT,
    tool_call_id VARCHAR(100),
    tool_calls JSONB,
    tokens INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv
    ON ai_messages (conversation_id, created_at);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_ai_conversations_updated_at'
    ) THEN
        CREATE TRIGGER update_ai_conversations_updated_at
        BEFORE UPDATE ON ai_conversations
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS ai_messages CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;
DROP TABLE IF EXISTS ai_interactions CASCADE;
DROP TABLE IF EXISTS ai_classification_cache CASCADE;
