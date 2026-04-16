# Planner - Agente Pianificazione Viaggi

Sistema di pianificazione viaggi per autotrasporti con ottimizzazione automatica e interfaccia LLM.

## Struttura progetto

```
agent/
├── main.py              # Entry point CLI (typer)
├── config.py            # Configurazione e settings
├── llm_agent.py         # Agente LLM per interazione naturale
├── connectors/          # Connessioni a sistemi esterni
│   ├── tir_connector.py      # API TIR (viaggi da pianificare)
│   ├── berlink_connector.py  # API BERLINK (autisti, semirimorchi)
│   └── waytracker_connector.py # GPS tracking
├── models/              # Modelli dati
│   ├── viaggio.py       # Viaggio da pianificare
│   ├── autista.py       # Autista
│   ├── semirimorchio.py # Semirimorchio
│   ├── coppia.py        # Coppia autista-semirimorchio
│   └── pianificazione.py # Risultato pianificazione
├── planner/             # Logica ottimizzazione
│   ├── optimizer.py     # Algoritmo ottimizzazione + CandidatoValutato
│   ├── history_learner.py # Apprendimento da storico
│   ├── feedback.py      # Feedback loop: confronto proposta vs TIR
│   ├── validator.py     # Validazione dati pre-ottimizzazione
│   ├── report.py        # Report giornaliero/settimanale
│   └── optimization_config.yaml
├── tools/               # Tool functions per LLM agent
│   └── planning_tools.py
├── utils/               # Utility
│   ├── geocoding.py     # Geocoding indirizzi
│   └── position_parser.py
└── web/                 # Interfaccia Streamlit
    ├── app.py           # App principale
    └── components/
        ├── gps_map.py               # Componente mappa GPS
        ├── dettaglio_assegnazione.py # Dettaglio + candidati valutati
        └── risultati_pianificazione.py # Risultati + anomalie pre
config/
├── settings.yaml        # Configurazione principale
└── optimization.yaml    # Configurazione dettagliata ottimizzazione
```

## Comandi

### Avvio interfaccia web (Streamlit)
```bash
./run_web.sh              # Foreground
./run_web.sh -b           # Background
./run_web.sh -s           # Stop server
```

### CLI
```bash
source venv/bin/activate

# --- Consultazione dati ---
python run.py viaggi DATA                  # Lista viaggi da pianificare
python run.py viaggi DATA --non-assegnati  # Solo viaggi senza assegnazione (-n)
python run.py autisti DATA                 # Lista autisti disponibili
python run.py semirimorchi DATA            # Lista semirimorchi disponibili
python run.py semirimorchi DATA --tipo CISTERNA  # Filtro per tipo (-t)

# --- Chat interattiva ---
python run.py chat                    # Chat LLM (data=oggi)
python run.py chat --data 2024-02-28  # Chat LLM con data specifica (-d)

# --- Ottimizzazione e confronto ---
python run.py ottimizza DATA               # Genera pianificazione ottimizzata
python run.py ottimizza DATA --storico     # Usa templates storico TIR
python run.py confronta DATA               # Confronta proposta vs assegnazioni TIR
python run.py confronta DATA --storico     # Confronta con templates storico

# --- Report ---
python run.py report DATA                       # Report giornaliero
python run.py report DATA -t settimanale        # Report settimanale

# --- Training e apprendimento ---
python run.py import-storico file.csv            # Import CSV per apprendimento
python run.py import-storico file.csv -d ","     # CSV con delimiter virgola
python run.py import-storico file.csv -e latin1  # CSV con encoding diverso

python run.py train-storico DATA_DA DATA_A              # Training batch su range date
python run.py train-storico DATA_DA DATA_A --reset      # Azzera patterns + retrain (idempotente)
python run.py train-storico DATA_DA DATA_A --solo-confronta  # Solo confronta (proposta già esistente)
python run.py train-storico DATA_DA DATA_A --no-skip-weekend # Includi sabato e domenica

# --- RAG e infrastruttura ---
python run.py bootstrap-rag                # Indicizza proposte/feedback in ChromaDB
python run.py bootstrap-rag --reset        # Svuota ChromaDB + reindicizza da zero
python run.py test-connessione             # Test connessione API TIR e BERLINK
```

