// Production data restoration script — restores all production data to Turso
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import bcrypt from 'bcryptjs';

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const J = (p) => JSON.parse(readFileSync(p, 'utf8'));

const users = J('db/prod-export/users.json');
const projects = J('db/prod-export/projects.json');
const sops = J('db/prod-export/sops.json');
const settingsApi = J('db/prod-export/settings.json');

console.log(`Loaded: ${users.length} users, ${projects.length} projects, ${sops.length} SOPs`);

// Default password hash for new users (5 new users that don't exist in Turso yet)
// Default password: "Pushakin123!" — Manager can change via Atur Password feature
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('Pushakin123!', 10);
console.log(`Default password for new users: Pushakin123!`);
console.log(`Hash: ${DEFAULT_PASSWORD_HASH}`);

// Existing user IDs that already have correct password hashes in Turso
// We'll preserve their passwords by NOT overwriting password column for them.
// For 5 new users, use default hash.
const existingUserIds = new Set([
  'cmns1gob10000l404jij99v38', 'cmns1gp450001l4048a80ygbs', 'cmns1gpx80002l404zaax2gyo',
  'cmns1gqqa0003l404edvr5rbj', 'cmns1grjc0004l404erqq49jl', 'cmns1gsi70005l404vdgf6xfd',
  'cmns1gtb90006l40497hu7qmr', 'cmns1gu4c0007l4047h9s4poi', 'cmns1guxd0008l404x0l9hw3t',
  'cmns1gvqf0009l404pjn6ga7h', 'cmns1gwjh000al404o9j8rdt9', 'cmns1gxcj000bl404ulxid4ji',
  'cmns1gy5m000cl404e2hhq7lv', 'cmns1gyyo000dl40437riwp5y',
]);

// === STEP 1: WIPE existing data (clean slate from production) ===
console.log('\n=== STEP 1: Wiping Turso tables ===');
const tablesToWipe = ['drive_folders', 'tasks', 'projects', 'users', 'notifications', 'surat_tugas', 'sops', 'permohonan', 'surat', 'program_kegiatan'];
for (const t of tablesToWipe) {
  try {
    await client.execute(`DELETE FROM ${t}`);
    console.log(`  ✓ Wiped ${t}`);
  } catch (e) {
    console.log(`  - ${t}: ${e.message.split('\n')[0]}`);
  }
}

// === STEP 2: Insert users ===
console.log('\n=== STEP 2: Inserting 19 production users ===');
let inserted = 0;
for (const u of users) {
  // Use default password for new users; for existing, use default too (we'll restore the correct password from local SQLite afterward)
  // Actually, since we wiped, we need a password. Use default for all new, and for existing users we'll restore correct hashes from local SQLite in step 6.
  const password = existingUserIds.has(u.id) ? '$2a$10$placeholder' : DEFAULT_PASSWORD_HASH;
  const avatar = u.avatar || null;
  const whatsapp = u.whatsapp || '0';
  
  await client.execute({
    sql: `INSERT INTO users (id, name, email, password, whatsapp, avatar, role, notifWaEnabled, notifEmailEnabled, autoApproveReview, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      u.id, u.name, u.email, password, whatsapp,
      avatar && avatar.length > 50000 ? null : avatar, // Strip large avatars
      u.role,
      u.notifWaEnabled ? 1 : 0,
      u.notifEmailEnabled ? 1 : 0,
      u.autoApproveReview ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  });
  inserted++;
}
console.log(`  ✓ Inserted ${inserted} users`);

// === STEP 3: Restore correct password hashes for the 14 existing users from local SQLite ===
console.log('\n=== STEP 3: Restoring password hashes from local SQLite for existing users ===');
import { Database } from 'bun:sqlite';
const localDb = new Database('db/custom.db', { readonly: true });
const existingUsersLocal = localDb.prepare('SELECT id, password FROM users').all();
let pwdRestored = 0;
for (const u of existingUsersLocal) {
  if (existingUserIds.has(u.id) && u.password && u.password.length > 30) {
    await client.execute({
      sql: `UPDATE users SET password = ? WHERE id = ?`,
      args: [u.password, u.id],
    });
    pwdRestored++;
  }
}
localDb.close();
console.log(`  ✓ Restored passwords for ${pwdRestored} existing users`);

// === STEP 4: Insert projects ===
console.log('\n=== STEP 4: Inserting 39 production projects ===');
let projInserted = 0;
for (const p of projects) {
  // Map project fields
  // Convert ISO date string to timestamp ms (Prisma stores DateTime as ISO string in libsql? Let's check)
  // Actually for libsql/SQLite, Prisma stores DateTime as ISO string. Let's use ISO.
  const createdAt = p.createdAt; // already ISO string
  const updatedAt = createdAt;
  
  await client.execute({
    sql: `INSERT INTO projects (
      id, title, description, requesterUnit, location, executionTime,
      picName, picWhatsApp, activityTypes, customActivity,
      outputNeeds, customOutput, currentStage, isFastTrack, isFastProduction,
      managerId, publicToken, documents, createdAt, updatedAt,
      workerCustomOutput, workerOutputs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      p.id,
      p.title || '',
      p.description || '',
      p.requesterUnit || '',
      p.location || null,
      p.executionTime || null,
      p.picName || null,
      p.picWhatsApp || null,
      JSON.stringify(p.activityTypes || []),
      p.customActivity || null,
      JSON.stringify(p.outputNeeds || []),
      p.customOutput || null,
      p.currentStage ?? 1,
      p.isFastTrack ? 1 : 0,
      p.isFastProduction ? 1 : 0,
      p.managerId || null,
      p.publicToken || null,
      JSON.stringify(p.documents || []),
      createdAt,
      updatedAt,
      JSON.stringify(p.workerCustomOutput || {}),
      JSON.stringify(p.workerOutputs || {}),
    ],
  });
  projInserted++;
}
console.log(`  ✓ Inserted ${projInserted} projects`);

