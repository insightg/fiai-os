import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'viaggi',
    label: 'Viaggi',
    icon: 'truck',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Viaggi da Pianificare',
      source: { tool: 'planning_viaggi', params: {} },
      columns: [
        { key: 'bg', label: 'BG', type: 'text' },
        { key: 'cliente', label: 'Cliente', type: 'text' },
        { key: 'luogo_carico', label: 'Carico', type: 'text' },
        { key: 'luogo_scarico', label: 'Scarico', type: 'text' },
        { key: 'data_carico', label: 'Data', type: 'date' },
      ],
    },
  },
]

export default views
