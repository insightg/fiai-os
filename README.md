# FIAI OS

**Sistema gestionale completo per aziende italiane** — CRM, fatturazione elettronica, contabilita, gestione progetti, analytics e assistente AI integrato.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **Styling:** Tailwind CSS (tema scuro con accenti gold)
- **State Management:** Zustand
- **Backend / Auth / DB:** Supabase (PostgreSQL + Row Level Security)
- **Grafici:** Recharts
- **PDF:** @react-pdf/renderer
- **AI:** Anthropic Claude (SDK)
- **Drag & Drop:** dnd-kit
- **Routing:** React Router v7
- **Icone:** Lucide React

## Setup

### 1. Prerequisiti

- Node.js >= 18
- Un progetto Supabase (https://supabase.com)

### 2. Installazione dipendenze

```bash
npm install
```

### 3. Variabili d'ambiente

Crea un file `.env` nella root del progetto:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ANTHROPIC_API_KEY=your-anthropic-api-key
```

### 4. Migrazione Database

Esegui la migrazione SQL nel SQL Editor di Supabase:

```bash
# Il file si trova in:
supabase/migrations/001_init.sql
```

Apri il file, copia il contenuto e incollalo nel SQL Editor della dashboard Supabase, poi esegui.

### 5. Avvio in sviluppo

```bash
npm run dev
```

L'app sara disponibile su `http://localhost:5173`.

### 6. Build di produzione

```bash
npm run build
npm run preview
```

## Moduli

| Modulo | Percorso | Descrizione |
|--------|----------|-------------|
| **Dashboard** | `/dashboard` | KPI principali, grafici fatturato, pipeline, attivita recenti |
| **Leads** | `/leads` | Gestione lead con vista Kanban drag & drop |
| **Clienti** | `/clienti` | Anagrafica clienti (privati e aziende) |
| **Preventivi** | `/preventivi` | Creazione e gestione preventivi con righe dettaglio |
| **Ordini** | `/ordini` | Ordini confermati da preventivi |
| **Progetti** | `/progetti` | Gestione progetti con timeline e dettaglio attivita |
| **Fatture** | `/fatture` | Fatturazione elettronica, generazione PDF e XML SDI |
| **Fatture Ricorrenti** | `/fatture/ricorrenti` | Gestione fatture ricorrenti automatiche |
| **Fatture Passive** | `/fatture-passive` | Registrazione fatture fornitori |
| **Fornitori** | `/fornitori` | Anagrafica fornitori |
| **Conti** | `/conti` | Gestione conti bancari e movimenti |
| **Rimborsi** | `/rimborsi` | Richieste e approvazione rimborsi spese |
| **Report** | `/report` | Analisi avanzate: cash flow, margini, top clienti/fornitori |
| **AI Command** | `/ai` | Chat con assistente AI Claude per interrogare i dati aziendali |
| **Impostazioni** | `/impostazioni` | Configurazione azienda e profilo utente |

## Struttura del progetto

```
src/
  components/
    charts/       # BarChart, LineChart, PieChart (Recharts)
    layout/       # Layout, Sidebar, Topbar
    ui/           # Button, Badge, Modal, Table, Form, StatCard, Toast
  lib/
    analytics.ts  # Funzioni KPI e dati grafici
    anthropic.ts  # Client AI Anthropic
    pdf.ts        # Generazione PDF fatture
    supabase.ts   # Client Supabase
    xml-sdi.ts    # Generazione XML fattura elettronica (SDI)
  pages/
    ai/           # AICommand
    auth/         # Login
    clienti/      # Clienti
    conti/        # Conti e Movimenti
    dashboard/    # Dashboard KPI
    fatture/      # Fatture, FatturaEditor, FatturaPDF, Ricorrenti
    fatture-passive/ # FatturePassive
    fornitori/    # Fornitori
    impostazioni/ # Impostazioni
    leads/        # Leads, LeadKanban, LeadForm
    ordini/       # Ordini
    preventivi/   # Preventivi, PreventivoEditor
    progetti/     # Progetti, ProgettoDetail
    report/       # Report
    rimborsi/     # Rimborsi
  store/          # Zustand stores (auth, leads, clienti, fatture, ecc.)
  types/          # TypeScript interfaces
```
