# Connettore: Planner Tariffe (ai-planner)

## Overview

Sistema di pianificazione trasporti per Bernardini SRL su `192.168.0.14` (raggiungibile via VPN).
Progetto Python in `/home/berni/planner-tariffe/ai-planner/`.

## Architettura remota

- **Ottimizzatore**: 10 filtri hard + scoring composito 6 fattori (distanza, tipo, tempo, esperienza, RAG, sostenibilita')
- **19 tool LLM**: query viaggi, assegnazioni, GPS, statistiche, simulazioni, confronti
- **API esterne**: TIR (192.168.0.12:9090), BERLINK (192.168.0.12:9095), WayTracker SOAP, Google Maps
- **RAG**: ChromaDB per apprendimento storico da feedback operatore
- **EU 561**: compliance ore guida, riposi obbligatori
- **Web UI**: Streamlit su porta 8601

## Integrazione prevista

Approccio: **proxy API** — FastAPI wrapper sul planner Python espone i tool come REST, agente Bernardini OS li chiama come tool nativi.

### Fase 1: FastAPI sul server remoto (192.168.0.14:8602)

```
POST /api/planning/viaggi          → get_viaggi_da_pianificare
POST /api/planning/autisti         → get_autisti_disponibili  
POST /api/planning/semirimorchi    → get_semirimorchi_disponibili
POST /api/planning/suggerisci      → suggerisci_pianificazione
POST /api/planning/assegna         → assegna_viaggio
POST /api/planning/dettaglio       → get_dettaglio_viaggio
POST /api/planning/gps             → get_posizione_gps
POST /api/planning/distanza        → calcola_distanza
POST /api/planning/statistiche     → get_statistiche_viaggi
POST /api/planning/confronta       → confronta_pianificazione
POST /api/planning/storico         → get_contesto_storico (RAG)
POST /api/planning/analizza        → analizza_viaggio_non_assegnato
POST /api/planning/conflitti       → mostra_conflitti
POST /api/planning/scenario        → ricalcola_scenario (what-if)
POST /api/planning/eta             → get_eta_per_autista
GET  /api/planning/health          → health check
```

### Fase 2: Proxy + Agente in Bernardini OS

- `server/planning-proxy.ts` — fetch verso planner via VPN
- `server/agents/domains/pianificazione/` — agente dedicato con 15 tool
- Dominio: `pianificazione`, colore: `#FF5722`
- Keyword scoring: viaggio, pianificazione, autista, semirimorchio, trasporto, carico, scarico, flotta, gps
- Setting: `planning_api_url` (default `http://192.168.0.14:8602`)
- Richiede VPN connessa

## Dipendenze

- VPN attiva verso 192.168.0.0/24
- Server 192.168.0.14 raggiungibile
- FastAPI in esecuzione sulla porta 8602
- TIR API (192.168.0.12:9090) e BERLINK API (192.168.0.12:9095) accessibili

## Tool previsti (15)

| Tool | Funzione | Params |
|------|----------|--------|
| planning_viaggi | Lista viaggi per data | data, solo_non_assegnati? |
| planning_suggerisci | Ottimizzazione automatica | data, template? |
| planning_assegna | Assegna viaggio a coppia | bg, targa?, autista? |
| planning_autisti | Autisti disponibili | data, tipo? |
| planning_semirimorchi | Semirimorchi disponibili | data, tipo? |
| planning_gps | Posizione GPS semirimorchio | targa |
| planning_distanza | Distanza tra localita' | origine, destinazione |
| planning_statistiche | Statistiche per periodo | data_inizio, data_fine, raggruppa_per? |
| planning_confronta | Confronto piano vs effettivo | data |
| planning_scenario | Simulazione what-if | data, escludi_autisti?, vincoli? |
| planning_eta | ETA autista per destinazione | autista, destinazione |
| planning_conflitti | Conflitti risorse | data |
| planning_storico | Contesto RAG storico | query |
| planning_dettaglio_viaggio | Dettaglio singolo viaggio | bg |
| planning_analizza_non_assegnato | Diagnostica mancata assegnazione | bg |

## File di configurazione remoti

- `config/settings.yaml` — endpoint API, pesi scoring, vincoli EU 561, restrizioni autisti
- `config/optimization.yaml` — regole tipi semirimorchio, vincoli cliente, scoring sostenibilita'

## Note

- Il motore di ottimizzazione Python resta sul server remoto (non riscritto in TS)
- L'agente Bernardini OS usa i dati come tool, con tutti i vantaggi: permessi, audit, sessioni, streaming, multi-canale
- Feedback loop: le assegnazioni confermate dall'operatore via Bernardini OS alimentano il training storico del planner
