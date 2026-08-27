import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'

const DB_PATH = '/home/z/my-project/db/custom.db'
const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')

// Hash the default password
const hashed = await bcrypt.hash('pushakin123', 6)

// Check if Super Admin exists
const existing = db.query(`SELECT id, email, role FROM users WHERE role = 'Admin' LIMIT 1`).all() as Array<{id: string, email: string, role: string}>
if (existing.length > 0) {
  console.log('Super Admin already exists:', existing[0])
  // Reset password to be safe
  db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, existing[0].id])
  console.log('Password reset to pushakin123 for', existing[0].email)
} else {
  const id = crypto.randomUUID()
  db.run(
    `INSERT INTO users (id, name, email, password, role, "notifWaEnabled", "notifEmailEnabled", "autoApproveReview", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'Admin', 1, 1, 0, ?, ?)`,
    [id, 'Super Admin', 'admin@pushakin.local', hashed, Date.now(), Date.now()]
  )
  console.log('Created Super Admin: admin@pushakin.local / pushakin123 (id=' + id + ')')
}

// Also seed a 'main' settings row if missing
const settings = db.query(`SELECT id FROM settings WHERE id = 'main' LIMIT 1`).all() as Array<{id: string}>
if (settings.length === 0) {
  db.run(
    `INSERT INTO settings (id, "driveAutoCreate", "driveMode", "maintenanceMode", "notifWaEnabled", "notifEmailEnabled", "updatedAt")
     VALUES ('main', 0, 'shared', 0, 0, 0, ?)`,
    [Date.now()]
  )
  console.log('Created settings row with driveMode=shared')
} else {
  console.log('Settings row already exists:', settings[0])
}

// Verify
const verify = db.query(`SELECT id, email, role FROM users WHERE role = 'Admin' LIMIT 1`).all() as Array<{id: string, email: string, role: string}>
console.log('Final state:', verify[0])

db.close()
