# Gestione Cache - Geocoding

Il sistema di geocoding utilizza un'architettura a più livelli di cache per minimizzare le chiamate API e migliorare la precisione.

## Livelli di cache (ordine di priorità)

### 1. KNOWN_COORDINATES (hard-coded)

Coordinate fisse in memoria per località problematiche o ambigue (es. "Gron" in Italia vs Francia, "Lavezzola").

- Nessuna scadenza
- Definite nel codice sorgente (`geocoding.py`, dizionario `KNOWN_COORDINATES`)

### 2. Valkey (Redis)

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

### 3. File cache locale

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

### 4. TIR Location Cache

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

### 5. API di geocoding (nessuna cache, fonte dati)

Ultimo livello - chiamata effettiva ai provider:

| Provider | Ruolo | Note |
|----------|-------|------|
| Google Maps | Primario (se configurato) | |
| ORS (OpenRouteService) | Primario (default) | Cooldown 120s su HTTP 429 |
| Nominatim (OSM) | Fallback universale | Rate limit 1.1s tra richieste |

I risultati vengono salvati in Valkey + file cache.

## Flusso di lookup

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

## Normalizzazione chiavi

| Livello | Normalizzazione |
|---------|-----------------|
| Valkey | strip → lowercase → normalizza spazi → `geo:fwd:{loc}\|{paese}` |
| File | strip → lowercase → `{loc}\|{paese}` → MD5 (16 chars) |
| TIR | `localita.lower().strip()` |

## Cache distanze

Le distanze tra località sono cachate separatamente in Valkey:
- Chiave include il provider (`google`/`ors`) per evitare mix tra API diverse
- Fallback calcolo: ORS routing → Google Directions → Haversine (geodetica)

## Invalidazione

| Livello | Metodo |
|---------|--------|
| KNOWN_COORDINATES | Modifica codice |
| Valkey | Auto-expire (TTL 30 giorni) |
| File cache | Cancellare `data/geocoding_cache.json` |
| TIR Location | Cancellare `data/tir_location_cache.json` |
