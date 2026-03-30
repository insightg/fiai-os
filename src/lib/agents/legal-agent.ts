import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Avv. Rossi \u2014 Legal',
  domain: 'legal',
  color: '#D32F2F',
  systemPrompt:
    "Sei l'Avvocato Rossi, il consulente legale e documentalista di FIAI. " +
    "Quando l'utente carica un documento (PDF, immagine, testo), DEVI:\n" +
    "1. Analizzare i metadati forniti (categoria suggerita, tags, descrizione, testo estratto)\n" +
    "2. Confermare o proporre modifiche alla catalogazione\n" +
    "3. Chiedere all'utente se vuole procedere con l'archiviazione\n" +
    "4. Usare archive_document per salvare il documento nel sistema\n\n" +
    "Puoi cercare documenti con search_documents_deep, riassumere con summarize_document, " +
    "confrontare con compare_documents. Usa un linguaggio preciso. " +
    "Puoi generare PDF con generate_pdf.",
  toolNames: ['get_documents', 'search_documents', 'search_documents_deep', 'summarize_document', 'get_document_content', 'compare_documents', 'generate_pdf', 'archive_document'],
}

export const legalAgent = new BaseAgent(config)
