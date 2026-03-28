import { Router, Response } from 'express'
import pool from './db.js'
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
  'aziende', 'user_profiles', 'clienti', 'leads', 'preventivi', 'preventivo_righe',
  'ordini', 'progetti', 'fatture', 'fattura_righe', 'ricorrenti', 'fornitori',
  'fatture_passive', 'conti', 'movimenti', 'rimborsi', 'chat_sessions', 'chat_messages',
  'users', 'candidati', 'annunci_lavoro', 'documenti',
])

// ── Known FK mappings for joins ─────────────────────────────
// Maps: { "fromTable:alias" => { foreignTable, fkColumn, fkTarget, type } }
// type: 'many-to-one' = the FK is on fromTable pointing to foreignTable
// type: 'one-to-many' = the FK is on foreignTable pointing to fromTable

interface FKMapping {
  foreignTable: string
  fkColumn: string
  fkTarget: string
  type: 'many-to-one' | 'one-to-many'
}

function resolveForeignKey(mainTable: string, alias: string, foreignTable: string): FKMapping {
  // One-to-many patterns: righe on child table pointing back to parent
  const oneToManyPatterns: Record<string, Record<string, { fkColumn: string }>> = {
    fatture: {
      righe: { fkColumn: 'fattura_id' },
    },
    preventivi: {
      righe: { fkColumn: 'preventivo_id' },
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

  // Many-to-one: the main table has a FK column like `{alias}_id` pointing to foreignTable.id
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

  // We need to split on commas that are NOT inside parentheses
  const parts = splitTopLevel(selectStr)

  for (const part of parts) {
    const trimmed = part.trim()
    // Check if it's a relation pattern: alias:foreign_table(columns)
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
  paramOffset: number,
  tableAlias?: string
): { clause: string; values: unknown[] } {
  if (!filters || filters.length === 0) {
    return { clause: '', values: [] }
  }

  const conditions: string[] = []
  const values: unknown[] = []
  let paramIndex = paramOffset

  for (const filter of filters) {
    const col = tableAlias ? `${tableAlias}."${filter.column}"` : `"${filter.column}"`

    switch (filter.operator) {
      case 'eq':
        if (filter.value === null) {
          conditions.push(`${col} IS NULL`)
        } else {
          paramIndex++
          conditions.push(`${col} = $${paramIndex}`)
          values.push(filter.value)
        }
        break

      case 'neq':
      case 'not.eq':
        if (filter.value === null) {
          conditions.push(`${col} IS NOT NULL`)
        } else {
          paramIndex++
          conditions.push(`${col} != $${paramIndex}`)
          values.push(filter.value)
        }
        break

      case 'gt':
        paramIndex++
        conditions.push(`${col} > $${paramIndex}`)
        values.push(filter.value)
        break

      case 'gte':
        paramIndex++
        conditions.push(`${col} >= $${paramIndex}`)
        values.push(filter.value)
        break

      case 'lt':
        paramIndex++
        conditions.push(`${col} < $${paramIndex}`)
        values.push(filter.value)
        break

      case 'lte':
        paramIndex++
        conditions.push(`${col} <= $${paramIndex}`)
        values.push(filter.value)
        break

      case 'in': {
        const arr = Array.isArray(filter.value) ? filter.value : parseInValue(filter.value)
        if (arr.length === 0) {
          conditions.push('FALSE')
        } else {
          const placeholders = arr.map(() => {
            paramIndex++
            return `$${paramIndex}`
          })
          conditions.push(`${col} IN (${placeholders.join(', ')})`)
          values.push(...arr)
        }
        break
      }

      case 'not.in': {
        const arr = Array.isArray(filter.value) ? filter.value : parseInValue(filter.value)
        if (arr.length === 0) {
          // NOT IN empty set is always true, skip condition
        } else {
          const placeholders = arr.map(() => {
            paramIndex++
            return `$${paramIndex}`
          })
          conditions.push(`${col} NOT IN (${placeholders.join(', ')})`)
          values.push(...arr)
        }
        break
      }

      case 'like':
        paramIndex++
        conditions.push(`${col} LIKE $${paramIndex}`)
        values.push(filter.value)
        break

      case 'ilike':
        paramIndex++
        conditions.push(`${col} ILIKE $${paramIndex}`)
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
    // Handle format: ("val1","val2") or (val1,val2)
    const match = value.match(/^\((.*)\)$/)
    if (match) {
      return match[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    }
    return [value]
  }
  return [value]
}

// ── SELECT handler ──────────────────────────────────────────

async function handleSelect(body: QueryRequest): Promise<{ data: unknown; error: unknown; count?: number }> {
  const { table, select: selectStr, filters, order, limit, single, count, head } = body

  const { columns, relations } = parseSelect(selectStr || '*')

  // If head + count mode: just return count
  if (head && count === 'exact') {
    const { clause, values } = buildWhereClause(filters || [], 0)
    const sql = `SELECT COUNT(*) as count FROM "${table}"${clause}`
    const result = await pool.query(sql, values)
    const totalCount = parseInt(result.rows[0].count, 10)
    return { data: null, error: null, count: totalCount }
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

  // Add many-to-one relation columns using row_to_json for nesting
  const joinClauses: string[] = []
  for (const rel of manyToOneRelations) {
    const relAlias = `_${rel.alias}`
    joinClauses.push(
      `LEFT JOIN "${rel.foreignTable}" AS ${relAlias} ON ${mainAlias}."${rel.fkColumn}" = ${relAlias}."${rel.fkTarget}"`
    )
    if (rel.columns === '*') {
      selectColumns += `, row_to_json(${relAlias}) AS "${rel.alias}"`
    } else {
      const relCols = rel.columns.split(',').map(c => c.trim())
      const jsonParts = relCols.map(c => `'${c}', ${relAlias}."${c}"`).join(', ')
      selectColumns += `, json_build_object(${jsonParts}) AS "${rel.alias}"`
    }
  }

  // Build the full query
  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [], 0, mainAlias)

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

  const result = await pool.query(sql, whereValues)
  let data = result.rows

  // Handle count
  let totalCount: number | undefined
  if (count === 'exact') {
    const countSql = `SELECT COUNT(*) as count FROM "${table}" AS ${mainAlias}${joinClauses.join(' ')}${whereClause}`
    const countResult = await pool.query(countSql, whereValues)
    totalCount = parseInt(countResult.rows[0].count, 10)
  }

  // Handle one-to-many relations (separate queries for each)
  if (oneToManyRelations.length > 0 && data.length > 0) {
    const parentIds = data.map(row => (row as Record<string, unknown>).id)

    for (const rel of oneToManyRelations) {
      let relSelect: string
      if (rel.columns === '*') {
        relSelect = '*'
      } else {
        relSelect = rel.columns.split(',').map(c => `"${c.trim()}"`).join(', ')
        // Always include the FK column for matching
        if (!relSelect.includes(rel.fkColumn)) {
          relSelect += `, "${rel.fkColumn}"`
        }
      }

      const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ')
      const relSql = `SELECT ${relSelect} FROM "${rel.foreignTable}" WHERE "${rel.fkColumn}" IN (${placeholders}) ORDER BY "ordine" ASC`

      try {
        const relResult = await pool.query(relSql, parentIds)

        // Group by FK
        const grouped: Record<string, unknown[]> = {}
        for (const row of relResult.rows) {
          const fkValue = String((row as Record<string, unknown>)[rel.fkColumn])
          if (!grouped[fkValue]) grouped[fkValue] = []
          grouped[fkValue].push(row)
        }

        // Nest into parent rows
        data = data.map(row => ({
          ...(row as Record<string, unknown>),
          [rel.alias]: grouped[String((row as Record<string, unknown>).id)] || [],
        })) as typeof data
      } catch {
        // If ordering by "ordine" fails (column doesn't exist), try without it
        const relSqlFallback = `SELECT ${relSelect} FROM "${rel.foreignTable}" WHERE "${rel.fkColumn}" IN (${placeholders})`
        const relResult = await pool.query(relSqlFallback, parentIds)

        const grouped: Record<string, unknown[]> = {}
        for (const row of relResult.rows) {
          const fkValue = String((row as Record<string, unknown>)[rel.fkColumn])
          if (!grouped[fkValue]) grouped[fkValue] = []
          grouped[fkValue].push(row)
        }

        data = data.map(row => ({
          ...(row as Record<string, unknown>),
          [rel.alias]: grouped[String((row as Record<string, unknown>).id)] || [],
        })) as typeof data
      }
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

async function handleInsert(body: QueryRequest): Promise<{ data: unknown; error: unknown }> {
  const { table, data: insertData, select: selectStr, single } = body

  if (!insertData) {
    return { data: null, error: { message: 'Dati mancanti per insert', code: 'INVALID_REQUEST' } }
  }

  const rows = Array.isArray(insertData) ? insertData : [insertData]
  const insertedRows: Record<string, unknown>[] = []

  for (const row of rows) {
    const keys = Object.keys(row)
    const values = Object.values(row)
    const placeholders = keys.map((_, i) => `$${i + 1}`)

    const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
    const result = await pool.query(sql, values)
    insertedRows.push(result.rows[0])
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
    const refetchResult = await handleSelect(refetchBody)
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

async function handleUpdate(body: QueryRequest): Promise<{ data: unknown; error: unknown }> {
  const { table, data: updateData, filters, select: selectStr, single } = body

  if (!updateData || Array.isArray(updateData)) {
    return { data: null, error: { message: 'Dati mancanti per update', code: 'INVALID_REQUEST' } }
  }

  const keys = Object.keys(updateData)
  const values = Object.values(updateData)

  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`)

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [], keys.length)

  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')}${whereClause} RETURNING *`
  const allValues = [...values, ...whereValues]

  const result = await pool.query(sql, allValues)

  let finalData: unknown = result.rows
  if (selectStr && selectStr.includes(':') && result.rows.length > 0) {
    const ids = result.rows.map(r => (r as Record<string, unknown>).id)
    const refetchBody: QueryRequest = {
      table,
      operation: 'select',
      select: selectStr,
      filters: [{ column: 'id', operator: 'in', value: ids }],
    }
    const refetchResult = await handleSelect(refetchBody)
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

async function handleDelete(body: QueryRequest): Promise<{ data: unknown; error: unknown }> {
  const { table, filters } = body

  const { clause: whereClause, values: whereValues } = buildWhereClause(filters || [], 0)

  const sql = `DELETE FROM "${table}"${whereClause} RETURNING *`
  const result = await pool.query(sql, whereValues)

  return { data: result.rows, error: null }
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
        result = await handleSelect(body)
        break
      case 'insert':
        result = await handleInsert(body)
        break
      case 'update':
        result = await handleUpdate(body)
        break
      case 'delete':
        result = await handleDelete(body)
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
