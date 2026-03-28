import { pdf, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { Fattura, FatturaRiga, Azienda, Cliente } from '../types'

const colors = {
  dark: '#0D0D0F',
  darkBg: '#141418',
  gold: '#C9A84C',
  goldLight: '#D4B95E',
  text: '#F0EDE8',
  text2: '#A8A5A0',
  border: '#2A2A35',
  white: '#FFFFFF',
  black: '#000000',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: 40,
    backgroundColor: colors.white,
    color: colors.black,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: colors.gold,
  },
  logo: {
    width: 100,
    height: 50,
    objectFit: 'contain',
  },
  companyInfo: {
    alignItems: 'flex-end',
    maxWidth: 250,
  },
  companyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: colors.dark,
    marginBottom: 4,
  },
  companyDetail: {
    fontSize: 8,
    color: '#555555',
    marginBottom: 1,
  },
  invoiceTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: colors.gold,
    marginBottom: 20,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  metaBlock: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 10,
    color: colors.dark,
    marginBottom: 2,
  },
  clientBlock: {
    backgroundColor: '#F8F7F5',
    padding: 15,
    borderRadius: 4,
    marginBottom: 20,
  },
  clientLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  clientName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: colors.dark,
    marginBottom: 3,
  },
  clientDetail: {
    fontSize: 9,
    color: '#555555',
    marginBottom: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.dark,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 2,
    marginBottom: 1,
  },
  tableHeaderText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5E5',
  },
  tableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  tableCell: {
    fontSize: 9,
    color: colors.dark,
  },
  colNum: { width: '5%' },
  colDesc: { width: '40%' },
  colQty: { width: '10%', textAlign: 'center' },
  colPrice: { width: '15%', textAlign: 'right' },
  colIva: { width: '10%', textAlign: 'center' },
  colTotal: { width: '20%', textAlign: 'right' },
  totalsSection: {
    marginTop: 15,
    alignItems: 'flex-end',
  },
  totalsBox: {
    width: 250,
    padding: 15,
    backgroundColor: '#F8F7F5',
    borderRadius: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 9,
    color: '#555555',
  },
  totalValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: colors.dark,
  },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: colors.gold,
  },
  totalFinalLabel: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: colors.dark,
  },
  totalFinalValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: colors.gold,
  },
  notes: {
    marginTop: 25,
    padding: 12,
    backgroundColor: '#FFFEF5',
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderRadius: 2,
  },
  notesLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    color: '#555555',
  },
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: '#AAAAAA',
  },
  oggetto: {
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#E5E5E5',
  },
  oggettoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 3,
  },
  oggettoText: {
    fontSize: 10,
    color: colors.dark,
  },
  paymentSection: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#F2F2F2',
    borderRadius: 3,
  },
  paymentLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  paymentText: {
    fontSize: 8,
    color: '#555555',
    marginBottom: 1,
  },
})

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT')
}

interface InvoiceDocProps {
  fattura: Fattura
  righe: FatturaRiga[]
  azienda: Azienda
  cliente: Cliente
}

function calcolaRiepilogoIVA(righe: FatturaRiga[]): Array<{ aliquota: number; imponibile: number; imposta: number }> {
  const map = new Map<number, { imponibile: number; imposta: number }>()
  for (const riga of righe) {
    const existing = map.get(riga.iva_percent) ?? { imponibile: 0, imposta: 0 }
    const imp = riga.quantita * riga.prezzo_unitario
    existing.imponibile += imp
    existing.imposta += imp * (riga.iva_percent / 100)
    map.set(riga.iva_percent, existing)
  }
  return Array.from(map.entries()).map(([aliquota, vals]) => ({
    aliquota,
    imponibile: Math.round(vals.imponibile * 100) / 100,
    imposta: Math.round(vals.imposta * 100) / 100,
  }))
}