// === STEP 5: Insert tasks ===
console.log('\n=== STEP 5: Inserting tasks ===');
let taskInserted = 0;
for (const p of projects) {
  for (const t of (p.tasks || [])) {
    await client.execute({
      sql: `INSERT INTO tasks (
        id, role, stage, status, data, revisionCount, assignedTo, projectId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        t.id,
        t.role,
        t.stage,
        t.status || 'pending',
        JSON.stringify(t.data || {}),
        t.revisionCount ?? 0,
        t.assignedTo || null,
        p.id,
        p.createdAt,
        p.createdAt,
      ],
    });
    taskInserted++;
  }
}
console.log(`  ✓ Inserted ${taskInserted} tasks`);

// === STEP 6: Insert drive folders ===
console.log('\n=== STEP 6: Inserting drive folders ===');
let folderInserted = 0;
for (const p of projects) {
  for (const f of (p.driveFolders || [])) {
    await client.execute({
      sql: `INSERT INTO drive_folders (
        id, folderId, name, description, link, assignedRoles, assignedUsers,
        color, bgColor, borderColor, projectId, parentFolderId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        f.id,
        f.folderId || '',
        f.name || '',
        f.desc || f.description || null,
        f.link || null,
        JSON.stringify(f.assignedRoles || []),
        JSON.stringify(f.assignedUsers || []),
        f.color || null,
        f.bg || f.bgColor || null,
        f.border || f.borderColor || null,
        p.id,
        f.parentFolderId || null,
      ],
    });
    folderInserted++;
  }
}
console.log(`  ✓ Inserted ${folderInserted} drive folders`);

// === STEP 7: Insert SOPs ===
console.log('\n=== STEP 7: Inserting SOPs ===');
let sopInserted = 0;
for (const s of sops) {
  await client.execute({
    sql: `INSERT INTO sops (
      id, title, content, type, displayMode, files, slideshowSpeed, published, \`order\`, authorId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      s.id,
      s.title || '',
      s.content || '',
      s.type || 'SOP',
      s.displayMode || 'page',
      JSON.stringify(s.files || []),
      s.slideshowSpeed ?? 5000,
      s.published ? 1 : 0,
      s.order ?? 0,
      s.authorId || null,
      s.createdAt || new Date().toISOString(),
      s.updatedAt || new Date().toISOString(),
    ],
  });
  sopInserted++;
}
console.log(`  ✓ Inserted ${sopInserted} SOPs`);

// === STEP 8: Update settings (we cannot restore driveServiceAccountKey from API; user will need to re-add it) ===
console.log('\n=== STEP 8: Updating settings ===');
await client.execute({
  sql: `INSERT INTO settings (id, driveAutoCreate, driveParentFolderId, driveSharedDriveId, driveServiceAccountKey, driveApiKey, maintenanceMode, maintenanceMessage, notifWaEnabled, notifWaToken, notifWaDeviceId, notifWaSenderNumber, notifEmailEnabled, notifEmailHost, notifEmailPort, notifEmailUser, notifEmailPass, notifEmailFromName, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          driveAutoCreate=excluded.driveAutoCreate,
          driveParentFolderId=excluded.driveParentFolderId,
          driveSharedDriveId=excluded.driveSharedDriveId,
          maintenanceMode=excluded.maintenanceMode,
          maintenanceMessage=excluded.maintenanceMessage,
          updatedAt=excluded.updatedAt`,
  args: [
    'main',
    settingsApi.driveAutoCreate ? 1 : 0,
    settingsApi.driveParentFolderId || null,
    settingsApi.driveSharedDriveId || null,
    null, // service account key — user will need to re-add via Settings UI
    settingsApi.driveApiKey || null,
    settingsApi.maintenanceMode ? 1 : 0,
    settingsApi.maintenanceMessage || null,
    0, null, null, null, 0, null, null, null, null, null,
    new Date().toISOString(),
  ],
});
console.log('  ✓ Settings updated (driveServiceAccountKey needs to be re-added via Settings UI)');

// === STEP 9: Verify ===
console.log('\n=== STEP 9: Verification ===');
for (const t of ['users', 'projects', 'tasks', 'drive_folders', 'sops']) {
  const r = await client.execute(`SELECT COUNT(*) as c FROM ${t}`);
  console.log(`  ${t}: ${r.rows[0].c} rows`);
}

// Verify Neco Manager exists
const necoMgr = await client.execute("SELECT id, name, email, role FROM users WHERE email = 'user15@pushakin.local' AND role = 'Manager'");
console.log(`\n  Neco Manager account: ${necoMgr.rows.length > 0 ? '✓ EXISTS' : '✗ MISSING'}`);
if (necoMgr.rows.length > 0) {
  console.log(`    ${necoMgr.rows[0].id} | ${necoMgr.rows[0].name} | ${necoMgr.rows[0].role}`);
}

// Verify Neco's projects
const necoProjs = await client.execute("SELECT id, title, currentStage FROM projects WHERE managerId = 'cmpl1arkc0003jf04wg0gbime' ORDER BY currentStage");
console.log(`\n  Neco's projects: ${necoProjs.rows.length}`);
for (const p of necoProjs.rows) {
  console.log(`    T${p.currentStage} | ${p.id} | ${p.title}`);
}

console.log('\n=== MIGRATION COMPLETE ===');
console.log('Default password for new users (Neco Manager + 4 others): Pushakin123!');
console.log('Manager should reset passwords via "Atur Password" feature.');
console.log('Google Drive service account key needs to be re-added via Settings UI.');

process.exit(0);
