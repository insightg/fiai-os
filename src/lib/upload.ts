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
