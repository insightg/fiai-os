import bcrypt from 'bcryptjs'
import pool from './db.js'

async function seed() {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Check if admin user already exists
    const existing = await client.query("SELECT id FROM users WHERE email = 'admin@fiai.it'")
    if (existing.rows.length > 0) {
      console.log('Seed data already exists, skipping.')
      await client.query('COMMIT')
      return
    }

    // Create default azienda
    const aziendaResult = await client.query(
      `INSERT INTO aziende (nome, piva, email)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['FIAI - Fabbrica Italiana Agenti Intelligenti Srl', '12345678901', 'info@fiai.it']
    )
    const aziendaId = aziendaResult.rows[0].id
    console.log(`Created azienda: ${aziendaId}`)

    // Create admin user
    const passwordHash = await bcrypt.hash('password123', 10)
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      ['admin@fiai.it', passwordHash]
    )
    const user = userResult.rows[0]
    console.log(`Created user: ${user.email} (${user.id})`)

    // Create user profile
    await client.query(
      `INSERT INTO user_profiles (id, azienda_id, email, nome, cognome, ruolo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, aziendaId, user.email, 'Admin', 'FIAI', 'admin']
    )
    console.log('Created user profile')

    // Create a default conto
    await client.query(
      `INSERT INTO conti (azienda_id, nome, tipo, saldo, iban, banca)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [aziendaId, 'Conto Principale', 'banca', 10000, 'IT60X0542811101000000123456', 'Banca Esempio']
    )
    console.log('Created default conto')

    await client.query('COMMIT')
    console.log('\nSeed completed successfully!')
    console.log('Login with: admin@fiai.it / password123')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
