# BERNARDINI S.R.L. — Gestionale Intelligente

Verticalizzazione di FIAI OS per BERNARDINI S.R.L. Basato su branch `bernardini`.

## Branding

- **Nome**: BERNARDINI (non FIAI)
- **Colori**: blu (#1565C0 primario, #1E88E5 hover, #0D47A1 scuro)
- **Font**: Inter
- **URL**: bernardini.insightg.eu

## Docker

```bash
# Container separati da FIAI OS — girano in parallelo
docker compose build && docker compose up -d

# Container names:
#   bernardini-frontend (porta 3000)
#   bernardini-backend (porta 3001)
# Volume: bernardini-data
# Network: bernardini-internal + npm-network
# DB: /app/data/bernardini.db
# JWT: bernardini-secret-key-2026
```

## I 14 Agenti (8 reparti + 6 condivisi)

### Reparti BERNARDINI

| Cartella | Agente | Dominio | Colore |
|----------|--------|---------|--------|
| `domains/direzione/` | Direzione | direzione | #1a1a2e |
| `domains/commerciale-bernardini/` | Commerciale | commerciale | #1976D2 |
| `domains/amministrazione-hr/` | Amministrazione & HR | amministrazione | #2D8B56 |
| `domains/contabilita-industriale/` | Contabilita' Industriale | contabilita | #6A1B9A |
| `domains/logistica-produzione/` | Logistica & Produzione | produzione | #E68A00 |
| `domains/officina/` | Officina Riparazioni | officina | #795548 |
| `domains/legale-assicurazioni/` | Legale & Assicurazioni | legal | #D32F2F |
| `domains/qualita-sicurezza/` | Qualita' Sicurezza Ambiente | qualita | #00796B |

### Agenti condivisi (da FIAI OS)

| Cartella | Agente | Dominio |
|----------|--------|---------|
| `domains/documentale/` | Archivista | documentale |
| `domains/whatsapp/` | WhatsApp Agent | whatsapp |
| `domains/it/` | Dev IT | it |
| `domains/doctor/` | Doctor Diagnostica | doctor |
| `domains/tts/` | Voice Assistant | tts |
| `domains/general/` | Assistente BERNARDINI | general |

## Reparti aziendali

- **Direzione** — overview, KPI strategici, reporting CdA
- **Commerciale** — clienti, pipeline, preventivi, ordini, catene retail/GDO
- **Amministrazione/Stipendi/HR** — buste paga, assunzioni, ferie, F24, CU, recruiting
- **Contabilita' Industriale** — costi produzione, margini per commessa, budget, scostamenti
- **Logistica/Produzione** — magazzino, spedizioni, pianificazione, ordini produzione, fornitori
- **Officina Riparazioni** — ordini lavoro, manutenzione mezzi, ricambi, interventi
- **Assicurazioni/Contenzioso/Mezzi/Legale** — polizze, sinistri, cause, parco mezzi, contratti
- **Qualita'/Sicurezza/Ambiente** — ISO 9001, NC, DVR, formazione, audit, rifiuti, certificazioni

## Utenti

- **admin** — admin@fiai.cc (admin)
- **Brando** — brando@fiai.cc (admin)
- **Gab Giottoli** — gab@fiai.cc (admin)
- **Francesco Giorgini** — francesco@bernardini.it (collaboratore, WhatsApp abilitato: 393478007836)

## Sviluppo

```bash
# Lavorare su Bernardini
cd /home/giobbe/fiai/bernardini
claude

# Per incorporare aggiornamenti dal core FIAI OS:
git fetch origin
git merge origin/v5-virtual-filesystem
# Risolvere conflitti su: config.ts, orchestrator.ts, types.ts, tailwind.config.js

# Per modifiche solo Bernardini (reparti, prompt, viste):
# Editare direttamente, committare, pushare
```

## Differenze da FIAI OS

| Aspetto | FIAI OS | BERNARDINI |
|---------|---------|------------|
| Branch | v5-virtual-filesystem | bernardini |
| Directory | /home/giobbe/fiai/fiai-os | /home/giobbe/fiai/bernardini |
| Colore primario | #C41E3A (rosso) | #1565C0 (blu) |
| Agenti | 13 generici | 8 reparti + 6 condivisi |
| Container | fiai-frontend/backend | bernardini-frontend/backend |
| DB | fiai.db | bernardini.db |
| URL | fiai.insightg.eu | bernardini.insightg.eu |
| Classificatore | Domini generici | Reparti Bernardini |

## Stack (ereditato da FIAI OS)

```
Frontend:  React 19 + Vite + Tailwind + Zustand + Inter
Backend:   Node.js + Express + TypeScript (ESM)
Database:  SQLite (WAL) + FTS5 + sqlite-vec
AI:        OpenRouter (Claude Haiku 4.5 default)
Deploy:    Docker Compose (nginx + node)
```

## File chiave per personalizzazione Bernardini

```
server/agents/config.ts          — import reparti, AGENT_COLORS
server/agents/types.ts           — AgentDomain con reparti
server/agents/orchestrator.ts    — CLASSIFICATION_PROMPT con reparti
server/agents/domains/*/prompt.md — personalita' per reparto
tailwind.config.js               — colori blu
```
