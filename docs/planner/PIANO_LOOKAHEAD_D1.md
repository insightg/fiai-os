# Piano: Lookahead Bonus D+1 per ottimizzazione km vuoti

## Contesto

La pianificazione è giornaliera (giorno D), ma dal TIR si possono conoscere i viaggi dei giorni successivi. Attualmente, quando un autista finisce un viaggio in posizione X, non si considera se il giorno dopo ci sono viaggi con carico vicino a X. Questo causa km vuoti evitabili il giorno D+1.

L'idea: aggiungere un **bonus additivo** allo score quando la posizione finale dell'autista nel giorno D è vicina al carico di un viaggio D+1. Il bonus è supplementare — non penalizza mai, solo premia quando i dati sono disponibili.

## Approccio: Bonus additivo (non nuovo peso)

Il bonus è **additivo** sopra lo score totale pesato esistente (che somma a 1.0). NON è un 7° componente pesato — evita di ribilanciare i 6 pesi attuali.

- Max bonus: +0.05 (configurable) → ~5% dello score
- Se D+1 non ha viaggi o il fetch fallisce: bonus = 0 per tutti, nessun effetto

## File da modificare

### 1. `config/optimization.yaml` — nuova sezione lookahead
```yaml
lookahead:
  enabled: true
  weight: 0.05              # Bonus additivo max
  max_distance_km: 300      # Oltre → bonus = 0
  decay_factor: 200         # Decadimento esponenziale (come score_distanza)
  check_trailer_compat: false
  trailer_compat_factor: 0.5
  days_ahead: 1
```

### 2. `agent/planner/optimization_config.py` — nuovi campi config
Aggiungere campi lookahead a `OptimizationConfig` + parsing YAML nella `load()`.

### 3. `agent/planner/optimizer.py` — 3 modifiche

**a) Fetch D+1 in `ottimizza_da_database()`** (dopo riga ~3538)
- Una sola chiamata `tir.get_viaggi_da_pianificare(D+1)` in try/except
- Salvata in `self._lookahead_trips`
- Skip se storico (`is_storico=True`)

**b) Nuovo metodo `_calcola_lookahead_bonus(posizione_finale, tipo_semi)`**
- Per ogni viaggio D+1: calcola distanza da posizione_finale a luogo_carico
- Prende il minimo
- Applica decay esponenziale: `exp(-min_dist / decay_factor)`
- Se min_dist > max_distance_km → 0.0
- Opzionale: ridurre 50% se tipo semi incompatibile
- Return: 0.0–1.0

**c) Integrazione in `valuta_assegnazione_coppia()`** (dopo riga ~1375)
- Calcola `score_lookahead` usando `viaggio.luogo_scarico` come posizione finale
- `score_totale += lookahead_weight * score_lookahead`
- Aggiungere `score_lookahead` a `ScoreAssegnazione` e `CandidatoValutato`
- Aggiungere a dettagli log: `" | LA: 0.35"`

## Gestione edge cases

| Caso | Comportamento |
|------|--------------|
| D+1 ha 0 viaggi | bonus = 0 per tutti, nessun effetto |
| Fetch D+1 fallisce | warning log, `_lookahead_trips = []`, planning procede |
| D = venerdì, D+1 = sabato senza viaggi | bonus = 0 (neutro, non penalizza) |
| Dati D+1 parziali | bonus premia vicinanza ai viaggi noti, assenza non penalizza |
| luogo_scarico vuoto | skip bonus (= 0) |
| Geocoding fallisce | distanza default > max_distance_km → bonus = 0 |
| Modo storico | skip fetch D+1 (dati storici sono statici) |

## Performance

- 1 chiamata API extra a TIR (D+1, ~20 viaggi)
- ~20 calcoli distanza per candidato, tutti cachati dal geocoding
- Impatto trascurabile

## Verifica

1. Lanciare `python run.py ottimizza 2026-04-01` e verificare nel log le righe `Lookahead D+1:` e `| LA:` nei dettagli
2. Confrontare proposta con/senza lookahead (enabled: true/false) per verificare che il bonus sposti correttamente le preferenze verso posizioni finali vicine a carichi D+1
3. Verificare che con 0 viaggi D+1 i risultati siano identici a prima
