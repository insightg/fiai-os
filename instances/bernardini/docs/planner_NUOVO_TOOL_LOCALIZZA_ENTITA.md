# Tool: localizza_entita

## Scopo

Localizzare un'entità della flotta (autista, semirimorchio o container/cassa mobile) usando una cascata di fonti dati, dalla più affidabile alla più approssimativa.

## Interfaccia

```python
localizza_entita(tipo: str, identificativo: str) -> str  # JSON
```

| Parametro | Tipo | Valori | Descrizione |
|-----------|------|--------|-------------|
| `tipo` | string | `"autista"`, `"semirimorchio"`, `"container"` | Tipo di entità da localizzare |
| `identificativo` | string | — | Nome autista, targa semirimorchio, o numero container |

## Cascata di ricerca

Il tool segue 4 step in cascata. Appena uno produce un risultato valido, restituisce la posizione. Il campo `evento_eta` viene sempre arricchito dall'ultimo evento `evt_unit_events` del **trailer vincente** (quello selezionato dalla cascata), indipendentemente dalla fonte della posizione.

### Step 1 — Planning lookup (solo autista/semirimorchio)

Cerca su `pl_trailer_planning` andando indietro nel tempo (max 7 giorni) dalla data attuale.

- **Autista**: ricerca robusta in `emp_employees` tramite `_cerca_autista_robusto()` (case insensitive, accenti, ordine nome/cognome, parziali). Poi cerca per `id_employee` nel planning. Salva **TUTTE** le righe trovate per quel giorno (`all_planning_rows`). Se ce ne sono più di una, attiva `multiple_rows`.
- **Semirimorchio**: cerca per `id_trailer`, prende il primo planning trovato.
- **Container**: salta direttamente a Step 3.

Da questo step si ottengono: `id_trailer`, `targa_semi`, `way_tracker_id`, `planning_text`, `planning_date` e, nel caso autista, la lista completa `all_planning_rows`.

### Step 2 — GPS WayTracker (solo autista/semirimorchio)

Interroga WayTracker con il `way_tracker_id` del semirimorchio trovato allo Step 1.

**Caso singola riga planning:**
- Se GPS trovato e < 24h → **ritorna posizione GPS** (con `stato: "FERMO"` se speed <= 5 km/h)
- Altrimenti → prosegui a Step 3

**Caso multiple_rows (autista su più semirimorchi):**
- Interroga GPS per **OGNI** semirimorchio delle righe planning
- Raccoglie tutti i GPS validi (< 24h)
- **Priorità**: GPS in movimento (speed > 5 km/h) E recente (< 2h) → usa quello
- **Fallback**: se tutti fermi → usa il fermo più recente (con `stato: "FERMO"`)
- Aggiorna `semirimorchio_targa` e `planning_raw` col trailer vincente
- Se nessun GPS valido → prosegui a Step 3

Prima del return, arricchisce `evento_eta` dall'ultimo evento del trailer vincente.

### Step 3 — evt_unit_events (BERLink)

Interroga la tabella `evt_unit_events` per l'ultimo evento recente (< 48h). Per ogni ricerca passa sia `id_trailer` che `vehicle_plate`: se la query per `id_trailer` non trova nulla, fa fallback su `trailer_plate` (targa ripulita dagli spazi).

