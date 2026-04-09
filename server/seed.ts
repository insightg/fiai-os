import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import db from './db.js'
import fs from 'fs'
import path from 'path'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80) || 'unnamed'
}

async function seed() {
  try {
    // Run migrations first
    const migrationPath = path.join(import.meta.dirname || '.', 'migrations', 'init-sqlite.sql')
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8')
      db.exec(sql)
    }

    // Check if admin already exists in entity
    const existing = db.prepare("SELECT id FROM entity WHERE type = 'utente' AND tags LIKE '%admin%'").get()
    if (existing) {
      console.log('Seed data already exists, skipping.')
      return
    }

    const passwordHash = await bcrypt.hash('admin', 10)

    const seedTx = db.transaction(() => {
      // Create BERNARDINI S.R.L. organization
      const aziendaId = crypto.randomUUID()
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, tags, metadata, path)
        VALUES (?, ?, 'organizzazione', 'BERNARDINI S.R.L.', 'bernardini-srl', '["organizzazione"]', '{}', '/entity/organizzazione/bernardini-srl')`
      ).run(aziendaId, aziendaId)
      console.log(`Created organizzazione: BERNARDINI S.R.L. (${aziendaId})`)

      // Create admin user
      const userId = crypto.randomUUID()
      const displayName = 'Admin'
      const email = 'admin@bernardini.it'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, email, tags, metadata, path)
        VALUES (?, ?, 'utente', ?, ?, ?, ?, ?, ?)`
      ).run(
        userId, aziendaId, displayName, slugify(displayName), email,
        JSON.stringify(['utente', 'admin']),
        JSON.stringify({ password_hash: passwordHash, ruolo: 'admin', cognome: '' }),
        `/entity/utente/${slugify(displayName)}`
      )
      console.log(`Created utente: ${email} (${userId})`)

      // Create membro_di relation
      db.prepare(`INSERT INTO relations (id, azienda_id, from_id, to_id, tipo)
        VALUES (?, ?, ?, ?, 'membro_di')`
      ).run(crypto.randomUUID(), aziendaId, userId, aziendaId)
    })

    seedTx()
    console.log('\nSeed completed successfully!')
    console.log('Login with: admin@bernardini.it / admin')
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  }
}

seed()