> **DATA** = formato `YYYY-MM-DD`, `DD/MM/YYYY` o `DD-MM-YYYY`

### Training storico: flusso e idempotenza

Il comando `train-storico` esegue per ogni giorno nel range:
1. **Ottimizza** — genera proposta con templates storico, salva in `data/proposte/`
2. **Confronta** — confronta proposta vs assegnazioni reali TIR, salva feedback in `data/feedback/`
3. **Alimenta learner** — aggiorna `data/learned_patterns.json` con gli override (dove TIR ha corretto la proposta)

**Problema accumulo**: senza `--reset`, i contatori in `learned_patterns.json` si **sommano** ad ogni run.
Se si rilancia sullo stesso periodo N volte, i pattern risultano gonfiati di N×.

**Soluzione `--reset`**: azzera `learned_patterns.json` e il singleton in memoria prima del batch.
Così il retrain è idempotente: `--reset` + stesso range = stessi contatori finali.

```
# Primo training
python run.py train-storico 2026-03-10 2026-03-14

# Dopo aver migliorato le logiche, retrain pulito sullo stesso periodo
python run.py train-storico 2026-03-10 2026-03-14 --reset

# Training incrementale su periodo diverso (senza reset, accumula)
python run.py train-storico 2026-03-17 2026-03-19
```

File coinvolti nel training:
| File | Comportamento |
|------|--------------|
| `data/learned_patterns.json` | Accumula contatori (reset con `--reset`) |
| `data/proposte/*.json` | Sovrascritto per data+ora (nessun duplicato) |
| `data/feedback/*.json` | Sovrascritto per data (nessun duplicato) |
| `data/chromadb/` | ChromaDB usa upsert con ID deterministici (reset con `bootstrap-rag --reset`) |

### Ripartire da zero (reset completo)

```bash
# 1. Azzera patterns + retrain su tutto il periodo storico
python run.py train-storico DATA_DA DATA_A --reset

python run.py train-storico 2026-02-18 2026-03-24 --reset

# 2. Svuota ChromaDB + reindicizza da proposte/feedback appena rigenerati
python run.py bootstrap-rag --reset
```

## Configurazione

### File .env
```
OPENROUTER_API_KEY=sk-or-v1-xxx
```

### config/settings.yaml
- LLM: provider OpenRouter, modello, temperatura
- API: endpoint TIR e BERLINK (rete locale 192.168.0.12)
- Planning: pesi ottimizzazione, vincoli (ore guida, riposo)

## Vincoli pianificazione
- Max 9 ore guida giornaliere
- Min 11 ore riposo tra turni
- Max 56 ore settimanali
- Velocità media 60 km/h per calcolo tempi

## Metriche ottimizzazione e Logica programmazione viaggi 

- Descritta nel file logs/LOGICHE_ALLOCAZIONE.md
- Utilizza sempre come riferimento il file docs/LOGICHE_ALLOCAZIONE.md
- Aggiorna il file LOGICHE_ALLOCAZIONE.md se nuove logiche vengono introdotte o le attuali modificate

## Dipendenze principali
- streamlit: interfaccia web
- typer + rich: CLI
- httpx: client HTTP per API
- pydantic: validazione modelli
- openai: client LLM (compatibile OpenRouter)
- geopy: geocoding
- folium: mappe

## Note sviluppo
- Python 3.12
- Virtual environment in `venv/`
- Log in `logs/`
- Cache dati in `data/`

## Comandi Utili
- Stop Streamlit: 
    ./run_web.sh -s 
    
- Start Streamlit:  
    ./run_web.sh  
    
- Start Streamlit in Background (detached):  
    ./run_web.sh -b
    
---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

## Tools API Management

### 1. Add new tool to API Server

- Every time a new tool is added, update file api_server.py and add/update the endpoint; update also file docs/API_SERVER.md


## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Keep This Updated

**When to update this file:**
- Dopo aggiunta di nuove dipendenze major
- Dopo modifiche architetturali
- Dopo cambio convenzioni di codice
- Quando emergono nuovi pattern

