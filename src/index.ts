import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { CONFIG } from "./config.ts";
import { DocumentProcessor } from "./documentProcessor.ts";
import { type PretrainedOptions } from "@huggingface/transformers";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { ChatOpenAI } from "@langchain/openai";
import { AI } from "./ai.ts";
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

let _neo4jVectorStore = null

// Parse command line arguments
const args = process.argv.slice(2)
const forceReprocess = args.includes('--force-reprocess')
const HASH_DISPLAY_LENGTH = 16

async function computeFileHash(filePath: string): Promise<string> {
  try {
    const fileBuffer = await readFile(filePath)
    const hashSum = createHash('sha256')
    hashSum.update(fileBuffer)
    return hashSum.digest('hex')
  } catch (error) {
    throw new Error(`Failed to compute hash for ${filePath}: ${(error as Error).message}`)
  }
}

async function clearAll(vectorStore: Neo4jVectorStore, nodeLabel: string): Promise<void> {
  console.log("🗑️  Removendo todos os documentos existentes...");
  await vectorStore.query(
    `MATCH (n:\`${nodeLabel}\`) DETACH DELETE n`
  )
  console.log("✅ Documentos removidos com sucesso\n");
}

try {
  console.log("🚀 Inicializando sistema de Embeddings com Neo4j...\n");

  const pdfPath = CONFIG.pdf.path
  const hashFilePath = `${pdfPath}.hash`

  // Compute current PDF hash
  const currentHash = await computeFileHash(pdfPath)
  console.log(`📄 Hash do PDF atual: ${currentHash.substring(0, HASH_DISPLAY_LENGTH)}...`)

  // Check if we need to reprocess
  let needsProcessing = forceReprocess
  if (!forceReprocess) {
    try {
      const storedHash = await readFile(hashFilePath, 'utf-8')
      if (storedHash === currentHash) {
        console.log("✅ PDF não mudou desde a última execução. Pulando processamento.\n")
        needsProcessing = false
      } else {
        console.log("🔄 PDF mudou. Reprocessando...\n")
        needsProcessing = true
      }
    } catch (error) {
      console.log("ℹ️  Primeira execução ou hash não encontrado. Processando PDF...\n")
      needsProcessing = true
    }
  } else {
    console.log("🔄 Flag --force-reprocess ativada. Reprocessando PDF...\n")
  }

  const embeddings = new HuggingFaceTransformersEmbeddings({
    model: CONFIG.embedding.modelName,
    pretrainedOptions: CONFIG.embedding.pretrainedOptions as PretrainedOptions
  })

  const nlpModel = new ChatOpenAI({
    temperature: CONFIG.openRouter.temperature,
    maxRetries: CONFIG.openRouter.maxRetries,
    modelName: CONFIG.openRouter.nlpModel,
    openAIApiKey: CONFIG.openRouter.apiKey,
    configuration: {
      baseURL: CONFIG.openRouter.url,
      defaultHeaders: CONFIG.openRouter.defaultHeaders
    }
  })

  _neo4jVectorStore = await Neo4jVectorStore.fromExistingGraph(
    embeddings,
    CONFIG.neo4j
  )

  if (needsProcessing) {
    const documentProcessor = new DocumentProcessor(
      pdfPath,
      CONFIG.textSplitter,
    )
    const documents = await documentProcessor.loadAndSplit()

    clearAll(_neo4jVectorStore, CONFIG.neo4j.nodeLabel)
    for (const [index, doc] of documents.entries()) {
      console.log(`✅ Adicionando documento ${index + 1}/${documents.length}`);
      await _neo4jVectorStore.addDocuments([doc])
    }
    console.log("\n✅ Base de dados populada com sucesso!\n");

    // Save the new hash
    await writeFile(hashFilePath, currentHash)
    console.log(`💾 Hash salvo em ${hashFilePath}\n`)
  }

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

  const ai = new AI({
    nlpModel,
    debugLog: console.log,
    vectorStore: _neo4jVectorStore,
    promptConfig: CONFIG.promptConfig,
    templateText: CONFIG.templateText,
    topK: CONFIG.similarity.topK
  })

  for (const index in questions) {
    const question = questions[index]
    console.log(`\n${'='.repeat(80)}`)
    console.log(`⁉️ PERGUNTA: ${question}`)
    console.log(`\n${'='.repeat(80)}`)

    const result = await ai.answerQuestion(question!)
    if (result.error) {
      console.log(`\n ❌ Erro: ${result.error}\n`)
      continue
    }

    console.log(`\n${result.answer}\n`)
    await mkdir(CONFIG.output.answersFolder, { recursive: true })
    const fileName = `${CONFIG.output.answersFolder}/${CONFIG.output.fileName}-${index}-${Date.now()}.md`
    await writeFile(fileName, result.answer!)
  }

  // Cleanup
  console.log(`\n${'='.repeat(80)}`);
  console.log("✅ Processamento concluído com sucesso!\n");

} catch (error) {
  console.error('error', error)
} finally {
  await _neo4jVectorStore?.close();
}