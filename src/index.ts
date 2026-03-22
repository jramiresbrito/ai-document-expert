import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { CONFIG } from "./config.ts";
import { DocumentProcessor } from "./documentProcessor.ts";
import { type PretrainedOptions } from "@huggingface/transformers";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { displayResults } from "./util.ts";

let _neo4jVectorStore = null

async function clearAll(vectorStore: Neo4jVectorStore, nodeLabel: string): Promise<void> {
  console.log("🗑️  Removendo todos os documentos existentes...");
  await vectorStore.query(
    `MATCH (n:\`${nodeLabel}\`) DETACH DELETE n`
  )
  console.log("✅ Documentos removidos com sucesso\n");
}


try {
  console.log("🚀 Inicializando sistema de Embeddings com Neo4j...\n");

  const documentProcessor = new DocumentProcessor(
    CONFIG.pdf.path,
    CONFIG.textSplitter,
  )
  const documents = await documentProcessor.loadAndSplit()
  const embeddings = new HuggingFaceTransformersEmbeddings({
    model: CONFIG.embedding.modelName,
    pretrainedOptions: CONFIG.embedding.pretrainedOptions as PretrainedOptions
  })

  _neo4jVectorStore = await Neo4jVectorStore.fromExistingGraph(
    embeddings,
    CONFIG.neo4j
  )

  clearAll(_neo4jVectorStore, CONFIG.neo4j.nodeLabel)
  for (const [index, doc] of documents.entries()) {
    console.log(`✅ Adicionando documento ${index + 1}/${documents.length}`);
    await _neo4jVectorStore.addDocuments([doc])
  }
  console.log("\n✅ Base de dados populada com sucesso!\n");


  // ==================== STEP 2: RUN SIMILARITY SEARCH ====================
  console.log("🔍 ETAPA 2: Executando buscas por similaridade...\n");
  const questions = [
    "Quem é o protagonista e como ele descreve sua infância?",
    "Qual é a relação do menino com o espelho?",
    "Como o autor retrata a imaginação infantil no livro?",
    "Quais são os personagens mais marcantes da história?",
    "Que papel a família desempenha na narrativa?",
    "Como o livro aborda o tema da passagem do tempo e do amadurecimento?",
  ]

  for (const question of questions) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📌 PERGUNTA: ${question}`);
    console.log('='.repeat(80));

    const results = await _neo4jVectorStore.similaritySearch(
      question,
      CONFIG.similarity.topK
    )
    displayResults(results)
  }


  // Cleanup
  console.log(`\n${'='.repeat(80)}`);
  console.log("✅ Processamento concluído com sucesso!\n");

} catch (error) {
  console.error('error', error)
} finally {
  await _neo4jVectorStore?.close();
}