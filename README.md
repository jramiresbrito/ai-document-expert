# AI Document Expert

A RAG (Retrieval-Augmented Generation) system that turns any PDF document into a searchable knowledge base using vector embeddings and Neo4j. By indexing document content as vectors, it enables semantic similarity search — allowing an AI agent to act as a domain expert on the provided material.

## Use Cases

- **This example**: Uses Fernando Sabino's book _"O Menino no Espelho"_ to answer questions about its content.
- **Enterprise**: Companies can index software documentation, internal wikis, or support articles to power AI assistants for internal or external users.

## How It Works

```
PDF Document
    │
    ▼
┌──────────────────┐
│ PDF Loader       │  Extracts raw text from each page
│ (LangChain)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Text Splitter    │  Splits into chunks (500 chars, 200 overlap)
│ (Recursive)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Embeddings       │  Converts chunks into vector representations
│ (HuggingFace)    │  using a local transformer model
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Neo4j Vector     │  Stores vectors as graph nodes with a
│ Store            │  vector index for similarity search
└────────┬─────────┘
         │
         ▼
   Similarity Search → Top-K relevant chunks returned
         │
         ▼
┌──────────────────┐
│ AI Agent         │  Uses retrieved context + prompts to generate
│ (LangChain)      │  expert answers in natural language
└────────┬─────────┘
         │
         ▼
   Answers saved to ./answers/ folder
```

## Performance Optimization

The system includes automatic PDF change detection using SHA256 file hashing:

- **First run**: Processes the PDF and saves a hash file (`.pdf.hash`)
- **Subsequent runs**: Compares current PDF hash with stored hash
- **If unchanged**: Skips expensive PDF processing and vector storage steps
- **If changed**: Reprocesses the PDF and updates the hash

This optimization significantly speeds up repeated runs when the PDF hasn't changed, while ensuring data consistency when it has.

### Force Reprocessing

To manually force PDF reprocessing (useful when changing text splitter settings or embeddings configuration):

```bash
npm start -- --force-reprocess
```

This bypasses the hash check and always reprocesses the PDF.

## Tech Stack

| Component      | Technology                                      |
| -------------- | ----------------------------------------------- |
| Runtime        | Node.js v22 (experimental TypeScript stripping) |
| Language       | TypeScript                                      |
| Embeddings     | HuggingFace Transformers (local, no API calls)  |
| Vector Store   | Neo4j with vector index                         |
| PDF Processing | LangChain PDF Loader + Recursive Text Splitter  |
| LLM Gateway    | OpenRouter (configurable model)                 |
| AI Framework   | LangChain (chains, prompts, output parsers)     |

## Prerequisites

- Node.js v22.13.1+
- Docker & Docker Compose

## Getting Started

### 1. Start Infrastructure

```bash
npm ci
npm run infra:up
```

This starts a Neo4j instance on ports `7474` (browser) and `7687` (Bolt).

### 2. Configure Environment

Create a `.env` file in the project root:

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=your_neo4j_user
NEO4J_PASSWORD=your_neo4j_password

EMBEDDING_MODEL=your-model-name

NLP_MODEL=your-model-name
OPENROUTER_API_KEY=your-api-key
OPENROUTER_SITE_URL=http://localhost
OPENROUTER_SITE_NAME=ai-document-expert
```

### 3. Add Your PDF

Place your PDF document in the project root and update the path in [src/config.ts](src/config.ts) (`CONFIG.pdf.path`).

### 4. Customize Prompts (Optional)

Edit the prompts in the `prompts/` folder:

- `answerPrompt.json`: Defines the AI agent's role, instructions, and constraints
- `template.txt`: The prompt template used for generating responses

### 5. Run

```bash
npm start
```

The system will:

1. Check if the PDF has changed since last run (using file hash)
2. If unchanged, skip PDF processing and vector storage
3. If changed or first run, load and split the PDF, generate embeddings, and store vectors in Neo4j
4. Run predefined questions through the AI agent
5. Save answers to the `answers/` folder

For development with hot reload:

```bash
npm run dev
```

**Note**: To force reprocessing of the PDF (e.g., if you changed the text splitter settings), use the `--force-reprocess` flag:

```bash
npm start -- --force-reprocess
```

## Project Structure

```
src/
├── ai.ts                  # AI agent class for question answering
├── config.ts              # Centralized configuration (Neo4j, embeddings, OpenRouter)
├── documentProcessor.ts   # PDF loading and text chunking
├── index.ts               # Main pipeline: ingest → index → search → answer
└── util.ts                # Display helpers for search results

prompts/
├── answerPrompt.json      # AI agent configuration (role, instructions, constraints)
└── template.txt           # Prompt template for response generation

answers/                   # Generated answers saved here
├── answer-0-[timestamp].md
├── answer-1-[timestamp].md
└── ...

[your-pdf].pdf             # Your input PDF document
[your-pdf].pdf.hash        # Hash file to track PDF changes

neo4j/                     # Neo4j data and configuration
├── data/
├── logs/
└── ...

docker-compose.yml         # Neo4j service configuration
package.json               # Dependencies and scripts
tsconfig.json              # TypeScript configuration
```

## AI Agent

The system includes an intelligent AI agent that:

- Retrieves relevant document chunks using vector similarity search
- Uses configurable prompts to generate expert answers
- Handles errors gracefully (e.g., rate limits, no relevant context)
- Saves responses in Markdown format to the `answers/` folder

### Prompt Configuration

The `prompts/answerPrompt.json` file defines:

- **Role**: The AI's persona (e.g., "specialist in Fernando Sabino")
- **Task**: What the AI should do
- **Instructions**: Step-by-step guidelines
- **Constraints**: Language, tone, length, format requirements
- **Examples**: Sample Q&A pairs

### Customization

To adapt the system for different documents:

1. Update `CONFIG.pdf.path` in `src/config.ts`
2. Modify `prompts/answerPrompt.json` to match the domain expertise needed
3. Adjust `prompts/template.txt` if needed
4. Update questions in `src/index.ts` or implement a CLI/API for dynamic queries

## Tear Down

```bash
npm run infra:down
```

This stops Neo4j and removes its volumes.
