import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'

const router = Router()
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
const TEMPLATES_DIR = path.join(import.meta.dirname || '.', 'typst-templates')

// Ensure templates directory exists
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true })
}

// ── Generate PDF from Typst template ─────────────────────

router.post('/generate', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const { template, data, filename } = req.body
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    if (!template || !data) {
      res.status(400).json({ error: 'template e data sono richiesti' })
      return
    }

    // Build Typst source from template + data
    const typstSource = buildTypstSource(template, data, aziendaId)

    // Write temp .typ file
    const tmpDir = path.join(UPLOADS_DIR, 'tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const typFile = path.join(tmpDir, `${crypto.randomUUID()}.typ`)
    const pdfFile = typFile.replace('.typ', '.pdf')

    fs.writeFileSync(typFile, typstSource)

    // Compile with Typst
    try {
      execSync(`typst compile "${typFile}" "${pdfFile}"`, {
        timeout: 30000,
        stdio: 'pipe',
      })
    } catch (compileErr: any) {
      const stderr = compileErr.stderr?.toString() || compileErr.message
      console.error('Typst compilation error:', stderr)
      fs.unlinkSync(typFile)
      res.status(500).json({ error: `Errore compilazione Typst: ${stderr.substring(0, 200)}` })
      return
    }

    // Move PDF to user's uploads
    const outputDir = path.join(UPLOADS_DIR, aziendaId, userId, 'pdf')
    fs.mkdirSync(outputDir, { recursive: true })
    const outputName = `${filename || 'documento'}-${Date.now()}.pdf`
    const outputPath = path.join(outputDir, outputName)
    fs.renameSync(pdfFile, outputPath)

    // Cleanup
    fs.unlinkSync(typFile)

    const pdfUrl = `/api/uploads/${aziendaId}/${userId}/pdf/${outputName}`
    res.json({ url: pdfUrl, filename: outputName })
  } catch (err) {
    console.error('PDF generation error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── List available templates ─────────────────────────────

router.get('/templates', (_req, res: Response) => {
  const templates = [
    { id: 'report_finanziario', name: 'Report Finanziario', description: 'Riepilogo fatturato, conti, scadenze' },
    { id: 'lista_clienti', name: 'Lista Clienti', description: 'Elenco completo clienti con dettagli' },
    { id: 'stato_progetti', name: 'Stato Progetti', description: 'Avanzamento progetti con milestone' },
    { id: 'pipeline_commerciale', name: 'Pipeline Commerciale', description: 'Lead e pipeline per fase' },
    { id: 'report_hr', name: 'Report HR', description: 'Candidati, annunci, stato selezione' },
    { id: 'report_generico', name: 'Report Generico', description: 'Template personalizzabile con titolo e contenuto' },
  ]
  res.json({ templates })
})

// ── Build Typst source from template + data ──────────────

function buildTypstSource(template: string, data: any, aziendaId: string): string {
  // Get company info
  const azienda = db.prepare("SELECT * FROM entity WHERE id = ? AND type = 'organizzazione'").get(aziendaId) as any

  const companyName = azienda?.display_name || 'FIAI'
  const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })

  // Common header
  const header = `
#set page(margin: 2cm, header: [
  #set text(8pt, fill: gray)
  #grid(columns: (1fr, 1fr), align: (left, right),
    [${companyName}],
    [#datetime.today().display("[day]/[month]/[year]")]
  )
  #line(length: 100%, stroke: 0.5pt + gray)
], footer: [
  #set text(8pt, fill: gray)
  #context { align(center)[Pagina #counter(page).display() di #counter(page).final().first()] }
])

#set text(font: "DejaVu Sans", size: 10pt, lang: "it")
#set par(justify: true)

`

  switch (template) {
    case 'report_finanziario':
      return header + buildFinancialReport(data, companyName, today)
    case 'lista_clienti':
      return header + buildClientList(data, companyName, today)
    case 'stato_progetti':
      return header + buildProjectReport(data, companyName, today)
    case 'pipeline_commerciale':
      return header + buildPipelineReport(data, companyName, today)
    case 'report_hr':
      return header + buildHrReport(data, companyName, today)
    case 'report_generico':
      return header + buildGenericReport(data, companyName, today)
    default:
      return header + buildGenericReport(data, companyName, today)
  }
}

function escTypst(s: string | null | undefined): string {
  if (!s) return '—'
  return s.replace(/[#$@\\{}[\]]/g, c => '\\' + c)
}

function fmtEuro(n: number | null | undefined): string {
  if (n == null) return '€ 0'
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildFinancialReport(data: any, company: string, today: string): string {
  const d = data || {}
  return `
#align(center)[
  #text(20pt, weight: "bold")[Report Finanziario]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

== Riepilogo

#table(
  columns: (1fr, 1fr),
  stroke: 0.5pt + gray,
  [*Fatturato YTD*], [*${fmtEuro(d.fatturato_ytd)}*],
  [Da incassare], [${fmtEuro(d.da_incassare)}],
  [Liquidità totale], [${fmtEuro(d.liquidita_totale)}],
  [Fatture emesse], [${d.fatture_emesse ?? 0}],
  [Fatture pagate], [${d.fatture_pagate ?? 0}],
)

${d.fatture_scadute?.length ? `
== Fatture Scadute

#table(
  columns: (auto, 1fr, auto, auto),
  stroke: 0.5pt + gray,
  [*N.*], [*Cliente*], [*Totale*], [*Giorni*],
  ${d.fatture_scadute.map((f: any) => `[${escTypst(f.numero)}], [${escTypst(f.cliente_nome)}], [${fmtEuro(f.totale)}], [${f.giorni_scaduta}gg],`).join('\n  ')}
)
` : ''}

${d.conti?.length ? `
== Conti Bancari

#table(
  columns: (1fr, auto, auto),
  stroke: 0.5pt + gray,
  [*Conto*], [*Tipo*], [*Saldo*],
  ${d.conti.map((c: any) => `[${escTypst(c.nome)}], [${c.tipo}], [${fmtEuro(c.saldo)}],`).join('\n  ')}
)
` : ''}
`
}

function buildClientList(data: any, company: string, today: string): string {
  const clients = Array.isArray(data) ? data : data.clienti || []
  return `
#align(center)[
  #text(20pt, weight: "bold")[Lista Clienti]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

Totale clienti: *${clients.length}*

#table(
  columns: (1fr, auto, 1fr, 1fr),
  stroke: 0.5pt + gray,
  [*Nome/Ragione Sociale*], [*Tipo*], [*Email*], [*Telefono*],
  ${clients.map((c: any) => {
    const nome = c.ragione_sociale || `${c.nome} ${c.cognome || ''}`
    return `[${escTypst(nome)}], [${c.tipo || '—'}], [${escTypst(c.email)}], [${escTypst(c.telefono)}],`
  }).join('\n  ')}
)
`
}

function buildProjectReport(data: any, company: string, today: string): string {
  const projects = Array.isArray(data) ? data : data.progetti || []
  return `
#align(center)[
  #text(20pt, weight: "bold")[Stato Progetti]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

#table(
  columns: (1fr, auto, auto, auto),
  stroke: 0.5pt + gray,
  [*Progetto*], [*Stato*], [*Deadline*], [*Budget*],
  ${projects.map((p: any) => `[${escTypst(p.nome)}], [${p.stato}], [${p.data_fine_prevista || '—'}], [${p.budget ? fmtEuro(p.budget) : '—'}],`).join('\n  ')}
)
`
}

function buildPipelineReport(data: any, company: string, today: string): string {
  const leads = Array.isArray(data) ? data : data.pipeline || []
  return `
#align(center)[
  #text(20pt, weight: "bold")[Pipeline Commerciale]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

#table(
  columns: (auto, auto, auto),
  stroke: 0.5pt + gray,
  [*Fase*], [*Lead*], [*Valore*],
  ${leads.map((f: any) => `[${f.fase}], [${f.conteggio}], [${fmtEuro(f.valore_totale)}],`).join('\n  ')}
)
`
}

function buildHrReport(data: any, company: string, today: string): string {
  const candidates = Array.isArray(data) ? data : data.candidati || []
  return `
#align(center)[
  #text(20pt, weight: "bold")[Report HR]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

#table(
  columns: (1fr, 1fr, auto, auto),
  stroke: 0.5pt + gray,
  [*Nome*], [*Ruolo*], [*Stato*], [*Valutazione*],
  ${candidates.map((c: any) => `[${escTypst(c.nome)} ${escTypst(c.cognome)}], [${escTypst(c.ruolo_candidato)}], [${c.stato}], [${c.valutazione ? '★'.repeat(c.valutazione) : '—'}],`).join('\n  ')}
)
`
}

function buildGenericReport(data: any, company: string, today: string): string {
  const title = data.titolo || data.title || 'Report'
  const content = data.contenuto || data.content || ''
  const sections = data.sezioni || data.sections || []

  let body = `
#align(center)[
  #text(20pt, weight: "bold")[${escTypst(title)}]
  #v(4pt)
  #text(12pt, fill: gray)[${company} — ${today}]
]

#v(1cm)

${content ? escTypst(content) : ''}
`

  for (const section of sections) {
    body += `\n== ${escTypst(section.titolo || section.title)}\n\n${escTypst(section.contenuto || section.content || '')}\n`
  }

  return body
}

export default router
