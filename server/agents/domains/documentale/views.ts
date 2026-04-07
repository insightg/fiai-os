import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'archivio',
    label: 'Archivio',
    icon: 'archive',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Archivio Documenti',
      source: { table: 'entity', type: 'documento' },
      columns: [
        { key: 'display_name', label: 'Nome', type: 'text' },
        { key: 'categoria', label: 'Categoria', type: 'badge' },
        { key: 'stato', label: 'Stato', type: 'badge' },
        { key: 'created_at', label: 'Caricato', type: 'date' },
      ],
    },
  },
  {
    id: 'struttura',
    label: 'Struttura',
    icon: 'list-tree',
    trigger: 'on_tool:explore_document',
    layout: {
      view: 'detail',
      title: 'Struttura Documento',
    },
  },
  {
    id: 'risultati',
    label: 'Risultati',
    icon: 'search',
    trigger: 'on_tool:retrieve',
    layout: {
      view: 'list',
      title: 'Risultati Ricerca',
    },
  },
]

export default views
