import type { CostoSimulazioneInput, CostoSimulazioneResult } from '../types'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
const MODEL = 'z-ai/glm-5'

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Errore AI: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Simulatore Costo Dipendente ──────────────────────────

export async function simulateCostoDipendente(params: CostoSimulazioneInput): Promise<CostoSimulazioneResult> {
  const systemPrompt = `Sei un esperto consulente del lavoro italiano. Calcola il costo aziendale totale partendo dal netto desiderato dal dipendente. Considera le aliquote INPS (circa 9.19% dipendente, ~30% azienda), INAIL (~0.4%), TFR (RAL/13.5), IRAP (~3.9% sulla RAL), IRPEF con scaglioni 2024 (23% fino a 28k, 35% fino a 50k, 43% oltre), addizionali regionali e comunali medie.

Restituisci SOLO un oggetto JSON valido con questa struttura:
{
  "ral": numero,
  "netto_mensile": numero,
  "contributi_inps_dipendente": numero_annuo,
  "contributi_inps_azienda": numero_annuo,
  "inail": numero_annuo,
  "tfr_annuo": numero,
  "irap": numero_annuo,
  "irpef": numero_annuo,
  "addizionale_regionale": numero_annuo,
  "addizionale_comunale": numero_annuo,
  "costo_totale_azienda": numero_annuo,
  "spiegazione": "spiegazione dettagliata del calcolo in italiano"
}`

  const userPrompt = `Calcola il costo aziendale per:
- Netto desiderato: ${params.netto_desiderato}€/mese
- Tipo contratto: ${params.tipo_contratto}
- Livello CCNL: ${params.livello_ccnl}
- Regione: ${params.regione}
- Part-time: ${params.part_time_percent}%`

  const response = await callLLM(systemPrompt, userPrompt)
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Risposta AI non valida')
  return JSON.parse(jsonMatch[0])
}

// ── Generatore Annunci Lavoro ────────────────────────────

export async function generateAnnuncioLavoro(params: {
  ruolo: string
  competenze: string
  tipo_contratto: string
  sede: string
  ral_min?: number
  ral_max?: number
  descrizione_azienda?: string
}): Promise<string> {
  const systemPrompt = `Sei un esperto di recruiting e HR. Genera un annuncio di lavoro professionale in italiano, ben strutturato e accattivante. L'annuncio deve includere:
- Titolo della posizione
- Chi siamo (breve descrizione azienda)
- La posizione
- Requisiti
- Cosa offriamo
- Come candidarsi

Usa un tono professionale ma moderno.`

  const userPrompt = `Genera un annuncio di lavoro con questi parametri:
- Ruolo: ${params.ruolo}
- Competenze richieste: ${params.competenze}
- Tipo contratto: ${params.tipo_contratto}
- Sede: ${params.sede}
${params.ral_min && params.ral_max ? `- RAL: ${params.ral_min}€ - ${params.ral_max}€` : ''}
${params.descrizione_azienda ? `- Descrizione azienda: ${params.descrizione_azienda}` : '- Azienda: FIAI - Fabbrica Italiana Agenti Intelligenti'}`

  return callLLM(systemPrompt, userPrompt)
}
