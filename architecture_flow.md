# EquiVault AI Architecture

This document describes the implemented application and ingestion flows.

## Chat request flow

```mermaid
flowchart TD
    User((User)) --> UI[React frontend]
    UI -->|POST /chat: message + JWT| API[FastAPI API]
    API --> Auth{JWT valid?}
    Auth -->|No| Unauthorized[401 response]
    Auth -->|Yes| State[Build chat state with user role]
    State --> Router[LangGraph router]

    Router --> Greeting{Greeting or identity query?}
    Greeting -->|Yes| Direct[Return short introduction]
    Greeting -->|No| Guardrail{Input guardrail accepts query?}
    Guardrail -->|No| Rejected[Return scope rejection]
    Guardrail -->|Yes| Consent{Explicit web request or user consent?}
    Consent -->|Yes| Web[Web search node]
    Consent -->|No| Intent[Ollama router classifies intent]
    Intent -->|KNOWLEDGE| Retrieve[ACL-filtered retrieval]
    Intent -->|WEB or REALTIME| Web
    Intent -->|Other| Retrieve

    Retrieve --> Filter[ChromaDB similarity search]
    Filter --> Threshold{Relevant authorized chunks found?}
    Threshold -->|No| AskConsent[Return consent prompt; do not search yet]
    Threshold -->|Yes| Generate[Generate answer from authorized context]

    Web --> DDG[DuckDuckGo search]
    DDG --> Summary[Ollama summarizes supplied search snippets]
    Web --> StockIntent{Stock-specific chart query?}
    StockIntent -->|Yes| Yahoo[Fetch price history from Yahoo Finance]
    StockIntent -->|No| NoChart[No chart data]

    Generate --> OutputCheck[Output guardrail]
    Summary --> OutputCheck
    Direct --> Stream[Stream response using Server-Sent Events]
    Rejected --> Stream
    AskConsent --> Stream
    OutputCheck --> Stream
    Yahoo --> Stream
    NoChart --> Stream
    Stream --> UI

    API -. audit events .-> Audit[Application audit log]
```

### Chat behavior

- `POST /token` authenticates the in-memory development accounts and issues a JWT. Protected endpoints, including `/chat`, validate that token.
- The router directly handles greetings and identity questions, then checks the input guardrail. A query outside the supported stock-market and investing scope is rejected.
- An explicit web request or a user-confirmed web-search prompt routes to web search. Otherwise, Ollama classifies the query. `KNOWLEDGE` uses retrieval; `WEB` and `REALTIME` both route to the web-search node.
- Retrieval applies the role hierarchy (`Basic`; `Premium` plus `Basic`; `Admin` plus lower roles) as a ChromaDB metadata filter. If no authorized result reaches the relevance threshold, the app asks whether to search the web and waits for user consent.
- Answer generation uses only retrieved authorized context. The web summarizer receives JSON-encoded search snippets as untrusted data and has no tools. Both generated answers and web summaries are checked for prohibited financial guarantees.
- For stock-specific web queries with a resolvable equity symbol, the web-search node fetches one-year daily price data from Yahoo Finance. The frontend renders a price/volume chart when chart data is returned; it does not generate arbitrary diagrams or earnings-calendar charts.
- The API streams status, text, and final metadata (sources, chart data, and search-consent state) to the React frontend using SSE. LangGraph uses an in-memory `MemorySaver` checkpointer; it is not durable storage.

## Document ingestion flow

```mermaid
flowchart LR
    Files[PDF and TXT source documents] --> Load[PyPDFLoader or TextLoader]
    Load --> Strategy{Selected chunking strategy}
    Strategy -->|recursive, fixed, token| TextSplit[Text splitter]
    Strategy -->|semantic| Semantic[SemanticChunker with Hugging Face embeddings]
    Strategy -->|agentic| Ollama[Ollama identifies logical chunks per page]
    TextSplit --> Metadata[Attach source and configured access level]
    Semantic --> Metadata
    Ollama --> Metadata
    Metadata --> Vectorize[Hugging Face embeddings]
    Vectorize --> Chroma[(Persistent ChromaDB collection)]
    Chroma --> Retrieval[Role-filtered chat retrieval]
```

The access level is configured for each source filename in `backend/ingestion.py`. New files must be added to that mapping before ingestion; unknown files fail closed.
