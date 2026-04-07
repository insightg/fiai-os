import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: 'funnel',
    trigger: 'auto',
    layout: {
      view: 'kanban',
      title: 'Pipeline Commerciale',
      source: { table: 'entity', tags: ['lead'] },
      kanban: {
        groupBy: 'stato',
        groups: [
          { value: 'nuovo', label: 'Nuovi', color: '#1976D2' },
          { value: 'contattato', label: 'Contattati', color: '#E68A00' },
          { value: 'qualificato', label: 'Qualificati', color: '#9C27B0' },
          { value: 'proposta', label: 'Proposta', color: '#2D8B56' },
        ],
        cardTitle: 'display_name',
        cardSubtitle: 'email',
      },
    },
  },
  {
    id: 'clienti',
    label: 'Clienti',
    icon: 'users',
    trigger: 'on_find:cliente',
    layout: {
      view: 'list',
      title: 'Clienti',
      source: { table: 'entity', tags: ['cliente'] },
      columns: [
        { key: 'display_name', label: 'Ragione Sociale', type: 'text' },
        { key: 'metadata.cognome', label: 'Contatto', type: 'text' },
        { key: 'metadata.citta', label: 'Citta', type: 'text' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'telefono', label: 'Telefono', type: 'phone' },
        { key: 'tags', label: 'Tipo', type: 'tags' },
      ],
      actions: ['create', 'edit'],
    },
  },
  {
    id: 'dettaglio',
    label: 'Dettaglio',
    icon: 'user',
    trigger: 'on_get_tree',
    layout: {
      view: 'detail',
      title: 'Dettaglio Cliente',
      sections: [
        { title: 'Anagrafica', fields: [
          { key: 'display_name', label: 'Ragione Sociale' },
          { key: 'metadata.cognome', label: 'Contatto' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'telefono', label: 'Telefono', type: 'phone' },
          { key: 'piva', label: 'P.IVA' },
          { key: 'metadata.indirizzo', label: 'Indirizzo' },
          { key: 'metadata.citta', label: 'Citta' },
          { key: 'metadata.provincia', label: 'Provincia' },
        ]},
      ],
      tabs: [
        { id: 'fatture', label: 'Fatture', source: { table: 'entity', type: 'fattura' }, columns: [
          { key: 'numero', label: 'N.', type: 'text' },
          { key: 'totale', label: 'Totale', type: 'currency' },
          { key: 'stato', label: 'Stato', type: 'badge' },
        ]},
        { id: 'preventivi', label: 'Preventivi', source: { table: 'entity', type: 'preventivo' }, columns: [
          { key: 'numero', label: 'N.', type: 'text' },
          { key: 'totale', label: 'Totale', type: 'currency' },
          { key: 'stato', label: 'Stato', type: 'badge' },
        ]},
      ],
    },
  },
]

export default views
