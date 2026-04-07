import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'salute',
    label: 'Salute',
    icon: 'heart-pulse',
    trigger: 'auto',
    layout: {
      view: 'detail',
      title: 'Salute Sistema',
      sections: [
        { title: 'Stato Servizi', fields: [
          { key: 'database', label: 'Database' },
          { key: 'whatsapp', label: 'WhatsApp' },
          { key: 'embedding', label: 'Embedding Pipeline' },
          { key: 'job_worker', label: 'Job Worker' },
        ]},
      ],
    },
  },
  {
    id: 'errori',
    label: 'Errori',
    icon: 'alert-circle',
    trigger: 'on_tool:get_agent_logs',
    layout: {
      view: 'list',
      title: 'Log Errori',
    },
  },
]

export default views
