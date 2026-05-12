-- Up Migration
-- Phase 5: home renovation/work projects (kitchen redo, painting, garden…).
--
-- Checklist is JSONB inline rather than a third table — most projects have
-- < 30 items and concurrent edits aren't a thing for a single foyer. Items
-- carry their own UUID so the API can patch them individually.
--
-- After creating the projects table, we wire the FK from house_documents
-- (which was declared without one in the previous migration so this and
-- documents could be added in either order if needed).

CREATE TABLE IF NOT EXISTS house_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    -- Free-form text in DB; the API enforces the enum.
    category VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Idée',
    description TEXT,
    planned_budget NUMERIC(10, 2),
    started_at DATE,
    target_end DATE,
    completed_at DATE,
    -- [{id: uuid, label: string, done: bool}, …]
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_house_projects_user ON house_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_house_projects_status ON house_projects(user_id, status);

CREATE TRIGGER update_house_projects_updated_at
    BEFORE UPDATE ON house_projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Wire the documents → projects FK now that the table exists. Same
-- ON DELETE SET NULL semantics as the other link targets.
ALTER TABLE house_documents
    ADD CONSTRAINT house_documents_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES house_projects(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE house_documents DROP CONSTRAINT IF EXISTS house_documents_project_id_fkey;
DROP TRIGGER IF EXISTS update_house_projects_updated_at ON house_projects;
DROP INDEX IF EXISTS idx_house_projects_status;
DROP INDEX IF EXISTS idx_house_projects_user;
DROP TABLE IF EXISTS house_projects;
