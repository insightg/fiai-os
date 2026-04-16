# Logiche di Allocazione Viaggi-Autisti

Documentazione completa della pipeline di ottimizzazione per l'assegnazione automatica dei viaggi alle coppie autista-semirimorchio.

**File principali:**
- `agent/planner/optimizer.py` — Pipeline filtri, scoring composito, engine assegnazione
- `agent/planner/optimization_config.py` — Scoring zona, tipo semi, vincoli carrier
- `config/optimization.yaml` — Pesi, soglie, regole tipo, carrier, zone
- `config/settings.yaml` — Impiego, vincoli guida EU 561, placeholder

---

## Indice

1. [Flusso generale](#1-flusso-generale)
2. [Filtri hard](#2-filtri-hard)
3. [Sistema di scoring](#3-sistema-di-scoring)
4. [Penalità e bonus](#4-penalità-e-bonus)
5. [Logiche speciali](#5-logiche-speciali)
6. [Determinazione posizione autisti/semirimorchi](#6-determinazione-posizione-autistisemirimorchi)
7. [Scoring zona](#7-scoring-zona)
8. [Configurazione](#8-configurazione)
9. [Gestione Cache Geocoding](#9-gestione-cache-geocoding)

---

## 1. Flusso generale

### Entry point

L'ottimizzazione parte da `PlanningOptimizer.ottimizza_da_database()` che:

1. Recupera viaggi da pianificare dal database TIR
2. Recupera coppie autista-semirimorchio dal database BERLINK
3. Arricchisce le coppie con posizioni GPS (WayTracker) e posizioni future
4. Arricchisce con impegni correnti degli autisti
5. Chiama `genera_pianificazione_coppie()` per l'assegnazione

### Pre-assegnazione da BERLINK

Prima dell'ottimizzazione, il sistema controlla se i viaggi da programmare hanno gia un'assegnazione nel **planning BERLINK** (tabella `pl_trailer_planning`). Per ogni BG trovato nel campo `planning` di un record BERLINK, se quel BG e tra i viaggi da programmare, viene creata una pre-assegnazione fissa (coppia semi+autista) che l'ottimizzatore non puo modificare.

- **Metodo**: `BERLINKConnector.get_assegnazioni_da_planning(data, bg_list)`
- **Meccanismo**: usa `bg_fissi` dell'optimizer (stesso usato per scenario what-if)
- **Nota assegnazione**: `"Pre-assegnato da BERLINK"`
- **Flusso**: il viaggio pre-assegnato viene rimosso dalla coda di ottimizzazione; la posizione della coppia viene aggiornata per i viaggi successivi

### Pipeline di assegnazione

```
genera_pianificazione_coppie()
│
├─ PRE-ASSEGNAZIONE BG FISSI (da BERLINK o scenario what-if)
├─ Calcola scarsità risorse (coppie compatibili per viaggio)
├─ Ordina viaggi per scarsità crescente, poi data_carico
├─ Filtra viaggi non ancora assegnati (e_assegnato == False)
│
├─ Per ogni viaggio (primo passaggio):
│   ├─ Aggiorna posizioni coppie (se già assegnate, usa luogo_scarico precedente)
│   ├─ Rileva swap semirimorchio: se autista già assegnato con ALTRO semi
│   │   ├─ Semi al depot (Fiorenzuola/Terni) → swap OK, km_vuoto dal depot
│   │   └─ Semi NON al depot → swap bloccato (log: swap_bloccato_no_depot)
│   ├─ Escludi autisti saturi (impiego >= 100%)
│   ├─ Chiama trova_migliore_coppia() → 8 filtri hard + scoring
│   ├─ Se trovata coppia con score > 0:
│   │   ├─ Crea AssegnazionePianificazione
│   │   ├─ Aggiorna posizione coppia → luogo_scarico del viaggio
│   │   ├─ Aggiorna posizione autista (per rilevamento swap successivi)
│   │   └─ Registra impiego autista (km_trasporto + km_vuoto)
│   └─ Altrimenti: salva motivi di esclusione
│
├─ Secondo passaggio (depot swap): per viaggi ancora non assegnati
│   └─ Crea coppie virtuali autista_libero + semi_depot → vedi sezione 5.8
│
└─ Terzo passaggio (viaggi lunghi multi-day):
    └─ Stessa logica del primo passaggio, incluso vincolo swap depot
```

### Ordinamento per scarsità risorse (two-pass)

Prima dell'assegnazione, l'ottimizzatore pre-computa il numero di coppie compatibili
per ogni viaggio (solo filtri hard, senza scoring). I viaggi vengono ordinati per:

1. **Scarsità crescente**: meno coppie compatibili = assegnato prima
2. **Data carico** (a parità di scarsità)

Questo garantisce che i viaggi vincolati (es. SILOS obbligatorio, BTEU, estero)
vengano serviti prima dei viaggi flessibili con molte alternative.

Log: `Viaggio vincolato: {bg} solo {n} coppie compatibili` per viaggi con <= 3 opzioni.

### Pre-ordinamento catene viaggi

Dopo l'ordinamento per scarsità, l'ottimizzatore rileva **catene di viaggi concatenabili**:
coppie (A, B) dove il luogo di scarico di A è vicino al luogo di carico di B (≤ 50 km, configurabile via `SOGLIA_CATENA_KM`).

**Problema risolto**: senza pre-ordinamento, se B viene processato prima di A per scarsità, la coppia assegnata ad A non ha ancora la posizione aggiornata al luogo di scarico di A, quindi risulta lontana dal carico di B e non viene selezionata. Riordinando A prima di B, il meccanismo `posizioni_aggiornate` fa sì che la coppia appena assegnata ad A risulti vicina al carico di B.

**Algoritmo**:
1. Per ogni coppia di viaggi (A, B), calcola distanza tra scarico di A e carico di B
2. Seleziona edges greedily (distanza crescente) con vincoli: max 1 successore e 1 predecessore per viaggio, no cicli
3. Riordina: per ogni catena, posiziona tutti i membri a partire dalla posizione del membro più anticipato nell'ordine scarsità

**Supporta catene multi-hop** (A→B→C) e previene cicli. Viaggi non coinvolti in catene mantengono l'ordine scarsità originale.

Log: `[CATENE] {bg_a} ({scarico}) -> {bg_b} ({carico}) = {km}km` per ogni edge selezionato.

### Riutilizzo coppie

Una coppia può essere riutilizzata per più viaggi nella stessa giornata:
- Dopo ogni assegnazione, la posizione della coppia viene aggiornata al luogo di scarico
- L'impiego dell'autista viene cumulato (km trasporto + km vuoto + tempo scarico)
- Se l'impiego raggiunge il 100%, la coppia viene esclusa dalle iterazioni successive

---

## 2. Filtri hard

La funzione `trova_migliore_coppia()` applica 10 filtri sequenziali. Se una coppia non supera un filtro, viene scartata.

### Filtro 1: Utilizzabilità coppia

```python
if not coppia.e_utilizzabile:
    → scartata ("non_utilizzabile")
```

La coppia deve avere posizione valida e semirimorchio utilizzabile.

### Filtro 1b: Competenze autista per tipo semirimorchio

```python
if coppia.autista and not coppia.autista.puo_guidare(semi.tipo, semi.allestimento):
    → scartata ("skill_autista_mancante")
```

Verifica che l'autista abbia le competenze per guidare il tipo di semirimorchio assegnato. Le competenze sono caricate dalla tabella `emp_driver_skills` di Berlink.

**Mapping skill → tipo semirimorchio:**

| Flag DB | Tipo semirimorchio |
|---------|-------------------|
| `flag_silos` | SILOS |
| `flag_rotocella` | ROTOCELLA |
| `flag_centinato` | CENTINATO |
| `flag_casse_mobili` | PORTACTR_9M, PORTACTR_13_6M, RIBALTABILE_9M |
| `flag_silos` + `flag_aspiratore` | SILOS con allestimento ASP |

**Edge case:**
- Autista senza record in `emp_driver_skills` → `skills=None` → default tutto False (restrittivo)
- **TUTTI gli autisti** (interni ed esterni) devono avere le skill richieste
- Semirimorchio ESTERNO → `puo_guidare()=True` sempre
- Coppia senza autista (`autista=None`) → filtro saltato

**Skill operative (soft constraint):** `flag_montaggio_liner`, `flag_lavaggio_silos`, `flag_copertura_casse_mobili` — usate come moltiplicatore sullo score totale quando le note del viaggio contengono keyword corrispondenti (vedi sezione 3.3).

### Filtro 2: Disponibilità temporale (coppie future)

```python
if coppia.posizione_futura:
    if not coppia.disponibile_da:
        → scartata  # disponibilità sconosciuta
    if coppia.disponibile_da > data_carico_viaggio:
        → scartata  # non disponibile in tempo
```

Per le coppie con posizione futura (da tratte già assegnate), verifica che saranno disponibili prima della data di carico del viaggio.

### Filtro 3: Distanza massima autista

```python
distanza = calcola_distanza(coppia.posizione, viaggio.luogo_carico)
if distanza > max_driver_distance_km:  # default: 350 km
    → scartata ("distanza_eccessiva")
```

L'autista non può essere a più di **350 km** dal luogo di carico (configurabile in `optimization.yaml` → `distance.max_driver_distance_km`).

### Filtro 4: Compatibilità esterno

```python
if semirimorchio.flag_esterno:
    - Autista deve essere esterno
    - Keyword targa semirimorchio deve corrispondere al nome autista
    Es: targa "MS11DGS DRAGOS" → autista deve avere "DRAGOS" nel nome
```

Semirimorchi esterni possono essere assegnati solo ad autisti esterni con nome corrispondente.

### Filtro 5: Vincoli carrier

```python
if autista.flag_esterno:
    verifica_vincoli_carrier(trazionista, luogo_carico, ha_container)
    - Se carrier ha solo_container=true e viaggio non ha container → scartato
```

Vincolo hard: alcuni trazionisti accettano **solo viaggi con container** (es. TRANSEMDO, MARE COMBINATO, LOGISTIC HOLDING).

### Filtro 6: Vincoli specifici autista

```python
verifica_vincolo_autista(nome_autista, luogo_carico, luogo_scarico)
```

Vincoli individuali da `settings.yaml` → `planning.vincoli_autisti`. Esempio:
- **Angrej Singh**: solo viaggi con carico E scarico nella zona di Terni (raggio 30 km, geocoding)

### Filtro 7: Impiego proiettato

```python
score_proiettato = impiego.score_proiettato(km_trasporto, km_vuoto, tempo_scarico)
if score_proiettato > 100:
    → scartato ("impiego_saturo")
```

Calcola l'impiego che l'autista avrebbe **dopo** questa assegnazione. Se supererebbe il 100% della capacità giornaliera, viene escluso. Il calcolo include:
- km trasporto (carico → scarico)
- km vuoto (posizione → carico)
- km equivalenti scarico (ore_scarico × velocità_media)

### Filtro 8b: Ore guida EU 561

```python
ore_guida_viaggio = (km_vuoto + km_trasporto) / velocita_media
ore_guida_totali = impiego.ore_guida_stimate + ore_guida_viaggio
if ore_guida_totali > max_daily_hours:  # default: 9h
    → scartato ("superamento_ore_guida")
```

Verifica che l'autista non superi il limite EU 561 di **9 ore di guida giornaliere**.
Le ore guida sono stimate come `km_effettivi / velocita_media` (non include tempo scarico).

| Parametro | Default | YAML |
|-----------|---------|------|
| `max_daily_hours` | 9 | `constraints.max_daily_hours` |

### Filtro 9: Tipo semirimorchio incompatibile (hard constraint)

```python
score = valuta_assegnazione_coppia(viaggio, coppia)
if score.score_tipo == 0:
    → scartato ("score_zero")  # Hard constraint: tipo non ammesso
if score.score_totale == 0:
    → scartato ("score_zero")
```

Se il tipo di semirimorchio è incompatibile con il genere del viaggio (`score_tipo == 0`), la coppia viene **sempre esclusa** indipendentemente dagli altri componenti dello score. Questo è un **vincolo hard**: anche se score_distanza, score_autista e score_tempo sono alti, un `score_tipo=0` blocca l'assegnazione.

Esempio: semi CASSE_MOBILI o CENTINATO non possono essere assegnati a viaggi container scarico (che richiedono ROTOCELLA). Analogamente, un viaggio SILOS ammette solo semirimorchi SILOS.

### Filtro 10: Vincolo tipo semirimorchio per cliente

```python
vincolo_ok, motivo = verifica_vincolo_cliente_trailer(viaggio.cliente, semi.tipo)
if not vincolo_ok:
    → scartato ("vincolo_cliente_trailer")
```

Alcuni clienti richiedono **tassativamente** certi tipi di semirimorchio (merce su bancali che necessita container-compatible). Il match avviene per **substring case-insensitive** sul campo `viaggio.cliente` (nome o codice).

**Clienti con vincolo:**

| Cliente | Codice | Tipi ammessi | tipi_equivalenti | vincolo_scarico_km |
|---------|--------|-------------|:---:|:---:|
| ALBERTI E SANTI SRL | C.2945 | ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M | ✓ | — |
| KUKLA ITALIA SRL | C.349 | ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M | — | 100 km |
| METROCARGO ITALIA SRL | C.347 | ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M | ✓ | — |

**Opzioni aggiuntive:**

- **`tipi_equivalenti: true`** — Tutti i tipi in `tipi_obbligatori` sono considerati equivalenti (trasportano bancali → qualsiasi tipo va bene ugualmente). Lo score_tipo viene forzato a 1.0 per tutti i tipi ammessi, evitando penalizzazioni ingiuste basate sulla posizione nella lista priorità genere. Usato per ALBERTI E SANTI e METROCARGO.

- **`vincolo_scarico_km: N`** — Vincolo hard: il semirimorchio DEVE trovarsi entro N km dalla sede di carico del viaggio. Se la distanza è superiore o la posizione del semi è sconosciuta, la coppia viene esclusa (Filtro 10b). Usato per KUKLA ITALIA (100 km).

Configurato in `optimization.yaml` → `cliente_trailer_rules`. Presente in tutti e tre i metodi: `trova_migliore_coppia()`, `_trova_migliore_coppia_depot_swap()`, `_conta_coppie_compatibili()`.

---

## 3. Sistema di scoring

Lo score composito è calcolato in `valuta_assegnazione_coppia()` come media pesata di 4 componenti.

### Formula

```
score_totale = W_dist × score_distanza
             + W_tipo × score_tipo
             + W_autista × score_autista
             + W_tempo × score_tempo
             + W_rag × score_rag
```

### Pesi (default da `optimization.yaml`)

| Componente | Peso | Chiave YAML |
|-----------|------|-------------|
| Distanza | **0.25** | `weights.distance` |
| Tipo semirimorchio | **0.30** | `weights.trailer_match` |
| Fattibilità temporale | **0.20** | `weights.time_feasibility` |
| Esperienza autista | **0.15** | `weights.driver_experience` |
| Suggerimento RAG | **0.10** | `weights.rag_suggestion` |

I pesi devono sommare a 1.0.

---

### 3.1 Score distanza

Misura la vicinanza della coppia al luogo di carico.

**Formula esponenziale** (default):
```
score = exp(-distanza_km / decay_factor)
```

| km | Score |
|----|-------|
| 0 | 1.00 |
| 50 | 0.85 |
| 100 | 0.72 |
| 200 | 0.51 |
| 300 | 0.37 |
| 500 | 0.19 |

| Parametro | Default | YAML |
|-----------|---------|------|
| `decay_factor` | 300 | `distance.decay_factor` |
| `use_exponential` | true | `distance.use_exponential` |
| `max_distance_km` | 1000 km | `distance.max_distance_km` |
| `default_if_unknown` | 500 km | `distance.default_if_unknown` |

Se `use_exponential=false`, usa formula lineare legacy: `max(0, 1 - km/max_distance_km)`.

La distanza è calcolata tramite geocoding (Google Maps o OpenRouteService, configurabile in `settings.yaml` → `routing_provider`).

---

### 3.2 Score tipo semirimorchio

Determina la compatibilità tra il tipo di semirimorchio e il viaggio. Due modalità:

#### Modalità 1: Regole per genere (prioritaria)

Se il viaggio ha un campo `genere` valorizzato, il sistema cerca nella configurazione `genere_rules` la lista ordinata di semirimorchi ammessi per quel genere, tipo operazione (C/S) e presenza container.

**Regole genere configurate:**

| Genere | Con container (scarico) | Con container (carico) | Senza container (scarico) | Senza container (carico) |
|--------|------------------------|------------------------|--------------------------|--------------------------|
| **Silos** | SILOS | SILOS | SILOS | SILOS |

| Genere | Default | Note |
|--------|---------|------|
| **Flat combinato** | PORTACTR_9M, PORTACTR_13_6M, RIBALTABILE_9M, ROTOCELLA | |
| **Aspiratore** | SILOS | Richiede allestimento ASP |
| **Centinato** | CENTINATO | |

| Genere | Scarico | Carico/Trasporto |
|--------|---------|------------------|
| **Cantiere** | ROTOCELLA | ROTOCELLA, PORTACTR_9M, PORTACTR_13_6M, RIBALTABILE_9M |
| **Container combinato** | ROTOCELLA | ROTOCELLA, PORTACTR_9M, PORTACTR_13_6M, RIBALTABILE_9M |
| **Container stradale** | ROTOCELLA | ROTOCELLA, PORTACTR_9M, PORTACTR_13_6M, RIBALTABILE_9M |

#### Override SILOS → container_stradale (ROTOCELLA)

Per i viaggi con genere **SILOS**, il sistema verifica dinamicamente in `ElencoRichieste3` se il viaggio richiede effettivamente un semirimorchio ROTOCELLA anziché SILOS:

1. **Container valorizzato**: se il campo `Container` del BG è non vuoto → il genere viene overridato a `container_stradale` (→ ROTOCELLA + autista con `flag_rotocella`)
2. **TargaPrev2 = ROTOCELLA**: se `Container` è vuoto ma `TargaPrev2` è valorizzato e corrisponde a un semirimorchio di tipo ROTOCELLA in BERLINK (`trl_trailers.id_trailer_type`) → stessa override a `container_stradale`
3. **Nessuna condizione**: il viaggio resta SILOS con logica standard

Questa verifica avviene in `PlanningOptimizer._arricchisci_silos_container()`, chiamato in `ottimizza_da_database()` **prima** di `_arricchisci_vincolo_rotocella()`. Il lookup delle targhe BERLINK è batch per efficienza.

Il meccanismo cache-based in `data/bg_silos_container_stradale_cache.json` (usato in `Viaggio.from_api_response()`) resta come fallback aggiuntivo.

#### Vincolo ROTOCELLA per container combinato/stradale

Per i generi **container_combinato** e **container_stradale**, il sistema determina se il BG è la tratta di scarico del BG principale tramite la funzione TIR `dbo.GetBGScarico`:

1. Dal BG (es. `26A01415_04`) si estrae il BG base rimuovendo il suffisso `_xx` → `26A01415`
2. Si esegue: `select dbo.GetBGScarico('26A01415', 'S')`
3. Se il risultato coincide col BG del viaggio (es. `26A01415_04`) → **è la tratta di scarico** → ROTOCELLA obbligatoria
4. Se il risultato è diverso → è una tratta di carico/trasporto → ammessi tutti i tipi compatibili col genere

Questo vincolo è implementato in:
- `TIRConnector.get_bg_scarico()` — query TIR
- `Viaggio.richiede_rotocella` — flag settato al caricamento
- `PlanningOptimizer._arricchisci_vincolo_rotocella()` — logica di arricchimento
- `PlanningOptimizer._calcola_score_tipo_per_genere()` — score 0 se non ROTOCELLA

**Score per posizione nella lista di priorità:**

| Posizione | Score |
|-----------|-------|
| 1 (prima scelta) | **1.0** |
| 2 | **0.85** |
| 3 | **0.70** |
| 4 | **0.55** |
| 5 | **0.40** |

Se il tipo non è nella lista ammessa → **score 0.0** (incompatibile, filtro hard).

#### Modalità 2: Regole keyword (legacy/fallback)

Se il viaggio non ha genere, il sistema usa keyword matching sui campi del viaggio (cliente, destinatario, note, container) confrontandoli con le regole in `optimization.yaml` → `trailer_types`.

Per ogni tipo di semirimorchio sono definite:
- **`optimal_for`**: keyword che danno score alto (es. clienti chimici per silos → 1.0)
- **`penalized_for`**: keyword che danno score basso (es. liquidi per silos → 0.1)
- **`default_score`**: score se nessuna keyword matcha

| Tipo | Default score | Ottimale per | Penalizzato per |
|------|---------------|-------------|-----------------|
| Silos | 0.6 | Clienti chimici/plastici (1.0), prodotti granulari (0.95) | Liquidi (0.1), container (0.1) |
| Rotocella | 0.6 | Container (1.0), prodotti granulari (1.0), clienti chimici (0.95) | Liquidi (0.1), PVC/resina (0.4) |
| Portactr 9m/13.6m | 0.5 | Container (1.0) | Chimici sfusi (0.2), liquidi (0.1) |
| Centinato | 0.7 | Clienti siderurgici (1.0), coils/acciaio (1.0) | Chimici sfusi (0.3), liquidi (0.1) |
| Ribaltabile 9m | 0.5 | Inerti (1.0), container (1.0) | Chimici (0.4) |
| Esterno | 0.3 | — | — |

---

### 3.3 Score autista

Combina esperienza storica e zona di lavoro.

#### Esperienza storica

Basata sugli ultimi 30 giorni di storico (`history_days`):

| Condizione | Score | YAML |
|-----------|-------|------|
| Stesso cliente E stessa destinazione | **1.0** | `driver_experience.both_score` |
| Stesso cliente | **0.9** | `driver_experience.same_client_score` |
| Stessa destinazione | **0.8** | `driver_experience.same_destination_score` |
| Nessuno storico | **0.5** | `driver_experience.default_score` |
| Nessun autista assegnato | **0.5** | `driver_experience.no_driver_score` |

#### Fallback RAG (quando il learner non ha dati)

Quando `score_esperienza == 0.5` (nessun pattern storico nel learner), il sistema cerca nei suggerimenti RAG pre-calcolati. Se lo stesso autista è stato usato in casi simili accettati dall'operatore, il sub-score esperienza viene boostato a **0.65**.

Il matching autista usa normalizzazione (uppercase, rimozione numeri trailing) e confronto per token comuni (≥2) o substring bidirezionale per gestire variazioni nei nomi (es. "MARIO ROSSI" vs "ROSSI MARIO 1").

**Differenza col punto 1 (score RAG globale)**:
- Punto 1: score RAG nel composito pesato (peso 0.10), match exact su targa/autista
- Fallback RAG: agisce solo dentro `calcola_score_autista()`, solo quando il learner non ha dati, boost conservativo 0.65

#### Combinazione esperienza + zona

```python
if score_zona < 0.35:  # Mismatch estero/nazionale grave
    score = esperienza × 0.3 + zona × 0.7    # zona pesa molto
else:
    score = esperienza × 0.6 + zona × 0.4    # esperienza pesa di più
```

Vedi [sezione 6](#6-scoring-zona) per i dettagli sullo scoring zona.

#### Skill operativi (soft constraint)

Se le note del viaggio contengono keyword specifiche, viene verificato lo skill
operativo corrispondente dell'autista:

| Keyword nelle note | Flag skill | Effetto |
|-------------------|------------|---------|
| "lavaggio" | `flag_lavaggio_silos` | x0.7 se mancante, x1.1 se presente |
| "liner" | `flag_montaggio_liner` | x0.7 se mancante, x1.1 se presente |
| "copertura" | `flag_copertura_casse_mobili` | x0.7 se mancante, x1.1 se presente |

Il moltiplicatore viene applicato allo `score_totale` dopo il calcolo pesato.

---

### 3.4 Score tempo (fattibilità temporale)

Verifica se la coppia può raggiungere il luogo di carico in tempo.

```
tempo_viaggio = distanza / velocita_media
margine = tempo_disponibile - tempo_viaggio
```

**Formula continua** (default):
```
score = 1 - exp(-margine_ore / score_decay)
```

| Margine (ore) | Score |
|--------------|-------|
| 1 | 0.22 |
| 2 | 0.39 |
| 4 | 0.63 |
| 6 | 0.78 |
| 8 | 0.86 |
| 12 | 0.95 |

| Parametro | Default | YAML |
|-----------|---------|------|
| `use_continuous` | true | `time_feasibility.use_continuous` |
| `score_decay` | 4.0 | `time_feasibility.score_decay` |
| `average_speed_kmh` | 60 km/h | `time_feasibility.average_speed_kmh` |
| `min_margin_hours` | 1.0 h | `time_feasibility.min_margin_hours` |
| `business_start_hour` | 6:00 | `constraints.business_start_hour` |

Se `use_continuous=false`, usa soglie discrete legacy (12h→1.0, 6h→0.9, 2h→0.7, 1h→0.5).

Se la data_carico è solo una data (senza ora) o è 00:00, viene assunta l'ora di inizio giornata lavorativa (`business_start_hour`, default 6:00).

### 3.5 Score RAG (suggerimento da storico)

Pre-ottimizzazione: per ogni viaggio, query semantica su ChromaDB con (cliente, destinazione, genere).
Cerca precedenti simili con feedback ACCETTATA o PROPOSTA (non modificati dall'operatore).
Se il candidato corrente (targa/autista) corrisponde a un suggerimento RAG → bonus score.

| Condizione | Score |
|-----------|-------|
| Targa + autista confermati | **1.0** |
| Solo autista confermato | **0.8** |
| Solo targa confermata | **0.6** |
| Nessun match o nessun precedente | **0.5** (neutro) |

Soglia minima similarità: 0.7 (configurabile). Solo documenti con `feedback_stato` in ("", "PROPOSTA", "ACCETTATA").

Metodo: `PlanningRAG.get_suggerimenti_per_viaggi()` in `agent/planner/rag.py`.

---

## 4. Penalità e bonus

### Penalità non-arrivo

Se la coppia **non può arrivare in tempo** (margine < `min_margin_hours`):

```python
score_totale *= impossible_penalty  # default: 0.3 → riduzione del 70%
```

### Bonus/Malus impiego

Dopo il calcolo dello score composito, viene applicato un aggiustamento basato sull'impiego dell'autista:

```python
score_idoneita = peso_efficienza × efficienza + peso_saturazione × saturazione
score_totale = score_totale × (0.90 + 0.25 × score_idoneita)
```

Dove:
- **Efficienza** = `km_trasporto / (km_trasporto + km_vuoto)` — valore 0-1, più alto = meno km a vuoto
- **Saturazione** = `min(1.0, impiego_attuale% / 100)` — preferisce chi ha già lavorato (aggregazione viaggi)

L'effetto è un bonus/malus tra **-10%** e **+15%** sullo score totale. Il range più ampio rispetto alla versione precedente ([0.95, 1.05]) garantisce che autisti parzialmente impegnati e in zona vengano preferiti rispetto ad autisti freschi, saturando le risorse già attive prima di impegnarne di nuove.

| Parametro | Default | YAML (settings.yaml) |
|-----------|---------|-----|
| `peso_efficienza` | 0.5 | `planning.score_impiego.peso_efficienza` |
| `peso_saturazione` | 0.5 | `planning.score_impiego.peso_saturazione` |

### Km vuoto con indice rientro base

Per il **primo viaggio** della giornata, i km a vuoto vengono calcolati con una formula interpolata basata su `emp_driver_skills.indice_rientro_base`:

**Parametro `indice_rientro_base`:**

| Giorni fuori casa/sett | indice | Significato |
|---|---|---|
| 0 | 0.00 | Rientra TUTTE le sere (locale) |
| 2 | 0.36 | Rientra ~3.5 sere su 5.5 |
| 3 | 0.55 | Rientra ~2.5 sere su 5.5 |
| 5.5 | 1.00 | Non rientra MAI (lunga percorrenza) |

**Formula km vuoto — primo viaggio:**
```
D_bc = distanza(base → luogo_carico)
D_sb = distanza(luogo_scarico → base)
D_pc = distanza(posizione_corrente → luogo_carico)
i = indice_rientro_base

km_vuoto = (1 - i) × (D_bc + D_sb) + i × D_pc
```

**Formula km vuoto — viaggio successivo:**
```
km_vuoto = D_pc + (1 - i) × D_sb
```
L'autista è già fuori (non parte da base), ma deve rientrare dopo lo scarico con probabilità `(1-i)`.

- Con indice 0: primo viaggio = round-trip dalla base; successivi = posizionamento + ritorno a base
- Con indice 1: km_vuoto = solo posizionamento (nessun ritorno)
- Valori intermedi: media pesata probabilistica

**Impatto:** il km_vuoto calcolato con questa formula viene usato in:
- **score_distanza**: `exp(-km_vuoto / decay_factor)`
- **sostenibilità**: `costo = (km_trasporto + km_vuoto) × euro_km`
- **impiego**: `score_impiego = (km_trasporto + km_vuoto + ...) / capacità`
- **efficienza**: `km_trasporto / (km_trasporto + km_vuoto)`

### Tie-breaking

Quando due coppie hanno score totale identico, l'ottimizzatore usa criteri
di tie-breaking deterministici:

1. **Minor impiego attuale** (autista meno carico)
2. **Autista interno** preferito su esterno
3. **Più vicino a un depot** (Fiorenzuola o Terni)

---

## 5. Logiche speciali

### 5.1 Coppie future

Le coppie "future" sono create da `crea_coppie_da_tratte_assegnate()`:

- Per ogni viaggio **già assegnato**, il semirimorchio sarà disponibile al **luogo di scarico** dopo la **data di scarico**
- La coppia futura mantiene lo stesso autista della coppia originale
- È soggetta al filtro di disponibilità temporale (filtro 2)

### 5.2 Impiego autista

Il sistema `ImpiegoAutista` traccia il carico giornaliero cumulativo:

```
score_impiego% = 100 × (km_trasporto + km_vuoto + km_equivalenti_scarico) / capacita_giornaliera
```

| Parametro | Default | YAML (settings.yaml) |
|-----------|---------|-----|
| `capacita_giornaliera_km` | 600 km | `planning.score_impiego.capacita_giornaliera_km` |
| `tempo_scarico_ore` | 2.0 h | `planning.score_impiego.tempo_scarico_ore` |
| `velocita_media_kmh` | 60 km/h | `planning.score_impiego.velocita_media_kmh` |
| `fattore_strada` | 1.4 | `planning.score_impiego.fattore_strada` |
| `soglia_esclusione_percent` | 80% | `planning.score_impiego.soglia_esclusione_percent` |

I **km equivalenti scarico** convertono il tempo di scarico in km:
```
km_equiv = ore_scarico × velocita_media = 2.0 × 60 = 120 km per ogni scarico
```

### 5.3 Compatibilità esterni

Regola di matching **bidirezionale** per risorse esterne:

1. **Semirimorchio interno** → qualsiasi autista interno (no vettori)
2. **Semirimorchio esterno** → richiede autista esterno con keyword corrispondente
   - La keyword viene estratta dalla targa del semirimorchio (parte alfabetica)
   - Deve corrispondere al nome dell'autista
   - Se la keyword non è estraibile, accetta qualsiasi autista esterno
3. **Autista esterno (vettore)** → DEVE usare solo semirimorchi esterni corrispondenti
   - Non può essere assegnato a semirimorchi interni
   - Non partecipa al depot swap (escluso dal pool autisti liberi)
   - Il vincolo è applicato in `verifica_compatibilita_esterno()` come filtro hard

### 5.4 Vincoli carrier

Definiti in `optimization.yaml` → `driver_zone_rules.carriers`:

| Carrier | Vincolo `solo_container` | Regioni | Zone carico |
|---------|------------------------|---------|-------------|
| BONALDI | No | Veneto | Verona |
| PIEMME | No | Veneto | Verona |
| TREBISACCE | No | Piemonte, Lombardia | Novara, Busto Arsizio, Milano |
| SLI | No | Emilia Romagna, Lombardia | Fiorenzuola |
| CTS | No | Campania, Lazio | Nola, Piedimonte San Germano, Pomezia |
| TRANSEMDO | **Si** | Spagna | Tarragona |
| MARE COMBINATO | **Si** | Spagna | Tarragona |
| LOGISTIC HOLDING | **Si** | Spagna | Tarragona |

Il vincolo `solo_container` è un **filtro hard** (filtro 5). Le zone carico/regioni sono usate come **preferenza soft** nello scoring zona.

### 5.5 Vincoli specifici autisti

Definiti in `settings.yaml` → `planning.vincoli_autisti`:

| Autista | Vincolo | Descrizione |
|---------|---------|-------------|
| Angrej Singh | `solo_zone: ["Terni"]` | Solo viaggi con carico E scarico nella zona di Terni (raggio 30 km) |

La verifica usa geocoding con fallback a substring matching.

### 5.6 Viaggi programmati vs non programmati

Un viaggio è considerato **programmato** (`e_assegnato == True`) se:
- Il campo `Vettore` è valorizzato
- Il vettore **non** è un placeholder

**Vettori placeholder** (da `settings.yaml` → `planning.vettori_placeholder`):
- `*C.0000`
- `GUIDO BERNARDINI SRL INTERMODALE`
- `BERNARDINI SRL INTERMODALE`

Solo i viaggi **non programmati** vengono elaborati dall'ottimizzatore.

### 5.7 Vincolo BTEU (Giussano→Finlandia, Mornico→Svezia)

Viaggi caricati da **Giussano** con destinazione finale **Finlandia** e da **Mornico** con destinazione finale **Svezia** devono usare container **BTEU**. I BTEU sono disponibili solo a **Fiorenzuola**, quindi l'autista deve transitare da Fiorenzuola per caricare il container sul semirimorchio.

**Rotte BTEU:**

| Luogo carico | Stato destinazione | Depot BTEU |
|---|---|---|
| Giussano | Finland | Fiorenzuola |
| Mornico | Sweden | Fiorenzuola |

**Determinazione destinazione finale:** si usa il BG principale (senza suffisso `_xx`). Per es. `26A01234_02` si guarda `StatoS` del BG `26A01234` in `ElencoRichieste3`.

**Impatto sul calcolo km vuoto:**
```
km_vuoto = autista → Fiorenzuola + Fiorenzuola → sede_carico (Giussano/Mornico)
```

Il vincolo BTEU **non** impone un tipo di semirimorchio specifico — il BTEU è un container che si carica su qualsiasi portacontainer. Il tipo semi è già gestito dal genere del viaggio.

**Codice:**
- `Viaggio.richiede_bteu` / `Viaggio.bteu_depot` — flag e depot di transito
- `TIRConnector.get_stato_scarico_bg_principale()` — query stato destinazione BG base
- `PlanningOptimizer._arricchisci_vincolo_bteu()` — logica di arricchimento
- Override km vuoto in `valuta_assegnazione_coppia()` e `trova_migliore_coppia()`

### 5.5 Viaggi lunghi (multi-day)

Viaggi con `distanza_trasporto_km > soglia_km` (default 650 km) che normalmente verrebbero esclusi dai filtri di capacità giornaliera e ore guida EU 561, possono essere pianificati su più giorni se:

1. `distanza_trasporto_km > soglia_km` (configurabile in `optimization.yaml`)
2. `data_scarico.date() > data_carico.date()` (non lo stesso giorno)
3. `giorni_disponibili * km_giornalieri_max >= distanza_km` dove `giorni_disponibili = (data_scarico - data_carico).days + 1`

**Ordine di pianificazione**: prima tutti i viaggi normali (primo passaggio + depot-swap), poi i viaggi lunghi con le risorse rimaste.

**Filtri bypassati** per viaggi lunghi:
- Filter 7 (impiego saturo / score proiettato > 100%)
- Filter 8b (ore guida > 9h EU 561)

Tutti gli altri filtri (tipo semi, disponibilità temporale, zona, distanza autista) restano attivi.

**Dopo assegnazione**: l'autista viene saturato (`km_trasporto = capacita_giornaliera`) e non riceve altri viaggi per quel giorno.

**Configurazione** (`config/optimization.yaml`):
```yaml
viaggi_lunghi:
  soglia_km: 650           # Oltre questa distanza = viaggio lungo
  km_giornalieri_max: 650  # Km percorribili per giorno
```

**Implementazione**: `_e_viaggio_lungo_pianificabile()` in `optimizer.py`, terzo passaggio in `genera_pianificazione_coppie()`.

---

## 6. Determinazione posizione autisti/semirimorchi

La posizione delle coppie autista-semirimorchio è determinata in `get_coppie_disponibili()` (`berlink_connector.py`) secondo una cascata di priorità.

### Pipeline di determinazione posizione

```
get_coppie_disponibili(data_pianificazione)
│
├─ ESTRAI BG: cerca pattern #ddLddddd nel planning_raw
├─ FILTRO CONSEGNA: se data futura E nessun BG → SKIP (se ha BG → rimanda a TIR nell'optimizer)
│
├─ PRIORITÀ 1: Planning del giorno stesso (data_pianificazione)
│   ├─ estrai_destinazione_da_planning(planning_raw)
│   │   → Dove arriverà il semirimorchio (destinazione del viaggio in corso)
│   └─ Fallback: estrai_posizione_da_planning(planning_raw)
│       → Dove si trova il semirimorchio ora (luogo di carico/partenza)
│
├─ PRIORITÀ 2: Planning del giorno precedente (data_pianificazione - 1)
│   ├─ get_ultima_posizione_semirimorchio(id_trailer, data_pianificazione)
│   │   ├─ Cerca planning del giorno precedente
│   │   │   ├─ estrai_destinazione_da_planning() → posizione proiettata
│   │   │   └─ Fallback: estrai_posizione_da_planning()
│   │   └─ Fallback storico: cerca negli ultimi N giorni (STORICO_MAX_DAYS)
│   └─ posizione_da_planning_precedente = True
│
├─ PRIORITÀ 3: LLM fallback parser
│   └─ Se planning_raw presente ma non parsabile con regex → LLM parse batch
│
├─ RIENTRO BASE WEEKEND (dopo PRIORITÀ 2)
│   ├─ Se posizione da lookback storico E weekend tra data_planning_trovato e data_pianificazione
│   │   E autista ha skills.base_autista → posizione sovrascritta con base
│   ├─ posizione_pre_rientro_base = posizione originale (per calcolo km extra)
│   ├─ km_rientro_base = distanza(posizione_originale → base) aggiunta ai km a vuoto
│   └─ Visualizzazione: asterisco (*) vicino ai km vuoto nella tabella
│
├─ PRIORITÀ 4: Base autista (emp_driver_skills.base_autista in BERLINK)
│   ├─ Se autista senza posizione E skills.base_autista non vuoto → usa base
│   ├─ posizione_da_base_vettore = True
│   └─ Configurazione: colonna base_autista nella tabella emp_driver_skills
│
├─ PRIORITÀ 5: GPS da WayTracker (arricchisci_con_gps)
│   ├─ Se GPS recente (< 24 ore) E NON c'è posizione proiettata → usa GPS
│   ├─ Se GPS vecchio E nessuna posizione valida → posizione_da_chiedere = True
│   └─ Se c'è posizione proiettata dal planning precedente → GPS ignorato
│       (la posizione proiettata indica dove SARÀ, non dove È ORA)
│
└─ Se nessuna posizione trovata → posizione_da_chiedere = True (richiede input utente)
```

Dopo la creazione delle coppie, l'optimizer esegue un **arricchimento posizioni da TIR**:

```
optimizer.ottimizza(coppie, ...)
│
├─ _arricchisci_posizioni_bg(coppie, tir, data_pianificazione)
│   ├─ Raccoglie tutti i viaggio_in_corso_bg dalle coppie
│   ├─ Query batch: tir.get_posizione_per_bg(bg_list, data)
│   │   └─ Per ogni BG, cerca tratte figlie (LIKE '{bg_base}%')
│   │       con TipoTratta='1' (Camion) e DataS <= data_pianificazione
│   │       → ritorna LuogoS della tratta più recente
│   ├─ Sovrascrive posizione text-parsed con posizione TIR
│   │   → log "posizione_bg_arricchita | semi=XX | text_pos=A → tir_pos=B"
│   └─ Resetta coordinate per forzare re-geocoding
│
└─ _valida_posizioni_bg(coppie, tir, data_pianificazione)
    ├─ Query batch: tir.get_data_scarico_per_bg(bg_list)
    ├─ Filtra coppie con data_scarico > data_pianificazione
    └─ → log "posizione_bg_futura_filtrata"
```

Questo step è **cruciale** perché il text parsing del campo planning è inaffidabile: può estrarre la destinazione finale (es. "Terni") anche se il semirimorchio è in realtà fermo al punto di carico (es. "Fiorenzuola"). La query TIR restituisce il dato strutturato dalla tratta reale.

### Parser di posizione (`position_parser.py`)

Il parser estrae località dal testo libero del campo planning. Due funzioni principali:

| Funzione | Scopo | Esempio input | Output |
|----------|-------|---------------|--------|
| `estrai_posizione_da_planning()` | Dove SI TROVA il semirimorchio | `"#26A01426 \| Carica Patrica per Palazzo"` | `"Patrica"` |
| `estrai_destinazione_da_planning()` | Dove ARRIVERÀ il semirimorchio | `"#26A01426 \| Carica Patrica per Palazzo"` | `"Palazzo"` |
| `estrai_data_consegna()` | Data di consegna (filtraggio) | `"Consegna 10/03/2026"` | `date(2026,3,10)` |

**Formati planning supportati:**

| Pattern | Posizione estratta | Destinazione estratta |
|---------|-------------------|----------------------|
| `"#ID \| Carica X per Y"` | X | Y |
| `"X → Y"` / `"X > Y"` | X | Y |
| `"Consegna [a] LUOGO"` | LUOGO | LUOGO |
| `"A FIORENZUOLA"` | Fiorenzuola | Fiorenzuola (stazionario) |
| `"SEDE"` o `"SEDE TERNI"` | Terni (alias) | Terni (alias) |
| `"IN NOVAMONT"` | Terni (azienda→località) | Terni |
| `"Multi + segmenti"` | ultimo segmento | ultimo segmento |

**Alias e normalizzazioni:**

- `SEDE` → `Terni` (sede aziendale)
- `FIORE`/`FIOR` → `Fiorenzuola`
- `BARC` → `Barcellona`
- Aziende: `NOVAMONT` → `Terni`, `BASELL` → `Ferrara`, `VERSALIS` → `Mantova`
- Località estere: aggiungi paese per geocoding (es. `BARCELLONA` → `Barcelona, Spain`)

### Base autista (fallback posizione)

Alcuni autisti hanno una "base" (citta di riferimento) dove ritornano abitualmente. Quando un autista non ha posizione nota (planning mancante, GPS vecchio), il sistema usa la base come posizione di fallback.

**Configurazione**: colonna `base_autista` nella tabella `emp_driver_skills` in BERLINK. Il valore viene caricato nel DTO `DriverSkills.base_autista` insieme alle altre competenze.

**Meccanismo:**
- Se `autista.skills.base_autista` non e vuoto e l'autista non ha posizione valida → usa la base
- `basi_vettori_lookback_giorni` (default 2) controlla quanti giorni indietro cercare nel planning storico prima del fallback
- Flag trasparenza: `coppia.posizione_da_base_vettore = True`
- GPS recente (< 24h) da WayTracker puo sovrascrivere la base (arricchisci_con_gps gira dopo)

**Rientro base weekend:**
Se la posizione proviene da un planning storico e tra quel planning e la data di pianificazione c'e almeno un weekend (sabato o domenica), l'autista con base viene considerato in partenza dalla base. La distanza dal luogo di scarico precedente alla base viene sommata ai km a vuoto (indicata con asterisco * nella tabella). Esempio: planning venerdi a Roccabianca, pianificazione lunedi, base Terni → partenza da Terni, km vuoto = km(Roccabianca→Terni) + km(Terni→luogo_carico).

### Regole chiave

1. **Planning odierno ha priorità assoluta**: se esiste un planning per il giorno di pianificazione, la posizione viene da quello (destinazione), ignorando planning precedente e GPS
2. **Posizione proiettata protegge da GPS**: se la posizione viene dal planning del giorno precedente, il GPS non la sovrascrive (il GPS mostra dove È ora, ma il planning indica dove SARÀ)
3. **Consegna futura**: il comportamento dipende dalla presenza di un BG nel planning (vedi sezione 6.1)
4. **Consegna stesso giorno = disponibile**: ma con score impiego che tiene conto del viaggio in corso
5. **Senza posizione ≠ escluso**: la coppia viene creata con `posizione_da_chiedere=True`, non utilizzabile dall'optimizer ma visibile all'utente

### 6.1 Filtro data consegna: TIR primario, text fallback

Il filtro data consegna determina se un semirimorchio è impegnato in un trasporto futuro. Usa un sistema a **due livelli** per evitare falsi positivi dal text parsing del campo planning (testo libero, inaffidabile).

#### Problema risolto

Il campo planning può contenere date di consegna che non riflettono la reale disponibilità del semirimorchio. Esempio: BG 26A01735 ha `data_scarico = 30/03` nel TIR, ma il planning contiene "Consegna 30/03" che il text parser interpreta come "risorsa impegnata fino al 30/03". In realtà il semirimorchio potrebbe essere libero prima.

#### Architettura a due livelli

```
planning_raw del semirimorchio
│
├─ 1. Estrai BG (pattern #ddLddddd) dal planning_raw
│
├─ 2. estrai_data_consegna(planning_raw) → data_consegna
│   │
│   └─ Se data_consegna > data_pianificazione:
│       │
│       ├─ Semirimorchio SENZA BG → FILTRA (text è unica fonte)
│       │   → continue, coppia esclusa da berlink_connector
│       │
│       └─ Semirimorchio CON BG → NON FILTRARE, passa all'optimizer
│           → log "SKIP filtro text per {targa}: ha BG {bg}, rimanda a TIR"
│
└─ 3. Optimizer: _valida_posizioni_bg() [solo coppie con BG]
    ├─ Query batch TIR: get_data_scarico_per_bg() → [Data Scarico] reale
    ├─ Se data_scarico > data_pianificazione → FILTRA (dato autoritativo TIR)
    │   → log "posizione_bg_futura_filtrata"
    └─ Se data_scarico <= data_pianificazione → OK, coppia utilizzabile
```

#### Livello 1: Text parsing in `berlink_connector.py` (fallback)

- **Quando**: coppie **senza BG** nel planning
- **Come**: `estrai_data_consegna()` cerca pattern "Consegna dd/mm" o "Cons dd/mm" nel testo
- **Affidabilità**: bassa (campo libero, formato non garantito)
- **Azione**: `continue` — coppia esclusa

#### Livello 2: Query TIR in `optimizer.py` (autoritativo)

- **Quando**: coppie **con BG** nel planning
- **Come**: `_valida_posizioni_bg()` → `tir_connector.get_data_scarico_per_bg()` → query `[Data Scarico]` dal database TIR
- **Affidabilità**: alta (dato strutturato dal gestionale)
- **Azione**: coppia filtrata con log `posizione_bg_futura_filtrata`

#### File coinvolti

| File | Metodo | Ruolo |
|------|--------|-------|
| `berlink_connector.py` | `get_coppie_disponibili()` | Estrae BG, applica text filter solo se no BG |
| `tir_connector.py` | `get_posizione_per_bg()` | Query batch tratte figlie → LuogoS più recente ≤ data |
| `tir_connector.py` | `get_data_scarico_per_bg()` | Query batch `[Data Scarico]` dal TIR |
| `optimizer.py` | `_arricchisci_posizioni_bg()` | Sovrascrive posizione text-parsed con LuogoS da TIR |
| `optimizer.py` | `_valida_posizioni_bg()` | Filtra coppie con BG e data_scarico futura |

#### Log di debug

| Messaggio | Significato |
|-----------|-------------|
| `SKIP filtro text per {targa}` | Text filter bypassato, coppia con BG passa all'optimizer |
| `posizione_bg_arricchita` | Posizione sovrascritta: text-parsed → LuogoS da tratta TIR |
| `posizione_bg_futura_filtrata` | Optimizer ha filtrato coppia via TIR (data_scarico futura) |
| `FILTRATO {targa}: consegna ...` | Text filter ha filtrato coppia senza BG |

### Associazione autista

L'autista viene associato al semirimorchio con questa cascata:

1. **Planning odierno**: autista assegnato nel campo `id_employee` del planning del giorno
2. **Fallback storico**: `get_ultimo_autista_semirimorchio()` cerca l'ultimo autista nei planning degli ultimi 7 giorni
3. **Deduplica**: se lo stesso autista appare su più semirimorchi (da storico), vince la coppia dal planning odierno o quella con data storico più recente

Gli autisti con consegna futura su **qualsiasi** semirimorchio vengono marcati come impegnati e non riassegnati ad altri semirimorchi né da planning né da fallback storico.

---

## 7. Scoring zona

Lo scoring zona valuta la compatibilità geografica tra autista e viaggio. Implementato in `OptimizationConfig.calcola_score_zona()`.

### Gruppi autisti interni

Definiti in `optimization.yaml` → `driver_zone_rules.internal_drivers`:

| Gruppo | Autisti | Regioni | Zone carico | Estero |
|--------|---------|---------|-------------|--------|
| italia_centrale | Antonio Frezzini, Giuseppe Colletti, Angrej Singh | Umbria | Terni | No |
| estero | Tiberiu Calancea, Viorel Bouariu, Laurentiu Ioan Alexandroei, Franco Candia Amintore | — | — | Si |

### Logica di scoring

```
1. Cerca autista nei gruppi interni (match per nome)
2. Se non trovato, cerca carrier nelle regole trazionisti (match per nome)
3. Se nessuna regola trovata → score 0.5 (neutro)
4. Altrimenti:
```

| Condizione | Score | Motivo |
|-----------|-------|--------|
| Autista estero + viaggio estero | **1.0** | autista in zona abituale |
| Autista estero + viaggio nazionale | **0.3** | autista estero su tratta nazionale |
| Autista nazionale + viaggio estero | **0.2** | autista nazionale su tratta estero |
| Zona carico + regione scarico match | **1.0** | autista in zona abituale (carico e scarico) |
| Solo zona carico match | **0.9** | autista in zona abituale (zona carico) |
| Solo regione scarico match | **0.8** | autista in zona abituale (regione) |
| Nessun match | **0.4** | autista fuori zona abituale |
| Nessuna regola trovata | **0.5** | nessuna regola zona |

### Verifica geografica

- **Zona carico**: geocoding + distanza Haversine, soglia **30 km**
- **Regione scarico**: reverse geocoding per ottenere la regione, con fallback a mappa città
- **Viaggio estero**: bounding box Italia (lat 35.5-47.5, lon 6.0-19.0), fallback keyword

**Mappa fallback regione → città** (usata quando il reverse geocoding fallisce):

| Regione | Città |
|---------|-------|
| Veneto | Verona, Vicenza, Padova, Venezia, Treviso, Belluno, Rovigo |
| Piemonte | Torino, Novara, Alessandria, Asti, Cuneo, Vercelli, Biella |
| Lombardia | Milano, Brescia, Bergamo, Monza, Como, Varese, Pavia, Mantova, Cremona, Busto Arsizio |
| Emilia Romagna | Bologna, Modena, Parma, Reggio Emilia, Ferrara, Ravenna, Rimini, Forli, Piacenza, Fiorenzuola |
| Umbria | Terni, Perugia, Foligno, Spoleto, Orvieto, Citta di Castello |
| Campania | Napoli, Salerno, Caserta, Avellino, Benevento, Nola, Pozzuoli |
| Lazio | Roma, Frosinone, Latina, Viterbo, Rieti, Piedimonte San Germano, Pomezia, Civitavecchia |

---

## 8. Configurazione

### config/optimization.yaml — Valori chiave

```yaml
# Pesi (somma = 1.0)
weights:
  distance: 0.25
  trailer_match: 0.30
  time_feasibility: 0.20
  driver_experience: 0.15
  rag_suggestion: 0.10

# Distanza
distance:
  max_distance_km: 1000       # Fallback lineare
  default_if_unknown: 500      # Se geocoding fallisce
  max_driver_distance_km: 350  # Filtro hard
  decay_factor: 300            # Fattore decadimento esponenziale
  use_exponential: true        # Formula esponenziale (default)

# Tempo
time_feasibility:
  average_speed_kmh: 60
  min_margin_hours: 1.0        # Margine minimo fattibilità
  use_continuous: true         # Formula continua (default)
  score_decay: 4.0             # Fattore decadimento
  impossible_score: 0.1        # Score se non può arrivare
  impossible_penalty: 0.3      # Moltiplicatore score totale

# Esperienza autista
driver_experience:
  history_days: 30
  same_client_score: 0.9
  same_destination_score: 0.8
  both_score: 1.0
  default_score: 0.5

# Vincoli normativi (EU 561/2006)
constraints:
  max_daily_hours: 9
  min_rest_hours: 11
  max_weekly_hours: 56
  business_start_hour: 6

# Vincoli tipo semi per cliente
cliente_trailer_rules:
  "ALBERTI E SANTI":
    codice: "C.2945"
    tipi_obbligatori: [ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M]
    tipi_equivalenti: true       # tutti i tipi → score 1.0
  "KUKLA ITALIA":
    codice: "C.349"
    tipi_obbligatori: [ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M]
    vincolo_scarico_km: 100      # semi deve essere entro 100km dal carico
  "METROCARGO ITALIA":
    codice: "C.347"
    tipi_obbligatori: [ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M]
    tipi_equivalenti: true

# Scoring zone
driver_zone_rules:
  scoring:
    zona_match_score: 1.0
    zona_mismatch_score: 0.4
    estero_su_nazionale_score: 0.3
    nazionale_su_estero_score: 0.2
```

### config/settings.yaml — Valori chiave

```yaml
# Score impiego autisti
planning:
  score_impiego:
    capacita_giornaliera_km: 600
    peso_efficienza: 0.5
    peso_saturazione: 0.5
    soglia_esclusione_percent: 80
    fattore_strada: 1.4
    tempo_scarico_ore: 2.0
    velocita_media_kmh: 60

  # Regole guida EU 561/2006
  regole_guida:
    max_guida_giornaliera_ore: 9
    max_guida_giornaliera_estesa_ore: 10
    max_estensioni_settimanali: 2
    max_guida_continua_ore: 4.5
    pausa_obbligatoria_minuti: 45
    riposo_giornaliero_ore: 11
    riposo_giornaliero_ridotto_ore: 9
    max_guida_settimanale_ore: 56
    max_guida_bisettimanale_ore: 90
    riposo_settimanale_ore: 45
    max_giorni_guida_consecutivi: 6

  # Vettori placeholder (viaggi NON programmati)
  vettori_placeholder:
    - "*C.0000"
    - "GUIDO BERNARDINI SRL INTERMODALE"
    - "BERNARDINI SRL INTERMODALE"

  # Vincoli individuali autisti
  vincoli_autisti:
    "Angrej Singh":
      solo_zone: ["Terni"]
```

---

## 9. Gestione Cache Geocoding

Il sistema di geocoding utilizza un'architettura a più livelli di cache per minimizzare le chiamate API e migliorare la precisione.

### Livelli di cache (ordine di priorità)

#### 9.1 KNOWN_COORDINATES (hard-coded)

Coordinate fisse in memoria per località problematiche o ambigue (es. "Gron" in Italia vs Francia, "Lavezzola").

- Nessuna scadenza
- Definite nel codice sorgente (`geocoding.py`, dizionario `KNOWN_COORDINATES`)

#### 9.2 Valkey (Redis)

Cache distribuita con TTL configurabile.

| Parametro | Valore |
|-----------|--------|
| Host | `192.168.0.12:6379` |
| TTL | 720 ore (30 giorni) |
| Configurazione | `config/settings.yaml` → `valkey` + `geocode.cache` |

**Formato chiavi:**

| Tipo | Formato | Esempio |
|------|---------|---------|
| Coordinate | `geo:fwd:{localita}\|{paese}` | `geo:fwd:lavezzola\|italy` |
| Distanze | `geo:dist:{da}\|{a}\|{provider}` | `geo:dist:lavezzola\|bologna\|google` |
| Regione (reverse) | `geo:rev:regione:{localita}` | `geo:rev:regione:lavezzola` |

**Degradazione:** se Valkey non è raggiungibile (timeout 2s), il sistema continua senza errori usando i livelli successivi.

#### 9.3 File cache locale

Cache persistente su disco in formato JSON.

| Parametro | Valore |
|-----------|--------|
| File | `data/geocoding_cache.json` |
| Chiave | MD5 di `{localita}\|{paese}` (16 chars) |
| Scadenza | Nessuna (manuale) |

- Caricata in memoria all'avvio (`_cache` dict)
- Salvata su disco ad ogni aggiornamento
- Valori `None` memorizzati per evitare retry su località non trovate (negative caching)
- Invalidazione: cancellare manualmente il file

#### 9.4 TIR Location Cache

Cache delle informazioni località dal database TIR (CAP, stato). Non fornisce coordinate ma **arricchisce** la query di geocoding.

| Parametro | Valore |
|-----------|--------|
| File | `data/tir_location_cache.json` |
| Chiave | `localita.lower().strip()` |
| Scadenza | Nessuna |

**Struttura valori:**
```json
{
  "lavezzola": {"luogo": "Lavezzola", "cap": "48017", "stato": "Italy"},
  "gron": {"luogo": "Gron", "cap": "89100", "stato": "France"},
  "romania": null
}
```

- `null` = cercata nel DB TIR ma non trovata
- `dict` = info trovata con campi `luogo`, `cap`, `stato`
- Il CAP e lo stato vengono aggiunti alla query per migliorare la precisione

**Validazione paese:** se il chiamante ha rilevato un paese specifico (diverso dal default "Italy") e il TIR cache riporta uno stato diverso, il sistema dà priorità al paese del chiamante e logga un warning. Questo protegge da dati errati nel database TIR (es. "Blaye les Mines" con stato="Italy" invece di "France").

#### 9.5 API di geocoding (nessuna cache, fonte dati)

Ultimo livello - chiamata effettiva ai provider:

| Provider | Ruolo | Note |
|----------|-------|------|
| Google Maps | Primario (se configurato) | |
| ORS (OpenRouteService) | Primario (default) | Cooldown 120s su HTTP 429 |
| Nominatim (OSM) | Fallback universale | Rate limit 1.1s tra richieste |

I risultati vengono salvati in Valkey + file cache.

### Flusso di lookup

```
geocode("Lavezzola", paese="Italy")
  │
  ├─ 1. KNOWN_COORDINATES? → hit → return
  ├─ 2. Valkey?            → hit → return
  ├─ 3. File cache?        → hit → return
  ├─ 4. TIR Location DB    → arricchisce query con CAP/stato
  │     └─ Validazione: se paese chiamante ≠ stato TIR → usa paese chiamante
  └─ 5. API provider       → Google/ORS + fallback Nominatim
        └─ Salva risultato in Valkey + file cache
```

### Normalizzazione chiavi

| Livello | Normalizzazione |
|---------|-----------------|
| Valkey | strip → lowercase → normalizza spazi → `geo:fwd:{loc}\|{paese}` |
| File | strip → lowercase → `{loc}\|{paese}` → MD5 (16 chars) |
| TIR | `localita.lower().strip()` |

### Cache distanze

Le distanze tra località sono cachate separatamente in Valkey:
- Chiave include il provider (`google`/`ors`) per evitare mix tra API diverse
- Fallback calcolo: ORS routing → Google Directions → Haversine (geodetica)

### Invalidazione

| Livello | Metodo |
|---------|--------|
| KNOWN_COORDINATES | Modifica codice |
| Valkey | Auto-expire (TTL 30 giorni) |
| File cache | Cancellare `data/geocoding_cache.json` |
| TIR Location | Cancellare `data/tir_location_cache.json` |

---

### 5.7 Mapping TIPO_QUERY

Il campo `TIPO_QUERY` del database TIR indica il tipo di operazione del viaggio. Mapping in `viaggio.py`:

| TIPO_QUERY | TipoViaggio | Note |
|------------|-------------|------|
| `S` | SCARICO | |
| `C` | CARICO | |
| `P` | CARICO | Pickup, trattato come carico |
| `T` | TRIANGOLAZIONE | |

---

### 5.8 Secondo passaggio: Depot Trailer Swap

Dopo il primo passaggio di ottimizzazione, alcuni viaggi restano senza soluzione perché nessuna coppia autista-semirimorchio esistente è compatibile/vicina. Il **secondo passaggio** crea coppie "virtuali" combinando:

- **Autisti liberi** (non saturi) posizionati vicino alla partenza del viaggio
- **Semirimorchi compatibili** posizionati ai depositi (Fiorenzuola o Terni)

#### Flusso

```
genera_pianificazione_coppie()
│
├─ Primo passaggio (standard): trova_migliore_coppia() per ogni viaggio
│
└─ Se restano viaggi non assegnati:
    └─ _secondo_passaggio_depot_swap()
        ├─ _trova_semirimorchi_depot() → semi non assegnati ai depositi
        ├─ _trova_autisti_liberi() → autisti non saturi (anche con capacità residua)
        └─ Per ogni viaggio:
            └─ _trova_migliore_coppia_depot_swap()
                ├─ Per ogni combinazione autista × semi_depot:
                │   ├─ Filtri hard (skill, esterno, carrier, zona autista)
                │   ├─ Distanza: km_autista→depot + km_depot→partenza ≤ 350km
                │   ├─ Impiego proiettato ≤ 100%
                │   ├─ Score via valuta_assegnazione_coppia() (depot→partenza)
                │   └─ Penalità: score *= max(0.5, 1 - km_autista_depot/350 × 0.3)
                └─ Assegna coppia con score più alto
```

#### Vincoli

| Vincolo | Valore | Note |
|---------|--------|------|
| Distanza massima a vuoto | 350 km | `km_autista→depot + km_depot→partenza` |
| Depositi | Fiorenzuola, Terni | Costante `DEPOT_LOCATIONS` |
| Filtri hard | Stessi del primo passaggio | skill, esterno, carrier, zona, tipo semi |
| Penalità tratta autista→depot | score × max(0.5, 1 - ratio × 0.3) | Più lontano il depot, più penalizzato |

#### Note nell'assegnazione

Le assegnazioni depot-swap sono identificabili dal campo `note` che contiene il prefisso `DEPOT-SWAP:` con dettagli delle distanze percorse.

#### Log

Tutti i messaggi di log sono prefissati con `[DEPOT-SWAP]`:
- `[DEPOT-SWAP] Semirimorchi ai depositi: N`
- `[DEPOT-SWAP] Autisti liberi (non saturi): N`
- `[DEPOT-SWAP] Assegnato BG_ID: autista=..., semi=... @ depot, score=..., km_vuoto_totale=...`
- `[DEPOT-SWAP] Fine: N assegnati, M ancora da assegnare`

---

## 10. Feedback Loop

**File**: `agent/planner/feedback.py`

Il feedback loop confronta le proposte dell'ottimizzatore con le assegnazioni finali effettuate dall'operatore in TIR, misurando l'efficacia delle proposte e alimentando il learner con i pattern di override.

### Flusso

1. **Salvataggio proposta** — automatico alla fine di `genera_pianificazione_coppie()`, salva in `data/proposte/proposta_YYYYMMDD_HHmmss.json`
2. **Confronto** — su richiesta (`python run.py confronta <data>` o tool LLM `confronta_pianificazione`), confronta proposta vs stato finale TIR
3. **Report** — salva in `data/feedback/feedback_YYYYMMDD.json` con acceptance rate e dettaglio override
4. **Learning** — alimenta `data/learned_patterns.json` con le assegnazioni finali degli override

### Classificazione assegnazioni

| Stato | Condizione |
|-------|------------|
| `ACCETTATA` | Stessa targa semirimorchio E stesso autista |
| `SEMI_MODIFICATO` | Targa diversa, autista uguale |
| `AUTISTA_MODIFICATO` | Targa uguale, autista diverso |
| `COMPLETAMENTE_MODIFICATA` | Sia targa che autista diversi |
| `NON_ASSEGNATO_TIR` | BG proposto ma senza assegnazione finale in TIR |
| `AGGIUNTO_MANUALMENTE` | BG in TIR ma non nella proposta |

### Metriche

- **Acceptance rate**: % proposte accettate senza modifiche
- **Partial acceptance rate**: % proposte accettate o parzialmente modificate (semi o autista)

---

## 10. Esclusioni carrier/autisti

Meccanismo di **hard exclude** per vincoli non tecnici (tariffe, accordi commerciali): certi carrier/autisti non possono fare certe tratte anche se tecnicamente idonei.

### Configurazione

Sezione `driver_exclusions` in `config/optimization.yaml`:

```yaml
driver_exclusions:
  - carrier: "BONALDI"
    destinazioni: ["Piacenza"]
    clienti: ["BASELL"]
    destinatari: ["CDS"]
    motivo: "tariffe non competitive"
```

### Logica match

- **AND**: tutti i campi specificati nella regola devono matchare contemporaneamente
- Campi omessi non vengono controllati (una regola con solo `carrier` esclude quel carrier da tutti i viaggi)
- Match **contains case-insensitive**: `"BASELL"` matcha `"BASELL SALES & MARKETING CO BV It branch (C.4021)"`
- `carrier`: cercato nel `nome_completo` dell'autista (es. `"ROSSI MARIO (BONALDI)"`)
- `destinazioni`: matchate su `luogo_scarico` del viaggio
- `clienti`: matchati su campo `cliente` del viaggio
- `destinatari`: matchati su campo `destinatario` del viaggio

### Punto di applicazione

Il check avviene in `trova_migliore_assegnazione()` (optimizer.py), dentro il blocco `if autista.flag_esterno`, subito dopo `verifica_vincoli_carrier()`. Il candidato viene scartato dal pool (hard filter, non scoring).

### File coinvolti

| File | Ruolo |
|------|-------|
| `config/optimization.yaml` | Definizione regole `driver_exclusions` |
| `agent/planner/optimization_config.py` | Parsing YAML + metodo `check_driver_exclusion()` |
| `agent/planner/optimizer.py` | Applicazione filtro in `trova_migliore_assegnazione()` |

---

## 11. Tipi semirimorchio extra per genere (`genere_extra_tipi`)

Meccanismo per ammettere **tipi di semirimorchio aggiuntivi** rispetto a quelli normalmente previsti per un genere, quando condizioni specifiche del viaggio (cliente, località carico, genere) sono soddisfatte. L'override SILOS→container_stradale viene **inibito** quando una regola matcha.

### Configurazione

Sezione `genere_extra_tipi` in `config/optimization.yaml`:

```yaml
genere_extra_tipi:
  - clienti: ["INEOS"]
    localita_carico: ["ROSIGNANO"]
    generi: ["SILOS"]
    tipi_extra: ["ROTOCELLA"]
    motivo: "INEOS Rosignano: Silos con container ammette anche ROTOCELLA"
```

**Campi filtro** (tutti opzionali, AND tra loro, contains case-insensitive):
- `clienti`: lista stringhe da cercare nel campo cliente
- `localita_carico`: lista stringhe da cercare in luogo_carico
- `generi`: lista generi originali (pre-override) da matchare (exact, case-insensitive)
- `tipi_extra`: lista tipi semirimorchio da aggiungere ai tipi ammessi
- `motivo`: descrizione leggibile

### Logica

1. In `_arricchisci_silos_container()`, quando un viaggio SILOS ha Container valorizzato, **prima** di fare override a container_stradale si verifica `check_genere_extra_tipi()`
2. Se la regola matcha → il genere resta "silos", e `tipi_extra_ammessi` viene popolato sul viaggio
3. Poiché il genere resta "silos", `_arricchisci_vincolo_rotocella()` non si applica → `richiede_rotocella` resta False
4. In `_calcola_score_tipo_per_genere()`, dopo il check dei tipi normali, se il tipo del semi è in `tipi_extra_ammessi` → score 0.4 (ammesso ma con priorità bassa)

### Esempio: INEOS Rosignano (BG 26A02031)

Senza la regola: genere SILOS + container → override a container_stradale → vincolo ROTOCELLA → autista con semi SILOS escluso.

Con la regola: genere resta SILOS, ROTOCELLA ammessa come tipo extra → sia semi SILOS che ROTOCELLA sono candidati → vince il più vicino.

### File coinvolti

| File | Ruolo |
|------|-------|
| `config/optimization.yaml` | Definizione regole `genere_extra_tipi` |
| `agent/planner/optimization_config.py` | Parsing YAML + metodo `check_genere_extra_tipi()` |
| `agent/models/viaggio.py` | Campo `tipi_extra_ammessi` sul viaggio |
| `agent/planner/optimizer.py` | Applicazione in `_arricchisci_silos_container()` e `_calcola_score_tipo_per_genere()` |

---

### 5.10 Vincolo swap semirimorchio (depot-only)

Quando un autista è già stato assegnato a un viaggio con un semirimorchio (es. XA 822 LR), e una coppia successiva propone lo stesso autista con un **diverso** semirimorchio (es. XA 559 ER), si tratta di uno **swap semirimorchio**: l'autista deve fisicamente cambiare mezzo.

**Vincolo**: lo swap è consentito **solo se il nuovo semirimorchio si trova a un depot** (Fiorenzuola d'Arda o Terni). Altrimenti, lo swap viene bloccato.

#### Implementazione

Nel loop di assegnazione (`optimizer.py`), vengono tracciati due dict:
- `posizioni_aggiornate[id_trailer]` — posizione del semirimorchio dopo assegnazione (già esistente)
- `autisti_posizioni[id_employee]` — posizione dell'autista dopo assegnazione (nuovo)

Per ogni coppia candidata:

| Caso | Condizione | Azione |
|------|-----------|--------|
| Stesso semi già assegnato | `semi_id in posizioni_aggiornate` | Posizione aggiornata (luogo_scarico trip precedente) |
| Swap: semi diverso, al depot | `autista_id in autisti_posizioni` + `_is_depot_location(pos)` | Swap OK, km_vuoto dal depot |
| Swap: semi diverso, NON al depot | `autista_id in autisti_posizioni` + NOT depot | **Escluso** (`swap_bloccato_no_depot`) |
| Nessuna assegnazione precedente | else | Posizione originale |

La stessa logica si applica nel primo passaggio, nel depot-swap (tramite aggiornamento `autisti_posizioni` post-passaggio) e nel terzo passaggio (viaggi lunghi).

#### Log

- `swap_bloccato_no_depot | semi=... | autista=... | pos_semi=... (non è un depot)` — swap rifiutato
- `swap_depot_ok | semi=... | autista=... | depot=...` — swap accettato

---

---

## 10. Indice di Sostenibilità Economica

### 10.1 Principio

L'indice di sostenibilità misura se un viaggio assegnato consente all'autista/vettore di generare un margine adeguato e mantenere nel tempo la collaborazione con l'azienda. Un viaggio non sostenibile compromette qualità del servizio, affidabilità futura e stabilità del network.

### 10.2 Formula

```
Indice_sostenibilità = Somma_Tariffe / Costo_totale
```

- **Numeratore (Somma Tariffe)**: dalla tabella `drv_price_list`, filtrando per `codice_vettore` dell'autista e match fuzzy su carico/scarico del viaggio. Se più righe corrispondono, si usa la media aritmetica. Se più viaggi assegnati nella giornata allo stesso autista, le tariffe si sommano.
- **Denominatore (Costo totale)**: `(somma km_carico + somma km_vuoto) × euro_km_nominale` dalla tabella `drv_driver_companies`.

### 10.3 Trasformazione in Score (0-100)

| Rapporto | Score |
|----------|-------|
| < 0.95 | 0 (non sostenibile) |
| 0.95 – 1.10 | 50 (debole) |
| 1.10 – 1.15 | 75 (accettabile) |
| 1.15 – 1.22 | 90 (buono) |
| >= 1.22 | 100 (ottimo) |

### 10.4 Correzioni Operative

| Condizione | Effetto |
|-----------|---------|
| Km a vuoto > 350 km | Penalità -10 |
| Reload entro 150 km dall'ultimo scarico | Bonus +25 |

### 10.5 Classi di Risultato

| Range | Classe | Regola |
|-------|--------|--------|
| 90-100 | Molto sostenibile | Prioritario |
| 51-89 | Sostenibile | Assegnabile |
| 20-50 | Borderline | Valutare caso per caso |
| < 20 | Non sostenibile | Escluso (soft filter) |

### 10.6 Integrazione nei Pesi

L'indice viene normalizzato 0-1 e integrato nella somma pesata con peso `sustainability: 0.15`. Poiché già tiene conto dei km a vuoto, il peso `distance` è stato ridotto da 0.25 a 0.15 e `trailer_match` da 0.30 a 0.25.

| Componente | Peso | Note |
|-----------|------|------|
| distance | 0.10 | Ridotto: sostenibilità già penalizza km vuoto |
| trailer_match | 0.15 | Ridotto: hard filter già esclude incompatibili |
| time_feasibility | 0.15 | Ridotto: hard filter + penalty 0.3 già in atto |
| driver_experience | 0.10 | Fine-tuning |
| rag_suggestion | 0.10 | Invariato |
| **sustainability** | **0.40** | Criterio dominante |

### 10.7 Dati Mancanti

Quando un autista non ha `codice_vettore` (interni) o non esistono tariffe per la tratta, l'indice assume valore neutro (50) e la UI segnala "Tariffa non disponibile". L'esclusione per score < 20 si applica solo quando i dati sono effettivamente disponibili.

### 10.8 Output

Per ogni assegnazione viene mostrato:
- Indice di sostenibilità (0-100, con progress bar)
- Rapporto tariffa/costo
- Costo stimato autista e tariffa media
- Classe di sostenibilità
- Commento operativo

---

*Ultimo aggiornamento: 2026-03-30*
*Aggiunta: ordinamento scarsità risorse, EU 561, tie-breaking, score esponenziale, skill operativi, score tempo continuo, pesi aggiornati: 2026-03-13*
*Aggiunta sezione 5.8 (secondo passaggio depot trailer swap): 2026-03-11*
*Aggiunta sezione 6.1 (filtro data scarico TIR primario, text fallback): 2026-03-10*
*Aggiunta sezione 9 (cache geocoding): 2026-03-09*
