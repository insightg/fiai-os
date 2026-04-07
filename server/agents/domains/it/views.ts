import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'agenti_autonomi',
    label: 'Agenti',
    icon: 'bot',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Agenti Autonomi',
      source: { table: 'entity', type: 'autonomous_agent' },
      columns: [
        { key: 'display_name', label: 'Nome', type: 'text' },
        { key: 'stato', label: 'Stato', type: 'badge' },
        { key: 'created_at', label: 'Creato', type: 'date' },
      ],
    },
  },
  {
    id: 'jobs',
    label: 'Job Queue',
    icon: 'clock',
    trigger: 'on_tool:get_jobs',
    layout: {
      view: 'list',
      title: 'Job Queue',
    },
  },
  {
    id: 'costi',
    label: 'Costi API',
    icon: 'credit-card',
    trigger: 'on_tool:get_api_costs',
    layout: {
      view: 'chart',
      title: 'Costi API',
      chart: { type: 'bar', data: [] },
    },
  },
]

export default views
