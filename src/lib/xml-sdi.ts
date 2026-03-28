import type { Fattura, FatturaRiga, Azienda, Cliente } from '../types'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDecimal(n: number, decimals = 2): string {
  return n.toFixed(decimals)
}

interface RiepilogoIVA {
  aliquota: number
  imponibile: number
  imposta: number
}

function calcolaRiepilogoIVA(righe: FatturaRiga[]): RiepilogoIVA[] {
  const map = new Map<number, { imponibile: number; imposta: number }>()
  for (const riga of righe) {
    const existing = map.get(riga.iva_percent) ?? { imponibile: 0, imposta: 0 }
    const imponibileRiga = riga.quantita * riga.prezzo_unitario
    existing.imponibile += imponibileRiga
    existing.imposta += imponibileRiga * (riga.iva_percent / 100)
    map.set(riga.iva_percent, existing)
  }
  return Array.from(map.entries()).map(([aliquota, vals]) => ({
    aliquota,
    imponibile: Math.round(vals.imponibile * 100) / 100,
    imposta: Math.round(vals.imposta * 100) / 100,
  }))
}

export function generateFatturaPA(
  fattura: Fattura,
  righe: FatturaRiga[],
  azienda: Azienda,
  cliente: Cliente
): string {
  const piva = azienda.piva.replace(/\s/g, '')
  const progressivo = fattura.numero.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
  const codiceDestinatario = cliente.codice_sdi ?? '0000000'
  const clientePiva = cliente.piva?.replace(/\s/g, '') ?? ''
  const clienteCF = cliente.codice_fiscale?.replace(/\s/g, '') ?? ''
  const riepilogo = calcolaRiepilogoIVA(righe)

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" versione="FPR12" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2.2/Schema_del_file_xml_FatturaPA_v1.2.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${escapeXml(piva)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${escapeXml(progressivo)}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${escapeXml(codiceDestinatario)}</CodiceDestinatario>${cliente.pec ? `
      <PECDestinatario>${escapeXml(cliente.pec)}</PECDestinatario>` : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${escapeXml(piva)}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>${escapeXml(azienda.nome)}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(azienda.indirizzo ?? 'N/D')}</Indirizzo>
        <CAP>${escapeXml(azienda.cap ?? '00000')}</CAP>
        <Comune>${escapeXml(azienda.citta ?? 'N/D')}</Comune>
        <Provincia>${escapeXml(azienda.provincia ?? 'RM')}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${clientePiva ? `
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${escapeXml(clientePiva)}</IdCodice>
        </IdFiscaleIVA>` : ''}${clienteCF ? `
        <CodiceFiscale>${escapeXml(clienteCF)}</CodiceFiscale>` : ''}
        <Anagrafica>${cliente.tipo === 'azienda' && cliente.ragione_sociale ? `
          <Denominazione>${escapeXml(cliente.ragione_sociale)}</Denominazione>` : `
          <Nome>${escapeXml(cliente.nome)}</Nome>
          <Cognome>${escapeXml(cliente.cognome ?? '')}</Cognome>`}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${escapeXml(cliente.indirizzo ?? 'N/D')}</Indirizzo>
        <CAP>${escapeXml(cliente.cap ?? '00000')}</CAP>
        <Comune>${escapeXml(cliente.citta ?? 'N/D')}</Comune>
        <Provincia>${escapeXml(cliente.provincia ?? 'RM')}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${formatDate(fattura.data)}</Data>
        <Numero>${escapeXml(fattura.numero)}</Numero>
        <ImportoTotaleDocumento>${formatDecimal(fattura.totale)}</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
${righe.map((riga, idx) => `      <DettaglioLinee>
        <NumeroLinea>${idx + 1}</NumeroLinea>
        <Descrizione>${escapeXml(riga.descrizione)}</Descrizione>
        <Quantita>${formatDecimal(riga.quantita)}</Quantita>
        <PrezzoUnitario>${formatDecimal(riga.prezzo_unitario)}</PrezzoUnitario>
        <PrezzoTotale>${formatDecimal(riga.quantita * riga.prezzo_unitario)}</PrezzoTotale>
        <AliquotaIVA>${formatDecimal(riga.iva_percent)}</AliquotaIVA>
      </DettaglioLinee>`).join('\n')}
${riepilogo.map((r) => `      <DatiRiepilogo>
        <AliquotaIVA>${formatDecimal(r.aliquota)}</AliquotaIVA>
        <ImponibileImporto>${formatDecimal(r.imponibile)}</ImponibileImporto>
        <Imposta>${formatDecimal(r.imposta)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>`).join('\n')}
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${fattura.metodo_pagamento === 'contanti' ? 'MP01' : 'MP05'}</ModalitaPagamento>
        <DataScadenzaPagamento>${formatDate(fattura.scadenza ?? fattura.data)}</DataScadenzaPagamento>
        <ImportoPagamento>${formatDecimal(fattura.totale)}</ImportoPagamento>${azienda.iban ? `
        <IBAN>${escapeXml(azienda.iban.replace(/\s/g, ''))}</IBAN>` : ''}
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`

  return xml
}

export function downloadXml(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xml') ? filename : `${filename}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
