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

    // Check if admin user already exists
    const existing = db.prepare("SELECT id FROM users WHERE email = 'admin@fiai.it'").get()
    if (existing) {
      console.log('Seed data already exists, skipping.')
      return
    }

    const passwordHash = await bcrypt.hash('password123', 10)

    const seedTx = db.transaction(() => {
      // Create default azienda
      const aziendaId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO aziende (id, nome, piva, email)
         VALUES (?, ?, ?, ?)`
      ).run(aziendaId, 'FIAI - Fabbrica Italiana Agenti Intelligenti Srl', '12345678901', 'info@fiai.it')
      console.log(`Created azienda: ${aziendaId}`)

      // Create admin user
      const userId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO users (id, email, password_hash)
         VALUES (?, ?, ?)`
      ).run(userId, 'admin@fiai.it', passwordHash)
      console.log(`Created user: admin@fiai.it (${userId})`)

      // Create user profile
      db.prepare(
        `INSERT INTO user_profiles (id, azienda_id, email, nome, cognome, ruolo)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(userId, aziendaId, 'admin@fiai.it', 'Admin', 'FIAI', 'admin')
      console.log('Created user profile')

      // Create a default conto
      const contoId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO conti (id, azienda_id, nome, tipo, saldo, iban, banca)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(contoId, aziendaId, 'Conto Principale', 'banca', 10000, 'IT60X0542811101000000123456', 'Banca Esempio')
      console.log('Created default conto')
    })

    seedTx()
    console.log('\nSeed completed successfully!')
    console.log('Login with: admin@fiai.it / password123')
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  }
}

seed()
