const API_URL = import.meta.env.VITE_API_URL || '/api'

// Auth token management (in-memory only, no localStorage)
let authToken: string | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

export function getAuthToken(): string | null {
  return authToken
}

function getHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  return headers
}

class QueryBuilder {
  private _table: string
  private _operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private _select: string = '*'
  private _data: any = null
  private _filters: Array<{ column: string; operator: string; value: any }> = []
  private _order: { column: string; ascending: boolean } | null = null
  private _limit: number | null = null
  private _single: boolean = false
  private _count: string | null = null
  private _head: boolean = false

  constructor(table: string) {
    this._table = table
  }

  select(columns: string = '*', options?: { count?: 'exact'; head?: boolean }) {
    // Only set operation to 'select' if no other operation (insert/update/delete) was set
    if (this._operation === 'select') {
      this._operation = 'select'
    }
    this._select = columns
    if (options?.count) this._count = options.count
    if (options?.head) this._head = options.head
    return this
  }

  insert(data: any) {
    this._operation = 'insert'
    this._data = data
    return this
  }

  update(data: any) {
    this._operation = 'update'
    this._data = data
    return this
  }

  delete() {
    this._operation = 'delete'
    return this
  }

  eq(column: string, value: any) {
    this._filters.push({ column, operator: 'eq', value })
    return this
  }

  neq(column: string, value: any) {
    this._filters.push({ column, operator: 'neq', value })
    return this
  }

  gt(column: string, value: any) {
    this._filters.push({ column, operator: 'gt', value })
    return this
  }

  gte(column: string, value: any) {
    this._filters.push({ column, operator: 'gte', value })
    return this
  }

  lt(column: string, value: any) {
    this._filters.push({ column, operator: 'lt', value })
    return this
  }

  lte(column: string, value: any) {
    this._filters.push({ column, operator: 'lte', value })
    return this
  }

  in(column: string, values: any[]) {
    this._filters.push({ column, operator: 'in', value: values })
    return this
  }

  not(column: string, operator: string, value: any) {
    this._filters.push({ column, operator: `not.${operator}`, value })
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this._order = { column, ascending: options?.ascending ?? true }
    return this
  }

  limit(n: number) {
    this._limit = n
    return this
  }

  single() {
    this._single = true
    return this
  }

  // Execute the query by sending to backend
  async then(
    resolve: (value: any) => void,
    reject?: (reason: any) => void
  ) {
    try {
      const body: Record<string, any> = {
        table: this._table,
        operation: this._operation,
        select: this._select,
        data: this._data,
      }
      if (this._filters.length > 0) body.filters = this._filters
      if (this._order) body.order = this._order
      if (this._limit !== null) body.limit = this._limit
      if (this._single) body.single = true
      if (this._count) body.count = this._count
      if (this._head) body.head = true

      const res = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      })

      const result = await res.json()
      resolve(result)
    } catch (err) {
      const error = { data: null, error: { message: (err as Error).message } }
      if (reject) reject(error)
      else resolve(error)
    }
  }
}

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (data.session?.access_token) {
        setAuthToken(data.session.access_token)
      }
      return { data, error: res.ok ? null : (data.error || { message: 'Login failed' }) }
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } }
    }
  },

  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: any } }) {
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...options?.data }),
      })
      const data = await res.json()
      if (data.session?.access_token) {
        setAuthToken(data.session.access_token)
      }
      return { data, error: res.ok ? null : (data.error || { message: 'Signup failed' }) }
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } }
    }
  },

  async signOut() {
    setAuthToken(null)
    return { error: null }
  },

  async getSession() {
    if (!authToken) return { data: { session: null }, error: null }
    try {
      const res = await fetch(`${API_URL}/auth/session`, {
        headers: getHeaders(),
      })
      if (!res.ok) {
        setAuthToken(null)
        return { data: { session: null }, error: null }
      }
      const data = await res.json()
      return { data, error: null }
    } catch {
      setAuthToken(null)
      return { data: { session: null }, error: null }
    }
  },

  async getUser() {
    if (!authToken) return { data: { user: null }, error: null }
    try {
      const res = await fetch(`${API_URL}/auth/session`, {
        headers: getHeaders(),
      })
      if (!res.ok) return { data: { user: null }, error: null }
      const data = await res.json()
      return { data: { user: data.user }, error: null }
    } catch {
      return { data: { user: null }, error: null }
    }
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    // Check current session on subscribe
    this.getSession().then(({ data }) => {
      callback(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session)
    })
    // Return a subscription object with unsubscribe
    return { data: { subscription: { unsubscribe: () => {} } } }
  },
}

export const supabase = {
  from: (table: string) => new QueryBuilder(table),
  auth,
}
