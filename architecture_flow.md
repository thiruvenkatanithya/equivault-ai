# 🗺️ EquiVault AI: Detailed Architecture Flow

This document describes the end-to-end logic of the EquiVault AI system. You can copy the code block below and paste it into the [Mermaid Live Editor](https://mermaid.live/) to generate a high-resolution, colorful visual diagram.

## 📊 Visual Flow Chart (Mermaid Code)

```mermaid
graph TD
    %% User Interaction Layer
    User((User)) -->|Inputs Query| Frontend[React Frontend]
    Frontend -->|JWT Token + Query| Gateway[FastAPI Gateway]
    
    %% Security Layer
    Gateway -->|Auth Check| JWT{JWT Valid?}
    JWT -->|No| Login[Login Page]
    JWT -->|Yes| RoleCheck[Extract User Role]
    
    %% Agentic Brain (LangGraph)
    RoleCheck -->|User Role| LG_Start((LangGraph Entry))
    LG_Start --> Router[Strategist Router Node]
    
    %% Decision Logic
    Router -->|Intent: KNOWLEDGE| RAG_Node[ACL-Filtered RAG Node]
    Router -->|Intent: REALTIME| Tool_Node[Finance Tool Node]
    Router -->|Intent: WEB/GAP| HITL_Node[Human-in-the-Loop Node]
    
    %% RAG Deep Dive
    RAG_Node -->|Query + Role| Chroma[(ChromaDB)]
    Chroma -->|Metadata Filter: role in allowed_roles| RAG_Node
    RAG_Node -->|Context Chunks| Gen_Node[Educator Generator Node]
    
    %% Tool & HITL Flow
    Tool_Node -->|Real-time Data| Gen_Node
    HITL_Node -->|Pause State| Admin((Human Admin))
    Admin -->|Approval/Search| Gen_Node
    
    %% Final Output Guardrails
    Gen_Node -->|Raw Answer| Guardrail{Output Guardrail}
    Guardrail -->|Violation Found| Error[Compliance Warning]
    Guardrail -->|Safe| Final[Final Deterministic Answer]
    
    %% Return Path
    Error --> Frontend
    Final --> Frontend
    
    %% Styling
    style User fill:#f9f,stroke:#333,stroke-width:2px
    style LG_Start fill:#fff4dd,stroke:#d4a017,stroke-width:2px
    style Chroma fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style Guardrail fill:#ffebee,stroke:#c62828,stroke-width:2px
    style HITL_Node fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Frontend fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## 📝 Detailed Step-by-Step Explanation

### 1. The Request Phase
- **Auth**: The user sends a request with a JWT. The gateway validates the identity and extracts the **Role** (Basic, Premium, or Admin).
- **Input Guardrail**: Before the agent starts, the input is scanned for "off-topic" content or prompt injection attempts.

### 2. The Reasoning Phase (LangGraph)
- **The Router**: The LLM analyzes the query to decide the path. 
    - If it's a concept $\rightarrow$ **RAG**.
    - If it's a price $\rightarrow$ **Tool**.
    - If it's a mystery $\rightarrow$ **Human**.
- **ACL Filtering**: The RAG node doesn't just search for keywords; it tells ChromaDB: *"Only give me chunks where the `access_level` matches the user's role."*

### 3. The Verification Phase
- **HITL**: If the agent hits the `human_approval` node, the state is saved (checkpointed), and the system stops. A human must verify the request before it proceeds to a web search.
- **Generation**: The AI synthesizes the answer using a "hardened" prompt that prevents the user from overriding system instructions.

### 4. The Compliance Phase
- **Output Guardrail**: The final response is scanned for forbidden phrases (e.g., "guaranteed profit"). If found, the response is blocked to ensure the system remains a "Financial Education" tool and not an "Investment Advisor."
