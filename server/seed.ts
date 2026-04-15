import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import db from './db.js'
import fs from 'fs'
import path from 'path'

async function seed() {
  try {
    // Run migrations first
    const migrationPath = path.join(import.meta.dirname || '.', 'migrations', 'init-sqlite.sql')
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8')
      db.exec(sql)
    }

    // Check if admin user already exists (VFS model)
    const existing = db.prepare("SELECT id FROM entity WHERE email = 'admin@fiai.it' AND type = 'utente'").get()
    if (existing) {
      console.log('Seed data already exists, skipping.')
      return
    }

    const passwordHash = await bcrypt.hash('password123', 10)

    const seedTx = db.transaction(() => {
      // Create default organization
      const aziendaId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO entity (id, azienda_id, type, display_name, slug, piva, email, tags, metadata, path)
         VALUES (?, ?, 'organizzazione', 'FIAI', 'fiai', ?, ?, '["organizzazione"]', '{}', '/entity/organizzazione/fiai')`
      ).run(aziendaId, aziendaId, '12345678901', 'info@fiai.it')
      console.log(`Created organization: ${aziendaId}`)

      // Create admin user
      const userId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO entity (id, azienda_id, type, display_name, slug, email, tags, metadata, path)
         VALUES (?, ?, 'utente', 'admin', 'admin', ?, '["utente","admin"]', ?, '/entity/utente/admin')`
      ).run(userId, aziendaId, 'admin@fiai.it', JSON.stringify({
        password_hash: passwordHash,
        cognome: '',
        ruolo: 'admin',
        tts_voice: 'Vivian',
      }))
      console.log(`Created admin user: admin@fiai.it (${userId})`)

      // Create membro_di relation
      db.prepare(
        `INSERT INTO relations (id, azienda_id, from_id, to_id, tipo)
         VALUES (?, ?, ?, ?, 'membro_di')`
      ).run(crypto.randomUUID(), aziendaId, userId, aziendaId)

      // Create default permission groups
      const groups = [
        { name: 'Amministratori', slug: 'amministratori', permissions: { '*': ['read', 'create', 'update', 'delete', 'send'] } },
        { name: 'Operatori', slug: 'operatori', permissions: { '*': ['read', 'create', 'update'] } },
        { name: 'Lettori', slug: 'lettori', permissions: { '*': ['read'] } },
      ]
      for (const g of groups) {
        const groupId = crypto.randomUUID()
        db.prepare(
          `INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path)
           VALUES (?, ?, 'gruppo', ?, ?, ?, ?)`
        ).run(groupId, aziendaId, g.name, g.slug, JSON.stringify({ permissions: g.permissions }), `/entity/gruppo/${g.slug}`)

        // Add admin to Amministratori group
        if (g.slug === 'amministratori') {
          db.prepare(
            `INSERT INTO relations (id, azienda_id, from_id, to_id, tipo)
             VALUES (?, ?, ?, ?, 'membro_di_gruppo')`
          ).run(crypto.randomUUID(), aziendaId, userId, groupId)
        }
      }
      console.log('Created default permission groups')
    })

    seedTx()
    console.log('\nSeed completed successfully!')
    console.log('Login with: admin / password123')
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  }
}

seed()
