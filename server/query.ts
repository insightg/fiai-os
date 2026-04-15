import { Router, Response } from 'express'
import crypto from 'crypto'
import db from './db.js'
import { AuthRequest, authMiddleware } from './middleware.js'

const router = Router()

// ── Types ───────────────────────────────────────────────────

interface QueryFilter {
  column: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not.in' | 'not.eq' | 'like' | 'ilike'
  value: unknown
}

interface QueryRequest {
  table: string
  operation: 'select' | 'insert' | 'update' | 'delete'
  select?: string
  data?: Record<string, unknown> | Record<string, unknown>[]
  filters?: QueryFilter[]
  order?: { column: string; ascending: boolean }
  limit?: number
  single?: boolean
  count?: 'exact'
  head?: boolean
}

interface ParsedRelation {
  alias: string
  foreignTable: string
  columns: string  // '*' or 'col1, col2'
}

// ── Allowed tables (whitelist for safety) ───────────────────

const ALLOWED_TABLES = new Set([
  // VFS unified model
  'entity', 'relations',
  // Chat
  'chat_sessions', 'chat_messages',
])

// ── Known FK mappings for joins ─────────────────────────────

interface FKMapping {
  foreignTable: string
  fkColumn: string
  fkTarget: string
  type: 'many-to-one' | 'one-to-many'
}

function resolveForeignKey(mainTable: string, alias: string, foreignTable: string): FKMapping {
  const oneToManyPatterns: Record<string, Record<string, { fkColumn: string }>> = {
    fatture: {
      righe: { fkColumn: 'fattura_id' },
    },
    preventivi: {
      righe: { fkColumn: 'preventivo_id' },
    },
    // v5 VFS
    entity: {
      children: { fkColumn: 'parent_id' },
      righe: { fkColumn: 'parent_id' },
    },
    names: {
      entities: { fkColumn: 'name_id' },
    },
  }

  const otm = oneToManyPatterns[mainTable]?.[alias]
  if (otm) {
    return {
      foreignTable,
      fkColumn: otm.fkColumn,
      fkTarget: 'id',
      type: 'one-to-many',
    }
  }

  return {
    foreignTable,
    fkColumn: `${alias}_id`,
    fkTarget: 'id',
    type: 'many-to-one',
  }
}

// ── Parse select string ─────────────────────────────────────

function parseSelect(selectStr: string): { columns: string[]; relations: ParsedRelation[] } {
  if (!selectStr || selectStr.trim() === '') {
    return { columns: ['*'], relations: [] }
  }

  const columns: string[] = []
  const relations: ParsedRelation[] = []

  const parts = splitTopLevel(selectStr)

  for (const part of parts) {
    const trimmed = part.trim()
    const relationMatch = trimmed.match(/^(\w+):(\w+)\(([^)]*)\)$/)
    if (relationMatch) {
      relations.push({
        alias: relationMatch[1],
        foreignTable: relationMatch[2],
        columns: relationMatch[3].trim() || '*',
      })
    } else {
      columns.push(trimmed)
    }
  }

  return { columns, relations }
}

function splitTopLevel(str: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const ch of str) {
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) {
    parts.push(current)
  }

  return parts
}

// ── Build WHERE clause from filters ─────────────────────────

function buildWhereClause(
  filters: QueryFilter[],
  tableAlias?: string
): { clause: string; values: unknown[] } {
  if (!filters || filters.length === 0) {
    return { clause: '', values: [] }
  }

  const conditions: string[] = []
  const values: unknown[] = []

  for (const filter of filters) {
    const col = tableAlias ? `${tableAlias}."${filter.column}"` : `"${filter.column}"`

    switch (filter.operator) {
      case 'eq':
        if (filter.value === null) {
          conditions.push(`${col} IS NULL`)
        } else {
          conditions.push(`${col} = ?`)
          values.push(filter.value)
        }
        break

      case 'neq':
      case 'not.eq':
        if (filter.value === null) {
          conditions.push(`${col} IS NOT NULL`)
        } else {
          conditions.push(`${col} != ?`)
          values.push(filter.value)
        }
        break

      case 'gt':
        conditions.push(`${col} > ?`)
        values.push(filter.value)
        break

      case 'gte':
        conditions.push(`${col} >= ?`)
        values.push(filter.value)
        break

      case 'lt':
        conditions.push(`${col} < ?`)
        values.push(filter.value)
        break

      case 'lte':
        conditions.push(`${col} <= ?`)
        values.push(filter.value)
        break

      case 'in': {
        const arr = Array.isArray(filter.value) ? filter.value : parseInValue(filter.value)
        if (arr.length === 0) {
          conditions.push('0') // FALSE equivalent
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          conditions.push(`${col} IN (${placeholders})`)
          values.push(...arr)
        }
        break
      }

      case 'not.in': {
        const arr = Array.isArray(filter.value) ? filter.value : parseInValue(filter.value)
        if (arr.length === 0) {
          // NOT IN empty set is always true, skip condition
        } else {
          const placeholders = arr.map(() => '?').join(', ')
          conditions.push(`${col} NOT IN (${placeholders})`)
          values.push(...arr)
        }
        break
      }

      case 'like':
        conditions.push(`${col} LIKE ?`)
        values.push(filter.value)
        break

      case 'ilike':
        conditions.push(`${col} LIKE ? COLLATE NOCASE`)
        values.push(filter.value)
        break
    }
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  return { clause, values }
}

/**
 * Parse Supabase-style IN value strings like '("perso","convertito")' into an array
 */
function parseInValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/^\((.*)\)$/)
    if (match) {
      return match[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    }
    return [value]
  }
  return [value]
}

