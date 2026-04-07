import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'scadenze',
    label: 'Scadenze',
    icon: 'alert-triangle',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Fatture Scadute',
      source: { table: 'entity', type: 'fattura', filters: { stato: 'scaduta' } },
      columns: [
        { key: 'numero', label: 'Numero', type: 'text' },
        { key: 'display_name', label: 'Descrizione', type: 'text' },
        { key: 'totale', label: 'Totale', type: 'currency' },
        { key: 'data', label: 'Data', type: 'date' },
        { key: 'stato', label: 'Stato', type: 'badge' },
      ],
      actions: ['export'],
    },
  },
  {
    id: 'fatture',
    label: 'Fatture',
    icon: 'receipt',
    trigger: 'on_find:fattura',
    layout: {
      view: 'list',
      title: 'Fatture',
      source: { table: 'entity', type: 'fattura' },
      columns: [
        { key: 'numero', label: 'N.', type: 'text' },
        { key: 'display_name', label: 'Descrizione', type: 'text' },
        { key: 'totale', label: 'Totale', type: 'currency' },
        { key: 'stato', label: 'Stato', type: 'badge' },
        { key: 'data', label: 'Data', type: 'date' },
      ],
    },
  },
  {
    id: 'cash_flow',
    label: 'Cash Flow',
    icon: 'trending-up',
    trigger: 'manual',
    layout: {
      view: 'chart',
      title: 'Cash Flow Mensile',
      chart: { type: 'line', data: [] },
    },
  },
  {
    id: 'conti',
    label: 'Conti',
    icon: 'wallet',
    trigger: 'on_find:conto',
    layout: {
      view: 'list',
      title: 'Conti',
      source: { table: 'entity', type: 'conto' },
      columns: [
        { key: 'display_name', label: 'Conto', type: 'text' },
        { key: 'totale', label: 'Saldo', type: 'currency' },
        { key: 'stato', label: 'Tipo', type: 'badge' },
      ],
    },
  },
]

export default views
