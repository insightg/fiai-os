const API_URL = import.meta.env.VITE_ADMIN_API_URL || '/api'

let authToken: string | null = localStorage.getItem('admin_token')

export function setToken(token: string | null) {
  authToken = token
  if (token) localStorage.setItem('admin_token', token)
  else localStorage.removeItem('admin_token')
}

export function getToken(): string | null { return authToken }

async function request(path: string, options?: RequestInit) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> || {}) }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (res.status === 401 && !path.includes('/proxy')) {
    // Only redirect to login for OUR auth failures, not proxy errors
    setToken(null); window.location.href = '/login'; throw new Error('Unauthorized')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  // Auth
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // Instances
  getInstances: () => request('/instances'),
  getInstance: (id: string) => request(`/instances/${id}`),
  createInstance: (data: { id: string; company_name: string; company_color: string; template?: string }) => request('/instances', { method: 'POST', body: JSON.stringify(data) }),
  updateInstanceConfig: (id: string, config: any) => request(`/instances/${id}/config`, { method: 'PUT', body: JSON.stringify({ config }) }),
  updateInstanceYaml: (id: string, rawYaml: string) => request(`/instances/${id}/config`, { method: 'PUT', body: JSON.stringify({ rawYaml }) }),
  deleteInstance: (id: string) => request(`/instances/${id}`, { method: 'DELETE' }),

  // Agents
  getAgents: (instanceId: string) => request(`/instances/${instanceId}/agents`),
  getAgent: (instanceId: string, domain: string) => request(`/instances/${instanceId}/agents/${domain}`),
  updateAgent: (instanceId: string, domain: string, data: any) => request(`/instances/${instanceId}/agents/${domain}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAgent: (instanceId: string, domain: string) => request(`/instances/${instanceId}/agents/${domain}`, { method: 'DELETE' }),

  // Plugins & Tools
  getPlugins: () => request('/plugins'),
  getTools: () => request('/tools'),

  // Registry
  getRegistry: () => request('/registry'),
  updateRegistry: (id: string, data: any) => request(`/registry/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Reload instance config (hot reload — no restart needed)
  reloadInstance: (id: string) => request(`/instances/${id}/reload`, { method: 'POST' }),

  // Proxy to instance APIs (transparent forwarding)
  proxyGet: (instanceId: string, path: string) => request(`/instances/${instanceId}/proxy${path}`),
  proxyPost: (instanceId: string, path: string, data?: any) => request(`/instances/${instanceId}/proxy${path}`, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  proxyPut: (instanceId: string, path: string, data?: any) => request(`/instances/${instanceId}/proxy${path}`, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  proxyDelete: (instanceId: string, path: string) => request(`/instances/${instanceId}/proxy${path}`, { method: 'DELETE' }),

  // Health
  getHealth: () => request('/health'),
  getInstanceHealth: (id: string) => request(`/instances/${id}/health`),
  getInstanceStats: (id: string) => request(`/instances/${id}/stats`),
}