// ── Helper: get all columns of a table for json_object building ──

function getTableColumns(tableName: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info("${tableName}")`)
  const rows = stmt.all() as { name: string }[]
  return rows.map(r => r.name)
}

// ── SELECT handler ──────────────────────────────────────────

function handleSelect(body: QueryRequest): { data: unknown; error: unknown; count?: number } {
  const { table, select: selectStr, filters, order, limit, single, count, head } = body

  const { columns, relations } = parseSelect(selectStr || '*')

  // If head + count mode: just return count
  if (head && count === 'exact') {
    const { clause, values } = buildWhereClause(filters || [])
    const sql = `SELECT COUNT(*) as count FROM "${table}"${clause}`
    const result = db.prepare(sql).get(...values) as { count: number }
    return { data: null, error: null, count: result.count }
  }

  // Separate many-to-one relations (JOIN) from one-to-many relations (separate query)
  const manyToOneRelations: (ParsedRelation & FKMapping)[] = []
  const oneToManyRelations: (ParsedRelation & FKMapping)[] = []

  for (const rel of relations) {
    const fk = resolveForeignKey(table, rel.alias, rel.foreignTable)
    const combined = { ...rel, ...fk }
    if (fk.type === 'many-to-one') {
      manyToOneRelations.push(combined)
    } else {
      oneToManyRelations.push(combined)
    }
  }

  // Build the main SELECT columns
  let selectColumns: string
  const mainAlias = 't'

  if (columns.includes('*')) {
    selectColumns = `${mainAlias}.*`
  } else {
    selectColumns = columns.map(c => `${mainAlias}."${c}"`).join(', ')
  }

  // Add many-to-one relation columns using json_object for nesting
  const joinClauses: string[] = []
  for (const rel of manyToOneRelations) {
    const relAlias = `_${rel.alias}`
    joinClauses.push(
      `LEFT JOIN "${rel.foreignTable}" AS ${relAlias} ON ${mainAlias}."${rel.fkColumn}" = ${relAlias}."${rel.fkTarget}"`
    )
    let relCols: string[]
    if (rel.columns === '*') {
      relCols = getTableColumns(rel.foreignTable)
    } else {
      relCols = rel.columns.split(',').map(c => c.trim())
    }
    const jsonParts = relCols.map(c => `'${c}', ${relAlias}."${c}"`).join(', ')
    selectColumns += `, json_object(${jsonParts}) AS "${rel.alias}"`
  }

  // Build the full query
  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [], mainAlias)

  let sql = `SELECT ${selectColumns} FROM "${table}" AS ${mainAlias}`
  if (joinClauses.length > 0) {
    sql += ' ' + joinClauses.join(' ')
  }
  sql += whereClause

  if (order) {
    sql += ` ORDER BY ${mainAlias}."${order.column}" ${order.ascending ? 'ASC' : 'DESC'}`
  }

  if (limit) {
    sql += ` LIMIT ${parseInt(String(limit), 10)}`
  }

  let data = db.prepare(sql).all(...whereValues) as Record<string, unknown>[]

  // Parse JSON strings from json_object() back into objects
  if (manyToOneRelations.length > 0) {
    data = data.map(row => {
      const newRow = { ...row }
      for (const rel of manyToOneRelations) {
        const val = newRow[rel.alias]
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val)
            // If all values are null, the LEFT JOIN didn't match — return null
            const allNull = Object.values(parsed).every(v => v === null)
            newRow[rel.alias] = allNull ? null : parsed
          } catch {
            // keep as-is
          }
        }
      }
      return newRow
    })
  }

  // Parse JSON string fields back to objects (tool_calls, tags, metadata, etc.)
  const JSON_FIELDS = new Set(['tool_calls', 'tags', 'metadata'])
  data = data.map(row => {
    const newRow = { ...row }
    for (const key of Object.keys(newRow)) {
      if (JSON_FIELDS.has(key) && typeof newRow[key] === 'string') {
        try { newRow[key] = JSON.parse(newRow[key] as string) } catch { /* keep as-is */ }
      }
    }
    // Sanitize: never expose password_hash in API responses
    if (newRow.metadata && typeof newRow.metadata === 'object' && (newRow.metadata as any).password_hash) {
      delete (newRow.metadata as any).password_hash
    }
    return newRow
  })

  // Handle count
  let totalCount: number | undefined
  if (count === 'exact') {
    const joinStr = joinClauses.length > 0 ? ' ' + joinClauses.join(' ') : ''
    const countSql = `SELECT COUNT(*) as count FROM "${table}" AS ${mainAlias}${joinStr}${whereClause}`
    const countResult = db.prepare(countSql).get(...whereValues) as { count: number }
    totalCount = countResult.count
  }

  // Handle one-to-many relations (separate queries for each)
  if (oneToManyRelations.length > 0 && data.length > 0) {
    const parentIds = data.map(row => row.id)

    for (const rel of oneToManyRelations) {
      let relSelect: string
      if (rel.columns === '*') {
        relSelect = '*'
      } else {
        relSelect = rel.columns.split(',').map(c => `"${c.trim()}"`).join(', ')
        if (!relSelect.includes(rel.fkColumn)) {
          relSelect += `, "${rel.fkColumn}"`
        }
      }

      const placeholders = parentIds.map(() => '?').join(', ')
      let relRows: Record<string, unknown>[]

      try {
        const relSql = `SELECT ${relSelect} FROM "${rel.foreignTable}" WHERE "${rel.fkColumn}" IN (${placeholders}) ORDER BY "ordine" ASC`
        relRows = db.prepare(relSql).all(...parentIds) as Record<string, unknown>[]
      } catch {
        // If ordering by "ordine" fails (column doesn't exist), try without it
        const relSqlFallback = `SELECT ${relSelect} FROM "${rel.foreignTable}" WHERE "${rel.fkColumn}" IN (${placeholders})`
        relRows = db.prepare(relSqlFallback).all(...parentIds) as Record<string, unknown>[]
      }

      // Group by FK
      const grouped: Record<string, unknown[]> = {}
      for (const row of relRows) {
        const fkValue = String(row[rel.fkColumn])
        if (!grouped[fkValue]) grouped[fkValue] = []
        grouped[fkValue].push(row)
      }

      // Nest into parent rows
      data = data.map(row => ({
        ...row,
        [rel.alias]: grouped[String(row.id)] || [],
      }))
    }
  }

  // Handle single mode
  if (single) {
    if (data.length === 0) {
      return { data: null, error: { message: 'Nessun risultato trovato', code: 'PGRST116' } }
    }
    return { data: data[0], error: null, count: totalCount }
  }

  return { data, error: null, count: totalCount }
}

// ── INSERT handler ──────────────────────────────────────────

function handleInsert(body: QueryRequest): { data: unknown; error: unknown } {
  const { table, data: insertData, select: selectStr, single } = body

  if (!insertData) {
    return { data: null, error: { message: 'Dati mancanti per insert', code: 'INVALID_REQUEST' } }
  }

  const rows = Array.isArray(insertData) ? insertData : [insertData]
  const insertedRows: Record<string, unknown>[] = []

  for (const row of rows) {
    // Generate UUID if not provided
    if (!row.id) {
      row.id = crypto.randomUUID()
    }

    const keys = Object.keys(row)
    const values = Object.values(row).map(v => {
      // SQLite can't store objects/arrays — serialize as JSON string
      if (v !== null && typeof v === 'object') return JSON.stringify(v)
      return v
    })
    const placeholders = keys.map(() => '?')

    const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')})`
    db.prepare(sql).run(...values)

    // Fetch the inserted row
    const inserted = db.prepare(`SELECT * FROM "${table}" WHERE "id" = ?`).get(row.id) as Record<string, unknown>
    insertedRows.push(inserted)
  }

  // If select includes relations, re-fetch with joins
  let finalData: unknown[] = insertedRows
  if (selectStr && selectStr.includes(':')) {
    const ids = insertedRows.map(r => r.id)
    const refetchBody: QueryRequest = {
      table,
      operation: 'select',
      select: selectStr,
      filters: [{ column: 'id', operator: 'in', value: ids }],
    }
    const refetchResult = handleSelect(refetchBody)
    if (!refetchResult.error) {
      finalData = refetchResult.data as unknown[]
    }
  }

  if (single || !Array.isArray(body.data)) {
    return { data: finalData[0] || null, error: null }
  }

  return { data: finalData, error: null }
}

