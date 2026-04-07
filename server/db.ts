import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || '/app/data/fiai.db'

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Load sqlite-vec extension for vector search
try {
  const sqliteVec = await import('sqlite-vec')
  const loadablePath = sqliteVec.getLoadablePath()
  // better-sqlite3 auto-appends .so, but the path already has it — strip it
  const extPath = loadablePath.replace(/\.(so|dylib|dll)$/, '')
  db.loadExtension(extPath)
  console.log('[DB] sqlite-vec loaded:', db.prepare('SELECT vec_version()').pluck().get())
} catch (err) {
  console.warn('[DB] sqlite-vec not available, falling back to brute-force:', (err as Error).message)
}

export default db
