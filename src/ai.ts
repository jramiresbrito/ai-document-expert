import { type Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";

type DebugLog = (...args: unknown[]) => void;
interface PromptConfig {
  role: string
  task: string
  instructions: string[]
  constraints: {
    language: string
    tone: string
    max_length: number
    format: string
  }
  examples?: Array<{
    question: string
    expected_structure: string
  }>
  context_rules?: {
    use_only_provided_context: boolean
    cite_examples_from_context: boolean
    indicate_if_insufficient_context: boolean
  }
}

type params = {
  debugLog: DebugLog,
  vectorStore: Neo4jVectorStore,
  nlpModel: ChatOpenAI,
  promptConfig: PromptConfig
  templateText: string,
  topK: number,
}

interface ChainState {
  question: string;
  context?: string;
  topScore?: number;
  error?: string;
  answer?: string;
}

export class AI {
  private params: params

  constructor(params: params) {
    this.params = params
  }

  async retrieveVectorSearchResults(input: ChainState): Promise<ChainState> {
    this.params.debugLog('🔍 Buscando no vector store do Neo4j...')
    const vectorResults = await this.params.vectorStore
      .similaritySearchWithScore(input.question, this.params.topK)

    if (!vectorResults.length) {
      this.params.debugLog("⚠️ Nenhum resultado encontrado no vector store.")

      return {
        ...input,
        error: "Desculpe, não encontrei informações relevantes sobre essa pergunta na base de conhecimento"
      }
    }

    const topScore = vectorResults[0]![1]
    this.params.debugLog(`✅ Encontrados ${vectorResults.length} resultados relevantes (melhor score: ${topScore.toFixed(3)})`)

    const contexts = vectorResults
      .filter(([, score]) => score > 0.5)
      .map(([doc]) => doc.pageContent)
      .join("\n\n---\n\n")

    return {
      ...input,
      context: contexts,
      topScore
    }
  }

  async generateNLPResponse(input: ChainState): Promise<ChainState> {
    if (input.error) return input

    this.params.debugLog("🤖 Gerando a resposta do Agente...")

    const responsePromt = ChatPromptTemplate.fromTemplate(
      this.params.templateText
    )

    const responseChain = responsePromt
      .pipe(this.params.nlpModel)
      .pipe(new StringOutputParser())

    try {
      const rawResponse = await responseChain.invoke({
        role: this.params.promptConfig.role,
        task: this.params.promptConfig.task,
        tone: this.params.promptConfig.constraints.tone,
        language: this.params.promptConfig.constraints.language,
        format: this.params.promptConfig.constraints.format,
        instructions: this.params.promptConfig.instructions.map((instruction:
          string, idx: number) =>
          `${idx + 1}. ${instruction}`
        ).join('\n'),
        question: input.question,
        context: input.context
      })

      return {
        ...input,
        answer: rawResponse
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      this.params.debugLog('🛑 rate limit', msg)
      return { ...input, error: 'Serviço de modelo temporariamente indisponível. Tente novamente em alguns segundos. Ou troque o modelo' }
    }
  }

  async answerQuestion(question: string) {
    const chain = RunnableSequence.from([
      this.retrieveVectorSearchResults.bind(this),
      this.generateNLPResponse.bind(this)
    ])
    const result = await chain.invoke({ question })
    this.params.debugLog("\n ❓ Pergunta:")
    this.params.debugLog(question, "\n")
    this.params.debugLog("💬 Resposta:")
    this.params.debugLog(result.answer || result.error, "\n")

    return result
  }
}