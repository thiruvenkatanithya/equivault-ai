# 📈 EquiVault AI - Enterprise Agentic RAG for Stock Market Education

EquiVault AI is a professional, secure, and agentic Retrieval-Augmented Generation (RAG) platform designed to teach users stock market strategies. It utilizes a stateful agentic workflow to ensure accuracy, security, and compliance.

## 🏛️ System Architecture

### High-Level Flow
`User Query` $\rightarrow$ `JWT Auth` $\rightarrow$ `Input Guardrail` $\rightarrow$ `LangGraph Router` $\rightarrow$ `{ACL-Filtered Retrieval | Consent-Gated Web Search}` $\rightarrow$ `Output Guardrail` $\rightarrow$ `SSE Response`

### Technical Stack
- **Frontend**: React.js, custom CSS (Trading Terminal UI), Markdown rendering, and Axios.
- **API Gateway**: FastAPI (Python), JWT Authentication, Pydantic Schemas.
- **Agentic Brain**: LangGraph state graph with LangChain integrations; Llama 3.2 served by Ollama.
- **RAG**: ChromaDB vector store, Hugging Face sentence-transformer embeddings, LangChain document loaders and text splitters.
- **Security**: Role-Based ACL, Input/Output Guardrails, Prompt Hardening.

### LangChain Concepts Used
- **Prompt templates**: `ChatPromptTemplate` builds system and human-message templates. System prompt text is maintained in `config/prompts.yaml`; the user query, retrieved context, and web-search evidence are passed as separate template values.
- **Model invocation and LCEL**: `prompt | llm` composes a prompt with the configured `ChatOllama` model using LangChain Expression Language (LCEL). `.invoke(...)` runs the synchronous router, retrieval-answer, and web-summary model calls.
- **Typed graph state and messages**: `AgentState` is a `TypedDict` used as the LangGraph state schema, and its message history uses LangChain `BaseMessage` types.
- **Embeddings and vector search**: `HuggingFaceEmbeddings` creates vectors; LangChain's `Chroma` integration performs relevance-ranked similarity search with role-based metadata filters.
- **Document ingestion**: `PyPDFLoader` and `TextLoader` load source documents. LangChain text splitters produce chunks for ingestion; chunks are stored as documents with source and access-level metadata.
- **LangGraph orchestration**: `StateGraph` connects routing, retrieval, answer generation, and web-search nodes. `MemorySaver` is configured as the graph checkpointer.

## 🚀 Key Engineering Concepts Implemented

