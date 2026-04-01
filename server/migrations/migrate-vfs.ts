/**
 * FIAI OS v5 — Migrate legacy tables → names + entity + relations
 * Idempotent: checks if migration already ran via marker.
 * Called from server/index.ts on startup.
 */
import crypto from 'crypto'
import db from '../db.js'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80) || 'unnamed'
}

function jobj(...pairs: [string, unknown][]): string {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of pairs) {
    if (v !== null && v !== undefined && v !== '') obj[k] = v
  }
  return JSON.stringify(obj)
}

export function migrateToVFS() {
  // Check if already migrated
  const count = (db.prepare("SELECT COUNT(*) as c FROM names").get() as any)?.c ?? 0
  if (count > 0) return false

  console.log('[VFS] Starting migration to virtual filesystem...')

  const tx = db.transaction(() => {
    // ── 1. Migrate aziende → names (tag: organizzazione) ──
    const aziende = db.prepare("SELECT * FROM aziende").all() as any[]
    for (const a of aziende) {
      const slug = slugify(a.nome)
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(
        a.id, a.nome, slug, a.email, a.telefono, a.piva,
        '["organizzazione"]',
        jobj(['codice_sdi', a.codice_sdi], ['pec', a.pec], ['indirizzo', a.indirizzo],
             ['cap', a.cap], ['citta', a.citta], ['provincia', a.provincia],
             ['iban', a.iban], ['banca', a.banca], ['logo_url', a.logo_url]),
        `/names/${slug}`, a.created_at, a.updated_at
      )
    }
    console.log(`[VFS] Migrated ${aziende.length} aziende → names`)

    // ── 2. Migrate users + user_profiles → names (tag: utente) ──
    const users = db.prepare(`
      SELECT u.id, u.email, u.password_hash, u.created_at,
             p.azienda_id, p.nome, p.cognome, p.ruolo, p.avatar_url,
             p.whatsapp_phone, p.whatsapp_active, p.tts_voice
      FROM users u LEFT JOIN user_profiles p ON u.id = p.id
    `).all() as any[]
    for (const u of users) {
      const displayName = u.nome ? `${u.nome} ${u.cognome || ''}`.trim() : u.email
      const slug = slugify(displayName)
      const tags = ['utente']
      if (u.ruolo === 'admin') tags.push('admin')
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`).run(
        u.id, u.azienda_id, displayName, slug, u.email, u.whatsapp_phone,
        JSON.stringify(tags),
        jobj(['password_hash', u.password_hash], ['cognome', u.cognome], ['ruolo', u.ruolo],
             ['avatar_url', u.avatar_url], ['whatsapp_phone', u.whatsapp_phone],
             ['whatsapp_active', u.whatsapp_active], ['tts_voice', u.tts_voice || 'Vivian']),
        `/names/${slug}`, u.created_at, u.created_at
      )
      // Relation: utente membro_di organizzazione
      if (u.azienda_id) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
          VALUES (?, ?, 'name', ?, 'name', ?, 'membro_di')`).run(
          crypto.randomUUID(), u.azienda_id, u.id, u.azienda_id
        )
      }
    }
    console.log(`[VFS] Migrated ${users.length} users → names`)

    // ── 3. Migrate clienti → names (tag: cliente) ──
    const clienti = db.prepare("SELECT * FROM clienti").all() as any[]
    for (const c of clienti) {
      const displayName = c.ragione_sociale || `${c.nome} ${c.cognome || ''}`.trim()
      const slug = slugify(displayName)
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(
        c.id, c.azienda_id, displayName, slug, c.email, c.telefono, c.piva,
        '["cliente"]',
        jobj(['tipo', c.tipo], ['cognome', c.cognome], ['ragione_sociale', c.ragione_sociale],
             ['codice_fiscale', c.codice_fiscale], ['indirizzo', c.indirizzo], ['cap', c.cap],
             ['citta', c.citta], ['provincia', c.provincia], ['codice_sdi', c.codice_sdi],
             ['pec', c.pec], ['note', c.note]),
        `/names/${slug}`, c.created_at, c.updated_at
      )
    }
    console.log(`[VFS] Migrated ${clienti.length} clienti → names`)

    // ── 4. Migrate leads → names (tag: lead) ──
    const leads = db.prepare("SELECT * FROM leads").all() as any[]
    for (const l of leads) {
      const displayName = `${l.nome} ${l.cognome}`.trim()
      const slug = slugify(displayName)
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
        l.id, l.azienda_id, displayName, slug, l.email, l.telefono,
        '["lead"]', l.stato,
        jobj(['cognome', l.cognome], ['azienda_lead', l.azienda_lead], ['fonte', l.fonte],
             ['valore_stimato', l.valore_stimato], ['note', l.note], ['assegnato_a', l.assegnato_a]),
        `/names/${slug}`, l.created_at, l.updated_at
      )
    }
    console.log(`[VFS] Migrated ${leads.length} leads → names`)

    // ── 5. Migrate fornitori → names (tag: fornitore) ──
    const fornitori = db.prepare("SELECT * FROM fornitori").all() as any[]
    for (const f of fornitori) {
      const slug = slugify(f.ragione_sociale)
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(
        f.id, f.azienda_id, f.ragione_sociale, slug, f.email, f.telefono, f.piva,
        '["fornitore"]',
        jobj(['ragione_sociale', f.ragione_sociale], ['indirizzo', f.indirizzo], ['cap', f.cap],
             ['citta', f.citta], ['provincia', f.provincia], ['iban', f.iban], ['note', f.note]),
        `/names/${slug}`, f.created_at, f.updated_at
      )
    }
    console.log(`[VFS] Migrated ${fornitori.length} fornitori → names`)

    // ── 6. Migrate candidati → names (tag: candidato) ──
    const candidati = db.prepare("SELECT * FROM candidati").all() as any[]
    for (const c of candidati) {
      const displayName = `${c.nome} ${c.cognome}`.trim()
      const slug = slugify(displayName)
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
        c.id, c.azienda_id, displayName, slug, c.email, c.telefono,
        '["candidato"]', c.stato,
        jobj(['cognome', c.cognome], ['ruolo_candidato', c.ruolo_candidato], ['cv_url', c.cv_url],
             ['valutazione', c.valutazione], ['fonte', c.fonte], ['data_candidatura', c.data_candidatura],
             ['note', c.note]),
        `/names/${slug}`, c.created_at, c.updated_at
      )
    }
    console.log(`[VFS] Migrated ${candidati.length} candidati → names`)

    // ── 7. Migrate fatture → entity ──
    const fatture = db.prepare("SELECT * FROM fatture").all() as any[]
    for (const f of fatture) {
      const slug = slugify(f.numero)
      // Get name slug for path
      const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(f.cliente_id) as any)?.slug || '_'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'fattura', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
        f.id, f.azienda_id, `Fattura ${f.numero}`, slug, f.stato, f.cliente_id,
        f.numero, f.data, f.totale,
        jobj(['scadenza', f.scadenza], ['oggetto', f.oggetto], ['imponibile', f.imponibile],
             ['iva', f.iva], ['pagata_il', f.pagata_il], ['metodo_pagamento', f.metodo_pagamento],
             ['note', f.note], ['ordine_id', f.ordine_id]),
        `/names/${nameSlug}/fatture/${slug}`, f.created_at, f.updated_at
      )
    }
    // Fattura righe
    const fRighe = db.prepare("SELECT * FROM fattura_righe").all() as any[]
    for (const r of fRighe) {
      const parentPath = (db.prepare("SELECT path FROM entity WHERE id = ?").get(r.fattura_id) as any)?.path || ''
      const parentAz = (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(r.fattura_id) as any)?.azienda_id || ''
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, ordine, created_at, updated_at)
        VALUES (?, ?, 'fattura_riga', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(
        r.id, parentAz, r.descrizione, r.id, r.fattura_id, r.totale,
        jobj(['descrizione', r.descrizione], ['quantita', r.quantita], ['prezzo_unitario', r.prezzo_unitario], ['iva_percent', r.iva_percent]),
        `${parentPath}/righe/${r.id}`, r.ordine
      )
    }
    console.log(`[VFS] Migrated ${fatture.length} fatture + ${fRighe.length} righe → entity`)

    // ── 8. Migrate preventivi → entity ──
    const preventivi = db.prepare("SELECT * FROM preventivi").all() as any[]
    for (const p of preventivi) {
      const slug = slugify(p.numero)
      const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(p.cliente_id) as any)?.slug || '_'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'preventivo', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
        p.id, p.azienda_id, `Preventivo ${p.numero}`, slug, p.stato, p.cliente_id,
        p.numero, p.data, p.totale,
        jobj(['scadenza', p.scadenza], ['oggetto', p.oggetto], ['imponibile', p.imponibile], ['iva', p.iva], ['note', p.note]),
        `/names/${nameSlug}/preventivi/${slug}`, p.created_at, p.updated_at
      )
    }
    const pRighe = db.prepare("SELECT * FROM preventivo_righe").all() as any[]
    for (const r of pRighe) {
      const parentPath = (db.prepare("SELECT path FROM entity WHERE id = ?").get(r.preventivo_id) as any)?.path || ''
      const parentAz = (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(r.preventivo_id) as any)?.azienda_id || ''
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, ordine, created_at, updated_at)
        VALUES (?, ?, 'preventivo_riga', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(
        r.id, parentAz, r.descrizione, r.id, r.preventivo_id, r.totale,
        jobj(['descrizione', r.descrizione], ['quantita', r.quantita], ['prezzo_unitario', r.prezzo_unitario], ['iva_percent', r.iva_percent]),
        `${parentPath}/righe/${r.id}`, r.ordine
      )
    }
    console.log(`[VFS] Migrated ${preventivi.length} preventivi + ${pRighe.length} righe → entity`)

    // ── 9. Migrate ordini → entity ──
    const ordini = db.prepare("SELECT * FROM ordini").all() as any[]
    for (const o of ordini) {
      const slug = slugify(o.numero)
      const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(o.cliente_id) as any)?.slug || '_'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'ordine', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`).run(
        o.id, o.azienda_id, `Ordine ${o.numero}`, slug, o.stato, o.cliente_id,
        o.numero, o.data, o.totale,
        jobj(['imponibile', o.imponibile], ['iva', o.iva], ['note', o.note]),
        `/names/${nameSlug}/ordini/${slug}`, o.created_at, o.updated_at
      )
      if (o.preventivo_id) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
          VALUES (?, ?, 'entity', ?, 'entity', ?, 'ordine_da_preventivo')`).run(
          crypto.randomUUID(), o.azienda_id, o.id, o.preventivo_id
        )
      }
    }
    console.log(`[VFS] Migrated ${ordini.length} ordini → entity`)

    // ── 10. Migrate progetti → entity ──
    const progetti = db.prepare("SELECT * FROM progetti").all() as any[]
    for (const p of progetti) {
      const slug = slugify(p.nome)
      const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(p.cliente_id) as any)?.slug || '_'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'progetto', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`).run(
        p.id, p.azienda_id, p.nome, slug, p.stato, p.cliente_id,
        p.data_inizio, p.budget,
        jobj(['descrizione', p.descrizione], ['data_fine_prevista', p.data_fine_prevista],
             ['data_fine_effettiva', p.data_fine_effettiva], ['note', p.note]),
        `/names/${nameSlug}/progetti/${slug}`, p.created_at, p.updated_at
      )
      if (p.ordine_id) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
          VALUES (?, ?, 'entity', ?, 'entity', ?, 'progetto_da_ordine')`).run(
          crypto.randomUUID(), p.azienda_id, p.id, p.ordine_id
        )
      }
    }
    console.log(`[VFS] Migrated ${progetti.length} progetti → entity`)

    // ── 11. Migrate ricorrenti → entity ──
    const ricorrenti = db.prepare("SELECT * FROM ricorrenti").all() as any[]
    for (const r of ricorrenti) {
      const slug = slugify(r.descrizione)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'ricorrente', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`).run(
        r.id, r.azienda_id, r.descrizione, slug, r.attivo ? 'attivo' : 'disattivo', r.cliente_id,
        r.prossima_emissione, r.importo,
        jobj(['iva_percent', r.iva_percent], ['frequenza', r.frequenza]),
        `/entity/ricorrenti/${slug}`, r.created_at, r.updated_at
      )
    }
    console.log(`[VFS] Migrated ${ricorrenti.length} ricorrenti → entity`)

    // ── 12. Migrate fatture_passive → entity ──
    const fp = db.prepare("SELECT * FROM fatture_passive").all() as any[]
    for (const f of fp) {
      const slug = slugify(f.numero)
      const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(f.fornitore_id) as any)?.slug || '_'
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'fattura_passiva', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        f.id, f.azienda_id, `Fattura Passiva ${f.numero}`, slug, f.stato, f.fornitore_id,
        f.file_url, f.numero, f.data, f.totale,
        jobj(['scadenza', f.scadenza], ['imponibile', f.imponibile], ['iva', f.iva],
             ['pagata_il', f.pagata_il], ['note', f.note]),
        `/names/${nameSlug}/fatture-passive/${slug}`, f.created_at, f.updated_at
      )
    }
    console.log(`[VFS] Migrated ${fp.length} fatture_passive → entity`)

    // ── 13. Migrate conti → entity ──
    const conti = db.prepare("SELECT * FROM conti").all() as any[]
    for (const c of conti) {
      const slug = slugify(c.nome)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'conto', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`).run(
        c.id, c.azienda_id, c.nome, slug, c.saldo,
        jobj(['tipo', c.tipo], ['iban', c.iban], ['banca', c.banca], ['colore', c.colore]),
        `/entity/conti/${slug}`, c.created_at, c.updated_at
      )
    }
    console.log(`[VFS] Migrated ${conti.length} conti → entity`)

    // ── 14. Migrate movimenti → entity ──
    const movimenti = db.prepare("SELECT * FROM movimenti").all() as any[]
    for (const m of movimenti) {
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'movimento', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(
        m.id, m.azienda_id, m.descrizione || `Movimento ${m.tipo}`, m.id,
        m.conto_id, m.data, m.importo,
        jobj(['tipo', m.tipo], ['categoria', m.categoria], ['descrizione', m.descrizione]),
        `/entity/conti/_/movimenti/${m.id}`, m.created_at
      )
      if (m.fattura_id) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
          VALUES (?, ?, 'entity', ?, 'entity', ?, 'movimento_da_fattura')`).run(
          crypto.randomUUID(), m.azienda_id, m.id, m.fattura_id
        )
      }
    }
    console.log(`[VFS] Migrated ${movimenti.length} movimenti → entity`)

    // ── 15. Migrate rimborsi → entity ──
    const rimborsi = db.prepare("SELECT * FROM rimborsi").all() as any[]
    for (const r of rimborsi) {
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'rimborso', ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`).run(
        r.id, r.azienda_id, r.descrizione, r.id, r.stato, r.richiedente_id,
        r.allegato_url, r.data_spesa, r.importo,
        jobj(['categoria', r.categoria], ['approvato_da', r.approvato_da], ['approvato_il', r.approvato_il], ['note', r.note]),
        `/entity/rimborsi/${r.id}`, r.created_at, r.updated_at
      )
    }
    console.log(`[VFS] Migrated ${rimborsi.length} rimborsi → entity`)

    // ── 16. Migrate documenti → entity ──
    const documenti = db.prepare("SELECT * FROM documenti").all() as any[]
    for (const d of documenti) {
      const slug = slugify(d.nome)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'documento', ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`).run(
        d.id, d.azienda_id, d.nome, slug, d.uploaded_by, d.file_url,
        jobj(['tipo_file', d.tipo_file], ['categoria', d.categoria], ['descrizione', d.descrizione],
             ['file_size', d.file_size], ['tags', d.tags], ['contenuto_testo', d.contenuto_testo]),
        `/entity/documenti/${slug}`, d.created_at, d.updated_at
      )
    }
    console.log(`[VFS] Migrated ${documenti.length} documenti → entity`)

    // ── 17. Migrate annunci_lavoro → entity ──
    const annunci = db.prepare("SELECT * FROM annunci_lavoro").all() as any[]
    for (const a of annunci) {
      const slug = slugify(a.ruolo)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'annuncio', ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`).run(
        a.id, a.azienda_id, a.ruolo, slug, a.stato,
        jobj(['competenze', a.competenze], ['tipo_contratto', a.tipo_contratto], ['sede', a.sede],
             ['ral_min', a.ral_min], ['ral_max', a.ral_max], ['contenuto', a.contenuto]),
        `/entity/annunci/${slug}`, a.created_at, a.updated_at
      )
    }
    console.log(`[VFS] Migrated ${annunci.length} annunci → entity`)

    // ── 18. Migrate note_boards + columns + cards → entity ──
    const boards = db.prepare("SELECT * FROM note_boards").all() as any[]
    for (const b of boards) {
      const slug = slugify(b.nome)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, (SELECT azienda_id FROM names WHERE id = ?), 'board', ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, '{}', ?, ?, ?)`).run(
        b.id, b.user_id, b.nome, slug, b.user_id,
        `/entity/boards/${slug}`, b.created_at, b.updated_at
      )
    }
    const columns = db.prepare("SELECT * FROM note_columns").all() as any[]
    for (const c of columns) {
      const parentAz = (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(c.board_id) as any)?.azienda_id || ''
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, ordine, created_at, updated_at)
        VALUES (?, ?, 'board_column', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'))`).run(
        c.id, parentAz, c.nome, c.id, c.board_id,
        jobj(['colore', c.colore]),
        `/entity/boards/_/columns/${c.id}`, c.ordine, c.created_at
      )
    }
    const cards = db.prepare("SELECT * FROM note_cards").all() as any[]
    for (const c of cards) {
      const parentAz = (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(c.column_id) as any)?.azienda_id || ''
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, ordine, created_at, updated_at)
        VALUES (?, ?, 'card', ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`).run(
        c.id, parentAz, c.titolo, c.id, c.completata ? 'completata' : null, c.column_id,
        jobj(['contenuto', c.contenuto], ['colore', c.colore], ['priorita', c.priorita], ['scadenza', c.scadenza]),
        `/entity/boards/_/columns/_/cards/${c.id}`, c.ordine, c.created_at, c.updated_at
      )
    }
    console.log(`[VFS] Migrated ${boards.length} boards + ${columns.length} columns + ${cards.length} cards → entity`)

    // ── 19. Migrate eventi → entity ──
    const eventi = db.prepare("SELECT * FROM eventi").all() as any[]
    for (const e of eventi) {
      const slug = slugify(e.titolo)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, (SELECT azienda_id FROM names WHERE id = ?), 'evento', ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?)`).run(
        e.id, e.user_id, e.titolo, slug, e.user_id, e.data_inizio,
        jobj(['descrizione', e.descrizione], ['data_fine', e.data_fine], ['tutto_il_giorno', e.tutto_il_giorno],
             ['colore', e.colore], ['tipo', e.tipo]),
        `/entity/eventi/${slug}`, e.created_at, e.updated_at
      )
    }
    console.log(`[VFS] Migrated ${eventi.length} eventi → entity`)

    // ── 20. Migrate chat_sessions + messages → entity ──
    const sessions = db.prepare("SELECT * FROM chat_sessions").all() as any[]
    for (const s of sessions) {
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'chat_session', ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`).run(
        s.id, s.azienda_id, s.titolo, s.id, s.user_id,
        jobj(['titolo', s.titolo]),
        `/entity/chat/${s.id}`, s.created_at, s.updated_at
      )
    }
    const messages = db.prepare("SELECT * FROM chat_messages").all() as any[]
    for (const m of messages) {
      const parentAz = (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(m.session_id) as any)?.azienda_id || ''
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
        VALUES (?, ?, 'chat_message', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, datetime('now'))`).run(
        m.id, parentAz, m.ruolo === 'user' ? 'Utente' : 'Assistente', m.id, m.session_id,
        jobj(['ruolo', m.ruolo], ['contenuto', m.contenuto], ['tool_calls', m.tool_calls]),
        `/entity/chat/_/messages/${m.id}`, m.created_at
      )
    }
    console.log(`[VFS] Migrated ${sessions.length} chat sessions + ${messages.length} messages → entity`)

    // ── 21. Migrate fatture.ordine_id → relations ──
    const fattureOrdini = db.prepare("SELECT id, azienda_id, ordine_id FROM fatture WHERE ordine_id IS NOT NULL").all() as any[]
    for (const f of fattureOrdini) {
      db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
        VALUES (?, ?, 'entity', ?, 'entity', ?, 'fattura_da_ordine')`).run(
        crypto.randomUUID(), f.azienda_id, f.id, f.ordine_id
      )
    }
    console.log(`[VFS] Created ${fattureOrdini.length} fattura→ordine relations`)

    // ── 22. Build FTS indexes ──
    try {
      db.exec("INSERT INTO names_fts(names_fts) VALUES('rebuild')")
      db.exec("INSERT INTO entity_fts(entity_fts) VALUES('rebuild')")
    } catch (e) {
      console.warn('[VFS] FTS rebuild warning:', (e as Error).message)
    }

    console.log('[VFS] Migration complete!')
  })

  tx()
  return true
}