// ── UPDATE handler ──────────────────────────────────────────

function handleUpdate(body: QueryRequest): { data: unknown; error: unknown } {
  const { table, data: updateData, filters, select: selectStr, single } = body

  if (!updateData || Array.isArray(updateData)) {
    return { data: null, error: { message: 'Dati mancanti per update', code: 'INVALID_REQUEST' } }
  }

  const keys = Object.keys(updateData)
  const values = Object.values(updateData).map(v => {
    if (v !== null && typeof v === 'object') return JSON.stringify(v)
    return v
  })

  const setClauses = keys.map(k => `"${k}" = ?`)

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [])

  // First get the IDs of rows that will be updated
  const selectSql = `SELECT "id" FROM "${table}"${whereClause}`
  const idsToUpdate = (db.prepare(selectSql).all(...whereValues) as { id: string }[]).map(r => r.id)

  // Perform the update
  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')}${whereClause}`
  const allValues = [...values, ...whereValues]
  db.prepare(sql).run(...allValues)

  // Fetch the updated rows
  let updatedRows: Record<string, unknown>[] = []
  if (idsToUpdate.length > 0) {
    const placeholders = idsToUpdate.map(() => '?').join(', ')
    updatedRows = db.prepare(`SELECT * FROM "${table}" WHERE "id" IN (${placeholders})`).all(...idsToUpdate) as Record<string, unknown>[]
  }

  let finalData: unknown = updatedRows
  if (selectStr && selectStr.includes(':') && updatedRows.length > 0) {
    const ids = updatedRows.map(r => r.id)
    const refetchBody: QueryRequest = {
      table,
      operation: 'select',
      select: selectStr,
      filters: [{ column: 'id', operator: 'in', value: ids }],
    }
    const refetchResult = handleSelect(refetchBody)
    if (!refetchResult.error) {
      finalData = refetchResult.data
    }
  }

  if (single) {
    const arr = Array.isArray(finalData) ? finalData : [finalData]
    return { data: arr[0] || null, error: null }
  }

  return { data: finalData, error: null }
}

