import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'inbox',
    label: 'Inbox',
    icon: 'mail',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Email Recenti',
      source: { tool: 'read_inbox', params: { limit: 20 } },
      columns: [
        { key: 'from', label: 'Da', type: 'text' },
        { key: 'subject', label: 'Oggetto', type: 'text' },
        { key: 'date', label: 'Data', type: 'date' },
        { key: 'hasAttachments', label: 'Allegati', type: 'boolean' },
      ],
    },
  },
]

export default views