**Caso singola riga:**
- Cerca per `id_trailer` + fallback `trailer_plate`
- Se trovato → **ritorna posizione evento** (con `evento_eta` direttamente dall'evento stesso)

**Caso multiple_rows:**
- Itera su **TUTTI** i trailer delle righe planning (passando `id_trailer` + `vehicle_plate` per ciascuno)
- Prende l'evento più recente tra tutti
- Aggiorna `semirimorchio_targa` e `planning_raw` col trailer vincente
- Se trovato → **ritorna posizione evento** (con `evento_eta` dall'evento)

**Caso container:**
- Cerca per `container_number` (normalizzato: spazi rimossi, punto rimosso, padding zeri a 7 cifre)
- Se trovato → **ritorna posizione** (arricchisce con targa semi se `id_trailer` presente nell'evento, con `evento_eta` dall'evento)

La posizione dell'evento viene arricchita con reverse geocoding se ci sono coordinate, altrimenti usa `terminal_code`.

### Step 4 — Interpretazione LLM del planning

Se nessuno dei precedenti step ha prodotto risultati, prende il testo planning e lo fa interpretare dall'LLM considerando:
- La data del planning vs data odierna
- L'orario corrente
- Il pattern del viaggio (carico/scarico/consegna)

**Caso multiple_rows senza vincente**: concatena i planning di tutte le righe (`[targa1] planning1 | [targa2] planning2 | ...`).

L'LLM restituisce una località stimata con stato. Questa è una **posizione teorica**, non reale.

Prima del return, arricchisce `evento_eta` dall'ultimo evento del trailer corrente.

## Campo evento_eta

Il campo `evento_eta` è **sempre presente** nella risposta (null se non trovato). Viene estratto dal campo `eta` (colonna generata `payload->>'eta'`) dell'ultimo evento `evt_unit_events` relativo al **trailer selezionato dalla cascata**.

**Logica:**
- Se la posizione viene da **GPS** (Step 2): dopo aver determinato il trailer vincente, fa una query `get_ultimo_evento_unita()` su quel trailer specifico per estrarre l'eta
- Se la posizione viene da **evt_unit_events** (Step 3): l'eta è già disponibile nell'evento stesso (nessuna query aggiuntiva)
- Se la posizione viene da **LLM** (Step 4): fa una query `get_ultimo_evento_unita()` sul trailer corrente

Questo garantisce che `evento_eta` sia sempre relativo allo stesso semirimorchio indicato in `semirimorchio_targa`.

## Ricerca autista: `_cerca_autista_robusto()`

Carica tutti i record `emp_employees` con `flag_driver = true` e applica scoring robusto:

| Score | Criterio |
|-------|----------|
| 100 | Match esatto nome+cognome (qualsiasi ordine) |
| 90 | Match esatto solo cognome |
| 85 | Tutte le parti dell'input trovate in nome/cognome |
| 80 | Match esatto solo nome |
| 75 | Cognome inizia con l'input |
| 60 | Input è sottostringa del cognome |
| 55 | Nome inizia con l'input |
| 40 | Input è sottostringa del nome |

Soglia minima: 40. Normalizzazione: lowercase, rimozione accenti, compressione spazi.

Esempi: `"CANDIA"`, `"Franco Candia"`, `"candia franco"`, `"CAND"` → tutti trovano FRANCO CANDIA.

## Fonti dati e affidabilità

| Fonte | Campo `fonte` | Affidabilità | Latenza |
|-------|---------------|--------------|---------|
| GPS WayTracker | `waytracker_gps` | Alta (posizione reale) | ~2s |
| evt_unit_events | `evt_unit_events` | Media-alta (evento logistico) | ~1s |
| LLM interpretation | `planning_llm` | Bassa (stima da testo) | ~3-5s |
| Planning raw | `planning_raw` | Molto bassa (testo grezzo) | 0s |
| Nessuna | `nessuna` | — | 0s |

## Output JSON

```json
{
  "tipo": "autista",
  "identificativo": "FRANCO CANDIA",
  "data": "2026-04-16",
  "trovato": true,
  "posizione": "A26 Nord-est, Belforte Monferrato",
  "coordinate": {"lat": 44.5919, "lon": 8.6661},
  "indirizzo": "A26 Nord-est, Belforte Monferrato",
  "fonte": "waytracker_gps",
  "aggiornamento": "2026-04-16T09:09:32+02:00",
  "eta_ore": 0.2,
  "velocita": 0,
  "stato": "FERMO",
  "semirimorchio_targa": "AE 70932",
  "planning_date": "2026-04-16",
  "planning_raw": "#26A02408_01 | in arrivo a Fiorenzuola...",
  "tipo_evento": null,
  "terminal_code": null,
  "evento_eta": "2026-04-16T11:00:00Z",
  "warning": "Autista su 3 righe planning per il 16/04/2026 (XA 821 YL, AE 70932, AD 24259)"
}
```

### Campi per fonte

| Campo | waytracker_gps | evt_unit_events | planning_llm | planning_raw |
|-------|:-:|:-:|:-:|:-:|
| posizione | V | V | V | V |
| coordinate | V | V (se presenti) | — | — |
| indirizzo | V | V (reverse geocode) | — | — |
| velocita | V | — | — | — |
| stato | V (FERMO se speed<=5) | — | — | — |
| tipo_evento | — | V | — | — |
| terminal_code | — | V (se presente) | — | — |
| evento_eta | V (query aggiuntiva) | V (dall'evento) | V (query aggiuntiva) | V (query aggiuntiva) |
| planning_raw | V | V | V | V |

## Tabella evt_unit_events

```sql
CREATE TABLE evt_unit_events (
  id_unit_event integer NOT NULL,
  message_type varchar(50) NOT NULL,
  type varchar(50) NOT NULL,           -- tipo evento (GATE_IN, GATE_OUT, LOAD, UNLOAD, ...)
  event_time timestamp NOT NULL,       -- timestamp evento
  latitude numeric,                    -- coordinate (possono essere NULL)
  longitude numeric,
  unit_number varchar(50) NOT NULL,    -- identificativo unità
  id_trailer integer,                  -- FK flt_trailers (calcolato dall'ingester)
  id_vehicle integer,                  -- FK flt_vehicles (calcolato dall'ingester)
  container_number varchar(50),        -- numero container (calcolato dall'ingester)
  trailer_plate varchar(10),           -- targa semirimorchio (generata da payload, senza spazi)
  terminal_code varchar(10),           -- codice terminal (dal JSON payload)
  eta varchar(20),                     -- ETA stimata (dal JSON payload)
  full_empty varchar(10),              -- stato carico/vuoto
  load_status varchar(10),             -- stato caricamento
  ...
) PARTITION BY RANGE (event_time);
```

**Indici utilizzati**:
- `idx_unit_event_trailer` su `id_trailer` — ricerca primaria per semirimorchio
- `idx_unit_event_ctr` su `container_number` — ricerca per container

**Cascata ricerca in `get_ultimo_evento_unita()`**:
1. `WHERE id_trailer = {id}` (se passato)
2. `WHERE trailer_plate = '{targa_senza_spazi}'` (fallback se id_trailer non trova nulla)
3. `WHERE container_number = '{normalizzato}'` (per container)

## Normalizzazioni

### Targa veicolo (BERLink → eventi)
- BERLink: `"XA 821 YL"` → rimuovi spazi lato client → `"XA821YL"`
- Query: `WHERE trailer_plate = 'XA821YL'`

### Container/unità (BERLink → eventi)
- Rimuovi spazi: `"GBTU 1234.5"` → `"GBTU1234.5"`
- Rimuovi punto separatore: `"GBTU1234.5"` → `"GBTU12345"`
- Padding zeri a 7 cifre: `"GBTU12345"` → `"GBTU0012345"`
- Query: `WHERE container_number = 'GBTU0012345'`

## Costanti configurabili

| Costante | Valore default | File | Descrizione |
|----------|---------------|------|-------------|
| `EVT_MAX_AGE_HOURS` | 48 | `berlink_connector.py` | Età massima evento per considerarlo valido |
| `GPS_MAX_AGE_HOURS` | 24 | `berlink_connector.py` | Età massima GPS fermo (già esistente) |
| `GPS_MOVING_MAX_AGE_HOURS` | 2 | `planning_tools.py` | Età massima GPS in movimento (solo multiple_rows) |
| `GPS_MOVING_SPEED_THRESHOLD` | 5 | `planning_tools.py` | Soglia km/h: sotto = fermo, sopra = in movimento |
| `PLANNING_LOOKBACK_DAYS` | 7 | `planning_tools.py` | Giorni indietro per ricerca planning |

## Stato attuale: TEST MODE

Il tool è registrato in `TOOLS_FUNCTIONS` (usabile via `execute_tool()` e API REST) ma **NON** in `TOOLS_SCHEMA` (l'agente LLM non lo vede).

### Per attivare nel flusso LLM

Aggiungere lo schema a `TOOLS_SCHEMA` in `planning_tools.py`:

```python
{
    "type": "function",
    "function": {
        "name": "localizza_entita",
        "description": "Localizza un'entità della flotta (autista, semirimorchio o container/cassa mobile). "
                       "Cerca la posizione corrente usando GPS, storico planning ed eventi BERLink. "
                       "Restituisce la posizione più recente disponibile con la fonte del dato.",
        "parameters": {
            "type": "object",
            "properties": {
                "tipo": {
                    "type": "string",
                    "description": "Tipo di entità da localizzare",
                    "enum": ["autista", "semirimorchio", "container"]
                },
                "identificativo": {
                    "type": "string",
                    "description": "Identificativo dell'entità: nome/cognome per autista, targa per semirimorchio, numero unità per container"
                }
            },
            "required": ["tipo", "identificativo"]
        }
    }
}
```

## File coinvolti

| File | Modifica |
|------|----------|
| `agent/connectors/berlink_connector.py` | `get_ultimo_evento_unita()`, `_normalizza_container_per_eventi()`, costante `EVT_MAX_AGE_HOURS` |
| `agent/tools/planning_tools.py` | `localizza_entita()`, `_cerca_autista_robusto()`, `_interpreta_planning_con_llm()`, `_arricchisci_evento_eta()`, entry in `TOOLS_FUNCTIONS` |
| `api_server.py` | Endpoint `POST /api/planning/localizza_entita` |
| `tests/test_localizza_entita.py` | Script CLI per test manuale |
| `tests/ALGORITMO_LOCALIZZA_ENTITA.md` | Diagramma algoritmo |

## Test

### Script CLI
```bash
source venv/bin/activate
python tests/test_localizza_entita.py autista "ROSSI"
python tests/test_localizza_entita.py autista "CANDIA"
python tests/test_localizza_entita.py semirimorchio "AD 24208"
python tests/test_localizza_entita.py container "GBTU 1234.5"
```

### API REST
```bash
curl -X POST http://localhost:8602/api/planning/localizza_entita \
  -H "Content-Type: application/json" \
  -d '{"tipo": "autista", "identificativo": "ROSSI"}'
```

### Endpoint generico
```bash
curl -X POST http://localhost:8602/api/planning/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "localizza_entita", "args": {"tipo": "semirimorchio", "identificativo": "AD 24208"}}'
```