// ── DELETE handler ──────────────────────────────────────────

function handleDelete(body: QueryRequest): { data: unknown; error: unknown } {
  const { table, filters } = body

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [])

  // Fetch rows before deleting
  const selectSql = `SELECT * FROM "${table}"${whereClause}`
  const rowsToDelete = db.prepare(selectSql).all(...whereValues)

  const sql = `DELETE FROM "${table}"${whereClause}`
  db.prepare(sql).run(...whereValues)

  return { data: rowsToDelete, error: null }
}

// ── Route ───────────────────────────────────────────────────

router.post('/', authMiddleware(false), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as QueryRequest

    if (!body.table || !body.operation) {
      res.status(400).json({ data: null, error: { message: 'table e operation sono richiesti', code: 'INVALID_REQUEST' } })
      return
    }

    if (!ALLOWED_TABLES.has(body.table)) {
      res.status(400).json({ data: null, error: { message: `Tabella non consentita: ${body.table}`, code: 'INVALID_TABLE' } })
      return
    }

    let result: { data: unknown; error: unknown; count?: number }

    switch (body.operation) {
      case 'select':
        result = handleSelect(body)
        break
      case 'insert':
        result = handleInsert(body)
        break
      case 'update':
        result = handleUpdate(body)
        break
      case 'delete':
        result = handleDelete(body)
        break
      default:
        res.status(400).json({ data: null, error: { message: `Operazione non supportata: ${body.operation}`, code: 'INVALID_OPERATION' } })
        return
    }

    if (result.error) {
      res.status(400).json(result)
      return
    }

    res.json(result)
  } catch (err) {
    console.error('Query error:', err)
    const message = err instanceof Error ? err.message : 'Errore sconosciuto'
    res.status(500).json({ data: null, error: { message, code: 'INTERNAL_ERROR' } })
  }
})

export default router
