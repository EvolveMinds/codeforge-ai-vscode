/**
 * src/enterprise/rag/ragTypes.ts
 *
 * Data contracts and configuration types for the Enterprise Air-Gapped RAG & Vector Pipeline Scaffolder.
 * Built for Evolve AI Enterprise Edition.
 */

export type VectorStoreProvider = 'pgvector' | 'qdrant' | 'chroma' | 'faiss';

export type EmbeddingProvider = 'ollama_local' | 'tei_huggingface' | 'vllm' | 'azure_openai' | 'bedrock' | 'vertex';

export type ChunkingStrategy = 'recursive_character' | 'markdown_header' | 'code_ast' | 'token_sliding_window';

export type RagLanguage = 'python' | 'typescript';

export type DistanceMetric = 'cosine' | 'l2' | 'dot';

export type RagArchitectureType = 
  | 'naive' 
  | 'multimodal' 
  | 'hyde' 
  | 'corrective' 
  | 'graph' 
  | 'hybrid' 
  | 'adaptive' 
  | 'agentic';

export interface RagPipelineOptions {
  /** Target service or domain name (e.g. "CustomerSupportRAG", "DocIntel") */
  serviceName: string;
  /** Primary programming language for the scaffolded pipeline */
  language: RagLanguage;
  /** Canonical RAG architecture paradigm (defaults to 'hybrid' if enableHybridSearch is true, else 'naive') */
  architecture?: RagArchitectureType;
  /** Vector database engine */
  vectorStore: VectorStoreProvider;
  /** Embedding model provider */
  embeddingProvider: EmbeddingProvider;
  /** Embedding model name (e.g. "nomic-embed-text", "bge-large-en-v1.5", "text-embedding-3-small") */
  embeddingModel: string;
  /** Embedding dimension size (e.g. 768, 1024, 1536) */
  embeddingDimensions: number;
  /** Chunk size in tokens or characters */
  chunkSize: number;
  /** Chunk overlap */
  chunkOverlap: number;
  /** Chunking strategy */
  chunkingStrategy: ChunkingStrategy;
  /** Similarity distance metric */
  distanceMetric: DistanceMetric;
  /** Top-K results to retrieve */
  topK: number;
  /** Minimum similarity score threshold (0.0 to 1.0) */
  similarityThreshold: number;
  /** Enable BM25 keyword hybrid search with Reciprocal Rank Fusion */
  enableHybridSearch: boolean;
  /** Enable prompt injection and PII sanitization filters */
  enableGuardrails: boolean;
  /** Collection or table name */
  collectionName?: string;
  /** Database connection string or host URL */
  databaseUri?: string;
  /** Architecture Specific: Sparse engine for Hybrid RAG */
  sparseEngine?: 'bm25' | 'sqlite_fts5' | 'splade';
  /** Architecture Specific: Graph database engine for Graph RAG */
  graphEngine?: 'neo4j' | 'kuzu' | 'networkx';
  /** Architecture Specific: Evaluator confidence threshold for Corrective RAG (CRAG) */
  evaluatorThreshold?: number;
  /** Architecture Specific: External fallback search provider for CRAG */
  fallbackSearchProvider?: 'tavily' | 'bing' | 'internal_web';
  /** Architecture Specific: Drafting model name for HyDE */
  hypotheticalModel?: string;
  /** Architecture Specific: Query router strategy for Adaptive RAG */
  routerStrategy?: 'heuristic' | 'semantic' | 'llm_classifier';
  /** Architecture Specific: Tool registry for Agentic RAG */
  agentTools?: string[];
  /** Architecture Specific: Maximum iteration step budget for Agentic RAG */
  maxAgentSteps?: number;
}

export interface ScaffoldedRagFiles {
  chunkerCode: string;
  chunkerPath: string;
  vectorStoreCode: string;
  vectorStorePath: string;
  embeddingsCode: string;
  embeddingsPath: string;
  retrieverPipelineCode: string;
  retrieverPipelinePath: string;
  dockerComposeYaml: string;
  dockerComposePath: string;
  testScriptCode: string;
  testScriptPath: string;
  readmeDoc: string;
  readmePath: string;
}