### 1. Agentic Workflow (LangGraph)
EquiVault uses a **StateGraph** to route a request:
- **Knowledge requests** search only the documents authorized for the signed-in user's role.
- **Missing vault content** returns a human-in-the-loop consent prompt. No web request is made until the user selects **Search the web**; **Not now** leaves the request unanswered from external sources.
- **Explicit online requests** (for example, asking for today's news or saying “search the web”) are treated as the user's consent to search.
- **Domain restriction**: Web search is limited to stock-market and stock-related questions. Greetings and identity questions receive a short introduction; unrelated news or general questions are declined without searching, even if they ask for a web search.
- **Streaming responses** use Server-Sent Events (SSE): generated answer text appears incrementally, followed by sources, chart data, and final status. The frontend can still display a regular JSON response from a backend that has not yet been restarted, but that compatibility fallback is not streamed.
- **Market charts** are added for stock-specific requests when Yahoo Finance has matching price-history data. The response identifies the symbol, exchange, currency, and available quote time.
- **State persistence** uses LangGraph's in-memory `MemorySaver` checkpointer.

### 2. Security & Compliance (The "Vault" aspect)
- **ACL-Filtered Retrieval**: Implements metadata filtering in ChromaDB. A user's JWT role determines which document chunks they can retrieve (Basic $\rightarrow$ Premium $\rightarrow$ Admin).
- **Guardrail Layer**:
    - Input and output checks reject disallowed requests and unsafe financial claims.
    - The model is instructed to treat user input, retrieved documents, and web results as data, not instructions.
- **Web result isolation**: Search snippets are JSON-encoded and supplied only to a summarization model with no tools bound to it. The app does not execute code or commands, follow links, or invoke tools based on text returned by a search. Web snippets remain unverified third-party data and may still be incomplete or inaccurate.

### 3. Advanced Ingestion Pipeline
- **Multi-Strategy Factory**: Supports `Recursive`, `Fixed`, `Token`, `Semantic`, and **`Agentic`** chunking.
- **Agentic Chunking**: Uses the LLM to identify logical conceptual boundaries instead of fixed character counts.
- **Supported Ingestion Formats**: Handles `.pdf` and `.txt` source documents.

### 4. Production Observability
- **Audit Trail**: Every decision (Routing $\rightarrow$ Retrieval $\rightarrow$ Generation) is logged in `equivault_audit.log` with timestamps and User IDs.
- **Evals**: Includes an evaluation script (`evals.py`) to measure faithfulness and accuracy against a Golden Dataset.

## 🛠️ Setup Guide

### Prerequisites
- Install [Ollama](https://ollama.com) and run: `ollama pull llama3.2`
- Python 3.10+ & Node.js

### Backend Installation
1. **Navigate to backend folder**:
   ```bash
   cd backend
   ```
2. **Create and Activate Virtual Environment (Recommended)**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
3. **Install Dependencies**:
   ```bash
   pip install -r ../requirements.txt
   ```
4. **Run Ingestion**:
   ```bash
   python3 ingestion.py recursive
   ```
   Pass `recursive`, `fixed`, `semantic`, `token`, or `agentic` to select a strategy directly. Omit the argument to choose interactively or use the configured default.
   
   This command indexes every supported `.pdf` and `.txt` file currently in `data/source_docs` and refreshes ACL labels on already-indexed documents. The current files are:
   - Basic: `intro.txt`, `beginner_stock_market_guide.txt`, `Stocks_Trading_For_Beginner_Traders.pdf`
   - Premium: `strategies.txt`, `premium_equity_analysis_guide.txt`, `Currency-Hedging-WP.pdf`
   - Admin: `advanced_hedging.txt`, `admin_market_risk_guide.txt`

   When adding another source file, add its filename and access level to the `role_mapping` in `backend/ingestion.py` before running ingestion. Unmapped files fail closed rather than being indexed with unintended access.
   
   The additional `.txt` guides are original EquiVault educational material, not downloaded SEC publications. They include SEC links as optional further reading.
5. **Start the Server**:
   ```bash
   python3 -m app.main
   ```

### Frontend Installation
```bash
cd frontend
npm install
npm start
```

## Access-Control Tests

Run the backend and frontend, open `http://localhost:3000`, and sign in with the local test accounts documented in `TEST_ACCOUNTS.local.md` (kept out of Git).

Suggested checks (run ingestion first so all guides are indexed):

1. Sign in as **Basic** and ask: “What is a share and what should a beginner learn first?” The answer should use Basic learning material. Ask about portfolio stress-test controls from the Admin guide; it should not retrieve Admin-only content.
2. Sign in as **Premium** and ask: “How can I compare cash flow with reported earnings?” The answer may use the Premium equity-analysis guide and Basic documents. Admin-only risk-control content must remain unavailable.
3. Sign in as **Admin** and ask: “What should a market-risk stress-test review record include?” The answer may use the Admin risk guide and all lower-level documents.
4. For a question not answered by the signed-in user's authorized documents, verify that EquiVault asks before searching. Select **Not now** and confirm no web search occurs; repeat and select **Search the web** to see source links and any available stock chart. An explicit request such as “Search the web for today's market news” searches directly because the request itself expresses consent.

The accounts are for development testing only. Replace them and the in-memory account setup before deploying the application.
