import argparse
import hashlib
import os
from pathlib import Path
import yaml
from typing import List, Optional
import chromadb
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import (
    CharacterTextSplitter,
    RecursiveCharacterTextSplitter,
    TokenTextSplitter,
)
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VECTOR_COLLECTION_NAME = "langchain"
load_dotenv(PROJECT_ROOT / ".env")

class SplitterFactory:
    @staticmethod
    def get_splitter(config, selected_strategy=None):
        strategy = selected_strategy or config['ingestion']['strategy']
        size = config['ingestion']['chunk_size']
        overlap = config['ingestion']['chunk_overlap']
        
        if strategy == "recursive":
            return RecursiveCharacterTextSplitter(
                chunk_size=size,
                chunk_overlap=overlap,
                separators=config['ingestion'].get('separators', ["\n\n", "\n", " "])
            )
        elif strategy == "fixed":
            return CharacterTextSplitter(
                chunk_size=size,
                chunk_overlap=overlap,
                separator=""
            )
        elif strategy == "semantic":
            from langchain_experimental.text_splitter import SemanticChunker
            from langchain_huggingface import HuggingFaceEmbeddings
            embeddings = HuggingFaceEmbeddings(model_name=config['embeddings']['model'])
            return SemanticChunker(embeddings)
        elif strategy == "token":
            return TokenTextSplitter(
                chunk_size=size,
                chunk_overlap=overlap
            )
        elif strategy == "agentic":
            # Returns a custom AgenticSplitter class implemented below
            return AgenticSplitter(config)
        else:
            raise ValueError(f"Unsupported strategy: {strategy}. Available: recursive, fixed, semantic, token, agentic")

class AgenticSplitter:
    def __init__(self, config):
        self.config = config
        from langchain_ollama import ChatOllama
        self.llm = ChatOllama(
            model=config['llm']['model'],
            temperature=0,
            base_url=config['llm'].get('base_url', 'http://localhost:11434'),
        )

    def split_documents(self, documents):
        from langchain_core.documents import Document
        all_chunks = []
        
        for page_number, doc in enumerate(documents, start=1):
            # The Agentic Process:
            # 1. Send text to LLM to identify logical boundaries
            # 2. LLM returns a list of "propositional" chunks
            print(
                f"  Splitting page {page_number}/{len(documents)} with Ollama...",
                flush=True,
            )
            prompt = f"Split the following financial text into logically independent chunks. Each chunk must be a complete concept. Return only the chunks separated by '---'.\n\nText: {doc.page_content}"
            response = self.llm.invoke(prompt)
            logical_chunks = response.content.split("---")
            print(f"  Finished page {page_number}/{len(documents)}.", flush=True)
            
            for i, chunk_text in enumerate(logical_chunks):
                all_chunks.append(Document(
                    page_content=chunk_text.strip(),
                    metadata={**doc.metadata, "chunk_id": i}
                ))
        return all_chunks

def ingest_docs(selected_strategy=None, file_names: Optional[List[str]] = None):
    with open(PROJECT_ROOT / "config/settings.yaml", "r") as f:
        config = yaml.safe_load(f)

    if selected_strategy is None:
        print("\nAvailable strategies: recursive, fixed, semantic, token, agentic")
        selected_strategy = input("Enter the chunking strategy to use (leave empty for config default): ").strip()
    
    # Load documents from data/source_docs
    doc_folder = PROJECT_ROOT / "data/source_docs"
    if not os.path.exists(doc_folder):
        os.makedirs(doc_folder)
        print(f"Created {doc_folder}. Please add your PDFs/TXTs there.")
        return

    role_mapping = {
        "intro.txt": "Basic",
        "beginner_stock_market_guide.txt": "Basic",
        "Stocks_Trading_For_Beginner_Traders.pdf": "Basic",
        "strategies.txt": "Premium",
        "premium_equity_analysis_guide.txt": "Premium",
        "Currency-Hedging-WP.pdf": "Premium",
        "advanced_hedging.txt": "Admin",
        "admin_market_risk_guide.txt": "Admin",
    }

    available_files = {
        file for file in os.listdir(doc_folder)
        if file.lower().endswith((".pdf", ".txt"))
    }
    if file_names is not None:
        missing_files = set(file_names) - available_files
        if missing_files:
            raise FileNotFoundError(f"Source documents not found: {', '.join(sorted(missing_files))}")
        selected_files = sorted(set(file_names))
    else:
        selected_files = sorted(available_files)

    unclassified = set(selected_files) - role_mapping.keys()
    if unclassified:
        raise ValueError(
            "No access level configured for source documents: "
            f"{', '.join(sorted(unclassified))}. Add each file to role_mapping before ingestion."
        )

    embeddings = HuggingFaceEmbeddings(model_name=config['embeddings']['model'])
    vector_store_path = str(PROJECT_ROOT / "data/vector_store")
    vector_db = Chroma(
        persist_directory=vector_store_path,
        embedding_function=embeddings,
        collection_name=VECTOR_COLLECTION_NAME,
    )
    chroma_client = chromadb.PersistentClient(path=vector_store_path)
    collection = chroma_client.get_collection(name=VECTOR_COLLECTION_NAME)

    for source, role in role_mapping.items():
        existing = collection.get(where={"source": source}, include=["metadatas"])
        if not existing["ids"]:
            continue
        updated_metadata = [
            {**metadata, "access_level": role}
            for metadata in existing["metadatas"]
        ]
        collection.update(ids=existing["ids"], metadatas=updated_metadata)

    splitter = SplitterFactory.get_splitter(config, selected_strategy=selected_strategy or None)
    print(f"Using strategy: {selected_strategy or config['ingestion']['strategy']}")

    all_chunks = []
    chunk_ids = []
    for file in selected_files:
        path = os.path.join(doc_folder, file)
        print(f"Processing {file}...")
        
        if file.endswith(".pdf"):
            loader = PyPDFLoader(path)
        elif file.endswith(".txt"):
            loader = TextLoader(path)
        else:
            continue
            
        docs = loader.load()
        chunks = splitter.split_documents(docs)
        
        role = role_mapping[file]
        existing = collection.get(where={"source": file}, include=["metadatas"])
        if existing["ids"]:
            print(f"Already indexed; ACL set to {role}: {file}")
            continue

        for chunk in chunks:
            chunk.metadata["access_level"] = role
            chunk.metadata["source"] = file
            page = chunk.metadata.get("page", "")
            stable_id = hashlib.sha256(
                f"{file}\0{page}\0{chunk.page_content}".encode("utf-8")
            ).hexdigest()
            chunk_ids.append(stable_id)
            
        all_chunks.extend(chunks)

    if not all_chunks:
        print("No documents found to ingest.")
        return

    vector_db.add_documents(all_chunks, ids=chunk_ids)
    print(f"Ingestion complete. Added {len(all_chunks)} chunks; existing source ACLs refreshed.")


def main():
    parser = argparse.ArgumentParser(description="Ingest source documents into the vector store.")
    parser.add_argument(
        "strategy",
        nargs="?",
        choices=("recursive", "fixed", "semantic", "token", "agentic"),
        help="chunking strategy (omit to choose interactively or use the configured default)",
    )
    parser.add_argument(
        "--files",
        nargs="+",
        help="ingest only these source document filenames while refreshing configured ACLs",
    )
    args = parser.parse_args()
    ingest_docs(args.strategy, args.files)


if __name__ == "__main__":
    main()
