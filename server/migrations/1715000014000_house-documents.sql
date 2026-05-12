-- Up Migration
-- Phase 5: documents (PDF + images) attachable to any "Maison" entity.
-- Stored in MinIO (S3-compatible); `storage_key` is the S3 object key.
--
-- Link target is exclusive: a document attaches to AT MOST one of
-- equipment_id / contract_id / contact_id / item_id / project_id. The CHECK
-- enforces "at most one"; null on every column means "Sans lien"
-- (free-floating in the library).
--
-- project_id is declared here without its FK; the FK is added by migration
-- 1715000015000 once house_projects exists. Document rows can be created
-- referencing a project as soon as the FK lands.

CREATE TABLE IF NOT EXISTS house_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    -- Free-form text in DB; the API enforces the enum.
    category VARCHAR(32) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    -- Exclusive link target. ON DELETE SET NULL preserves the document if
    -- the parent entity is removed — it falls back to "Sans lien" rather
    -- than getting cascade-deleted, because the user often cares more
    -- about the PDF than the row that referenced it.
    equipment_id UUID REFERENCES house_equipments(id) ON DELETE SET NULL,
    contract_id  UUID REFERENCES house_contracts(id)  ON DELETE SET NULL,
    contact_id   UUID REFERENCES house_contacts(id)   ON DELETE SET NULL,
    item_id      UUID REFERENCES house_items(id)      ON DELETE SET NULL,
    -- FK added by 1715000015000_house-projects after the table exists.
    project_id   UUID,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT house_documents_exclusive_link CHECK (
        (CASE WHEN equipment_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN contract_id  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN contact_id   IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN item_id      IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN project_id   IS NOT NULL THEN 1 ELSE 0 END) <= 1
    )
);

CREATE INDEX IF NOT EXISTS idx_house_documents_user ON house_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_house_documents_equipment
    ON house_documents(equipment_id) WHERE equipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_documents_contract
    ON house_documents(contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_documents_contact
    ON house_documents(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_documents_item
    ON house_documents(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_documents_project
    ON house_documents(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_documents_category
    ON house_documents(user_id, category);

CREATE TRIGGER update_house_documents_updated_at
    BEFORE UPDATE ON house_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration
DROP TRIGGER IF EXISTS update_house_documents_updated_at ON house_documents;
DROP INDEX IF EXISTS idx_house_documents_category;
DROP INDEX IF EXISTS idx_house_documents_project;
DROP INDEX IF EXISTS idx_house_documents_item;
DROP INDEX IF EXISTS idx_house_documents_contact;
DROP INDEX IF EXISTS idx_house_documents_contract;
DROP INDEX IF EXISTS idx_house_documents_equipment;
DROP INDEX IF EXISTS idx_house_documents_user;
DROP TABLE IF EXISTS house_documents;
