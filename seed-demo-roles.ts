import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'

// Seed demo users for testing the role merge.
// NOTE: ContentCreator is intentionally NOT seeded as a separate user here
// because the user wants to MERGE ContentCreator into the combined
// PhotographerVideographerAudio role (whose display name becomes
// "Photographer, Videographer, Content Creator, dan Audio").
const DB_PATH = '/home/z/my-project/db/custom.db'
const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')

const hashed = await bcrypt.hash('pushakin123', 6)

const demoUsers: Array<{ name: string; email: string; role: string }> = [
  { name: 'Manager User',          email: 'manager@pushakin.local',       role: 'Manager' },
  { name: 'Reporter User',         email: 'reporter@pushakin.local',      role: 'Reporter' },
  { name: 'Tech Crew User',        email: 'techcrew@pushakin.local',      role: 'PhotographerVideographerAudio' },
  { name: 'Graphic Designer User', email: 'designer@pushakin.local',      role: 'GraphicDesigner' },
  { name: 'Editor Video User',     email: 'editorvideo@pushakin.local',   role: 'EditorVideo' },
  { name: 'Reviewer User',         email: 'reviewer@pushakin.local',      role: 'Reviewer' },
  { name: 'Publisher Web User',    email: 'pubweb@pushakin.local',        role: 'PublisherWeb' },
  { name: 'Publisher Social Media User', email: 'pubsocial@pushakin.local', role: 'PublisherSocialMedia' },
]

let inserted = 0
for (const u of demoUsers) {
  const exists = db.query(`SELECT id FROM users WHERE email = ? LIMIT 1`).all(u.email) as Array<{id: string}>
  if (exists.length > 0) {
    console.log(`[skip] ${u.email} already exists`)
    continue
  }
  const id = crypto.randomUUID()
  db.run(
    `INSERT INTO users (id, name, email, password, role, whatsapp, avatar, "notifWaEnabled", "notifEmailEnabled", "autoApproveReview", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
    [id, u.name, u.email, hashed, u.role, '081234567890', '', Date.now(), Date.now()]
  )
  inserted++
  console.log(`[insert] ${u.email} (role=${u.role})`)
}

console.log(`\nDone. Inserted ${inserted} new demo users.`)

const rows = db.query(`SELECT role, COUNT(*) as cnt FROM users GROUP BY role ORDER BY role`).all() as Array<{role: string, cnt: number}>
console.log('\nUsers by role:')
console.table(rows)

db.close()
