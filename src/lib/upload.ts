import { getAuthToken } from './supabase'

export interface UploadResult {
  url?: string
  fileUrl?: string
  originalName: string
  size: number
  mimeType: string
  extractedText: string
  suggestedCategoria: string
  suggestedTags: string[]
  suggestedDescrizione: string
  recognizedData?: Record<string, unknown>
}

export async function uploadFile(file: File, endpoint: string): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: 'Upload fallito' } }))
    throw new Error(err.error?.message || 'Upload fallito')
  }

  return res.json()
}

export async function uploadFatturaPassiva(file: File) {
  return uploadFile(file, '/api/upload/fattura-passiva')
}

export async function uploadDocumento(file: File) {
  return uploadFile(file, '/api/upload/documento')
}

export async function uploadGeneric(file: File) {
  return uploadFile(file, '/api/upload')
}

// ── Smart Upload (unified, AI-powered) ──

export interface SmartUploadResult {
  entity_id: string
  file_url: string
  entity_type: string
  display_name: string
  categoria: string
  tags: string[]
  descrizione: string
  extracted_data: Record<string, unknown>
  matched_name: { id: string; display_name: string } | null
  suggested_name: string | null
  file_size: number
  chunked?: boolean
  chunk_count?: number
}

export async function uploadSmart(file: File, mode: 'full' | 'compact' | 'none' = 'full'): Promise<SmartUploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mode', mode)

  const headers: Record<string, string> = {}
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch('/api/upload/smart', {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload fallito' }))
    throw new Error(err.error || 'Upload fallito')
  }

  return res.json()
}