function InvoiceDocument({ fattura, righe, azienda, cliente }: InvoiceDocProps) {
  const clienteNome = cliente.tipo === 'azienda' && cliente.ragione_sociale
    ? cliente.ragione_sociale
    : `${cliente.nome}${cliente.cognome ? ` ${cliente.cognome}` : ''}`

  const riepilogo = calcolaRiepilogoIVA(righe)
  const totaleIVA = riepilogo.reduce((acc, r) => acc + r.imposta, 0)
  const totaleImponibile = riepilogo.reduce((acc, r) => acc + r.imponibile, 0)

  return createElement(
    Document,
    null,
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      // Header
      createElement(
        View,
        { style: styles.header },
        createElement(
          View,
          null,
          azienda.logo_url
            ? createElement(Image, { src: azienda.logo_url, style: styles.logo })
            : createElement(Text, { style: styles.companyName }, azienda.nome),
        ),
        createElement(
          View,
          { style: styles.companyInfo },
          azienda.logo_url
            ? createElement(Text, { style: styles.companyName }, azienda.nome)
            : null,
          createElement(Text, { style: styles.companyDetail }, `P.IVA: ${azienda.piva}`),
          azienda.indirizzo ? createElement(Text, { style: styles.companyDetail }, azienda.indirizzo) : null,
          azienda.cap || azienda.citta
            ? createElement(Text, { style: styles.companyDetail }, `${azienda.cap ?? ''} ${azienda.citta ?? ''} ${azienda.provincia ? `(${azienda.provincia})` : ''}`)
            : null,
          azienda.pec ? createElement(Text, { style: styles.companyDetail }, `PEC: ${azienda.pec}`) : null,
          azienda.codice_sdi ? createElement(Text, { style: styles.companyDetail }, `SDI: ${azienda.codice_sdi}`) : null,
        ),
      ),
      // Invoice title
      createElement(Text, { style: styles.invoiceTitle }, `FATTURA N. ${fattura.numero}`),
      // Meta row
      createElement(
        View,
        { style: styles.metaRow },
        createElement(
          View,
          { style: styles.metaBlock },
          createElement(Text, { style: styles.metaLabel }, 'Data Emissione'),
          createElement(Text, { style: styles.metaValue }, formatDate(fattura.data)),
        ),
        createElement(
          View,
          { style: styles.metaBlock },
          createElement(Text, { style: styles.metaLabel }, 'Data Scadenza'),
          createElement(Text, { style: styles.metaValue }, fattura.scadenza ? formatDate(fattura.scadenza) : '-'),
        ),
        createElement(
          View,
          { style: styles.metaBlock },
          createElement(Text, { style: styles.metaLabel }, 'Stato'),
          createElement(Text, { style: styles.metaValue }, fattura.stato.toUpperCase()),
        ),
      ),
      // Client block
      createElement(
        View,
        { style: styles.clientBlock },
        createElement(Text, { style: styles.clientLabel }, 'Destinatario'),
        createElement(Text, { style: styles.clientName }, clienteNome),
        cliente.piva ? createElement(Text, { style: styles.clientDetail }, `P.IVA: ${cliente.piva}`) : null,
        cliente.codice_fiscale ? createElement(Text, { style: styles.clientDetail }, `C.F.: ${cliente.codice_fiscale}`) : null,
        cliente.indirizzo ? createElement(Text, { style: styles.clientDetail }, cliente.indirizzo) : null,
        cliente.cap || cliente.citta
          ? createElement(Text, { style: styles.clientDetail }, `${cliente.cap ?? ''} ${cliente.citta ?? ''} ${cliente.provincia ? `(${cliente.provincia})` : ''}`)
          : null,
        cliente.pec ? createElement(Text, { style: styles.clientDetail }, `PEC: ${cliente.pec}`) : null,
        cliente.codice_sdi ? createElement(Text, { style: styles.clientDetail }, `SDI: ${cliente.codice_sdi}`) : null,
      ),
      // Oggetto
      fattura.oggetto
        ? createElement(
            View,
            { style: styles.oggetto },
            createElement(Text, { style: styles.oggettoLabel }, 'Oggetto'),
            createElement(Text, { style: styles.oggettoText }, fattura.oggetto),
          )
        : null,
      // Table header
      createElement(
        View,
        { style: styles.tableHeader },
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colNum } }, '#'),
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colDesc } }, 'Descrizione'),
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colQty } }, 'Qty'),
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colPrice } }, 'Prezzo'),
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colIva } }, 'IVA'),
        createElement(Text, { style: { ...styles.tableHeaderText, ...styles.colTotal } }, 'Totale'),
      ),
      // Table rows
      ...righe.map((riga, idx) =>
        createElement(
          View,
          { key: riga.id, style: { ...styles.tableRow, ...(idx % 2 === 1 ? styles.tableRowAlt : {}) } },
          createElement(Text, { style: { ...styles.tableCell, ...styles.colNum } }, String(idx + 1)),
          createElement(Text, { style: { ...styles.tableCell, ...styles.colDesc } }, riga.descrizione),
          createElement(Text, { style: { ...styles.tableCell, ...styles.colQty } }, String(riga.quantita)),
          createElement(Text, { style: { ...styles.tableCell, ...styles.colPrice } }, formatCurrency(riga.prezzo_unitario)),
          createElement(Text, { style: { ...styles.tableCell, ...styles.colIva } }, `${riga.iva_percent}%`),
          createElement(Text, { style: { ...styles.tableCell, ...styles.colTotal } }, formatCurrency(riga.quantita * riga.prezzo_unitario * (1 + riga.iva_percent / 100))),
        ),
      ),
      // Totals
      createElement(
        View,
        { style: styles.totalsSection },
        createElement(
          View,
          { style: styles.totalsBox },
          createElement(
            View,
            { style: styles.totalRow },
            createElement(Text, { style: styles.totalLabel }, 'Imponibile'),
            createElement(Text, { style: styles.totalValue }, formatCurrency(totaleImponibile)),
          ),
          ...riepilogo.map((r) =>
            createElement(
              View,
              { key: `iva-${r.aliquota}`, style: styles.totalRow },
              createElement(Text, { style: styles.totalLabel }, `IVA ${r.aliquota}%`),
              createElement(Text, { style: styles.totalValue }, formatCurrency(r.imposta)),
            ),
          ),
          riepilogo.length > 1
            ? createElement(
                View,
                { style: styles.totalRow },
                createElement(Text, { style: styles.totalLabel }, 'Totale IVA'),
                createElement(Text, { style: styles.totalValue }, formatCurrency(totaleIVA)),
              )
            : null,
          createElement(
            View,
            { style: styles.totalFinalRow },
            createElement(Text, { style: styles.totalFinalLabel }, 'TOTALE FATTURA'),
            createElement(Text, { style: styles.totalFinalValue }, formatCurrency(fattura.totale)),
          ),
        ),
      ),
      // Payment info
      azienda.iban
        ? createElement(
            View,
            { style: styles.paymentSection },
            createElement(Text, { style: styles.paymentLabel }, 'Dati Pagamento'),
            createElement(Text, { style: styles.paymentText }, `IBAN: ${azienda.iban}`),
            azienda.banca ? createElement(Text, { style: styles.paymentText }, `Banca: ${azienda.banca}`) : null,
            createElement(Text, { style: styles.paymentText }, `Intestato a: ${azienda.nome}`),
          )
        : null,
      // Notes
      fattura.note
        ? createElement(
            View,
            { style: styles.notes },
            createElement(Text, { style: styles.notesLabel }, 'Note'),
            createElement(Text, { style: styles.notesText }, fattura.note),
          )
        : null,
      // Footer
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(Text, { style: styles.footerText }, `${azienda.nome} | P.IVA ${azienda.piva}`),
        createElement(Text, { style: styles.footerText }, `Fattura N. ${fattura.numero} del ${formatDate(fattura.data)}`),
      ),
    ),
  )
}

export async function generateInvoicePdfBlob(
  fattura: Fattura,
  righe: FatturaRiga[],
  azienda: Azienda,
  cliente: Cliente
): Promise<Blob> {
  const doc = createElement(InvoiceDocument, { fattura, righe, azienda, cliente })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob()
  return blob
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
