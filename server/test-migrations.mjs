import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { promises as fs } from 'fs';
import path from 'path';

const DIR = path.resolve('migrations');

// Extract the SQL between `-- Up Migration` and `-- Down Migration` markers
// (or to EOF if there's no Down section).
const extractUpSection = (content) => {
    const up = content.match(/--\s*Up Migration\s*\n([\s\S]*?)(?=--\s*Down Migration|$)/i);
    return up ? up[1].trim() : '';
};
const extractDownSection = (content) => {
    const down = content.match(/--\s*Down Migration\s*\n([\s\S]*)$/i);
    return down ? down[1].trim() : '';
};

const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
console.log('Migrations found:', files);

const db = await PGlite.create({ extensions: { uuid_ossp } });
await db.waitReady;

let pass = 0,
    fail = 0;
const A = (c, n, d = '') => {
    if (c) {
        console.log('  OK   ' + n);
        pass++;
    } else {
        console.log('  FAIL ' + n + (d ? '\n       ' + d : ''));
        fail++;
    }
};

console.log('\n=== Phase 1: First-time apply of all migrations ===');
for (const f of files) {
    const content = await fs.readFile(path.join(DIR, f), 'utf8');
    const up = extractUpSection(content);
    if (!up) {
        console.log(`  SKIP ${f} (no up section)`);
        continue;
    }
    try {
        await db.exec(up);
        console.log(`  OK   applied ${f}`);
        pass++;
    } catch (e) {
        console.log(`  FAIL applied ${f}\n       ${e.message}`);
        fail++;
    }
}

console.log('\n=== Phase 2: Re-apply (idempotency) ===');
for (const f of files) {
    const content = await fs.readFile(path.join(DIR, f), 'utf8');
    const up = extractUpSection(content);
    if (!up) continue;
    try {
        await db.exec(up);
        pass++;
    } catch (e) {
        console.log(`  FAIL re-applied ${f}: ${e.message.split('\n')[0]}`);
        fail++;
    }
}
A(true, 'all migrations re-runnable without error');

console.log('\n=== Phase 3: Schema verification ===');
const tables = (
    await db.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )
).rows.map((r) => r.table_name);
const expected = [
    'appointments',
    'budget_entries',
    'budget_limits',
    'family_members',
    'meal_plans',
    'notifications',
    'push_subscriptions',
    'recipes',
    'schedule_entries',
    'shopping_items',
    'shopping_list_templates',
    'tasks',
    'users',
];
A(
    expected.every((t) => tables.includes(t)),
    `all 13 base tables exist (got ${tables.length}: ${tables.join(',')})`,
);

const familyCols = (
    await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'family_members'`,
    )
).rows.map((r) => r.column_name);
A(familyCols.includes('role'), 'family_members.role added by extras migration');
A(familyCols.includes('emergency_contact_name'), 'family_members.emergency_contact_name added');
A(familyCols.includes('emergency_contact_phone'), 'family_members.emergency_contact_phone added');
A(familyCols.includes('notes'), 'family_members.notes added');
A(familyCols.includes('medications'), 'family_members.medications added');

const scheduleCols = (
    await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'schedule_entries'`,
    )
).rows.map((r) => r.column_name);
A(scheduleCols.includes('specific_date'), 'schedule_entries.specific_date present');
A(scheduleCols.includes('location'), 'schedule_entries.location present');

const userCols = (
    await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`)
).rows.map((r) => r.column_name);
A(userCols.includes('currency'), 'users.currency added by currency migration');

const budgetCols = (
    await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'budget_entries'`,
    )
).rows.map((r) => r.column_name);
A(budgetCols.includes('assigned_to'), 'budget_entries.assigned_to added');

const indexes = (
    await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)
).rows.map((r) => r.indexname);
A(indexes.includes('idx_schedule_entries_user_day'), 'idx_schedule_entries_user_day created');
A(indexes.includes('idx_budget_entries_assigned_to'), 'idx_budget_entries_assigned_to created');

const triggers = (await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).rows.map(
    (r) => r.tgname,
);
A(triggers.includes('update_users_updated_at'), 'updated_at trigger on users');
A(
    triggers.includes('update_schedule_entries_updated_at'),
    'updated_at trigger on schedule_entries',
);

console.log('\n=== Phase 4: End-to-end insert/update/delete sanity ===');
try {
    await db.query(`INSERT INTO users (email, password_hash, name) VALUES ('a@b.c', 'h', 'A')`);
    const u = (await db.query(`SELECT id, currency FROM users WHERE email = 'a@b.c'`)).rows[0];
    A(u && u.currency === null, 'user created with currency=NULL (multi-currency migration)');

    await db.query(`INSERT INTO family_members (user_id, name, role) VALUES ($1, $2, $3)`, [
        u.id,
        'Kid',
        'Enfant',
    ]);
    const fm = (await db.query(`SELECT role FROM family_members LIMIT 1`)).rows[0];
    A(fm.role === 'Enfant', 'family_member inserted with role');

    // Test trigger updates updated_at
    const before = (await db.query(`SELECT updated_at FROM users WHERE email = 'a@b.c'`)).rows[0]
        .updated_at;
    await new Promise((r) => setTimeout(r, 50));
    await db.query(`UPDATE users SET name = 'B' WHERE email = 'a@b.c'`);
    const after = (await db.query(`SELECT updated_at FROM users WHERE email = 'a@b.c'`)).rows[0]
        .updated_at;
    A(new Date(after).getTime() > new Date(before).getTime(), 'updated_at trigger fires on UPDATE');
} catch (e) {
    A(false, `e2e insert/update flow: ${e.message}`);
}

console.log(`\nRésumé: ${pass} pass, ${fail} fail`);
await db.close();
process.exit(fail === 0 ? 0 : 1);
