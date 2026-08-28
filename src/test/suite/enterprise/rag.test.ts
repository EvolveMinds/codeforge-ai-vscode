/**
 * src/test/suite/enterprise/rag.test.ts
 *
 * Automated Unit Tests for Enterprise Air-Gapped RAG & Vector Pipeline Scaffolder.
 * Built by Evolve Mind Solutions (Evolve AI Enterprise Edition).
 */

import * as assert from 'assert';
import { RagPipelineScaffolder } from '../../../enterprise/rag/ragPipelineScaffolder';
import { RagPipelineOptions } from '../../../enterprise/rag/ragTypes';

suite('Enterprise Suite — Air-Gapped RAG & Vector Pipeline Scaffolder', () => {

  test('generates full-stack Python + pgvector air-gapped RAG pipeline', () => {
    const options: RagPipelineOptions = {
      serviceName: 'ClientIntelApi',
      language: 'python',
      vectorStore: 'pgvector',
      embeddingProvider: 'ollama_local',
      embeddingModel: 'nomic-embed-text',
      embeddingDimensions: 768,
      chunkSize: 512,
      chunkOverlap: 64,
      chunkingStrategy: 'recursive_character',
      distanceMetric: 'cosine',
      topK: 5,
      similarityThreshold: 0.75,
      enableHybridSearch: true,
      enableGuardrails: true,
      collectionName: 'client_intel_embeddings'
    };

    const files = RagPipelineScaffolder.scaffold(options);

    // 1. Chunker
    assert.strictEqual(files.chunkerPath, 'src/rag/chunker.py');
    assert.ok(files.chunkerCode.includes('class DocumentChunker'));
    assert.ok(files.chunkerCode.includes('chunk_size: int = 512'));
    assert.ok(files.chunkerCode.includes('chunk_overlap: int = 64'));

    // 2. Embeddings
    assert.strictEqual(files.embeddingsPath, 'src/rag/embeddings.py');
    assert.ok(files.embeddingsCode.includes('AirGappedEmbeddingClient'));
    assert.ok(files.embeddingsCode.includes('nomic-embed-text'));
    assert.ok(files.embeddingsCode.includes('/api/embed'));
    assert.ok(files.embeddingsCode.includes('http://localhost:11434'));

    // 3. PgVector Store with HNSW Index
    assert.strictEqual(files.vectorStorePath, 'src/rag/vector_store.py');
    assert.ok(files.vectorStoreCode.includes('CREATE EXTENSION IF NOT EXISTS vector;'));
    assert.ok(files.vectorStoreCode.includes('USING hnsw (embedding vector_cosine_ops)'));
    assert.ok(files.vectorStoreCode.includes('client_intel_embeddings'));
    assert.ok(files.vectorStoreCode.includes('embedding vector('));
    assert.ok(files.vectorStoreCode.includes('dimensions: int = 768'));

    // 4. Pipeline with Guardrails & Citations
    assert.strictEqual(files.retrieverPipelinePath, 'src/rag/rag_pipeline.py');
    assert.ok(files.retrieverPipelineCode.includes('EnterpriseRagPipeline'));
    assert.ok(files.retrieverPipelineCode.includes('_detect_prompt_injection'));
    assert.ok(files.retrieverPipelineCode.includes('[Source'));

    // 5. Docker Compose & Tests
    assert.strictEqual(files.dockerComposePath, 'docker-compose.rag.yml');
    assert.ok(files.dockerComposeYaml.includes('pgvector/pgvector:pg16'));
    assert.ok(files.dockerComposeYaml.includes('ollama/ollama:latest'));

    assert.strictEqual(files.testScriptPath, 'tests/test_rag_pipeline.py');
    assert.ok(files.testScriptCode.includes('TestEnterpriseRagPipeline'));
  });

  test('generates full-stack TypeScript + Qdrant RAG pipeline', () => {
    const options: RagPipelineOptions = {
      serviceName: 'ComplianceSearch',
      language: 'typescript',
      vectorStore: 'qdrant',
      embeddingProvider: 'ollama_local',
      embeddingModel: 'bge-large-en-v1.5',
      embeddingDimensions: 1024,
      chunkSize: 800,
      chunkOverlap: 100,
      chunkingStrategy: 'recursive_character',
      distanceMetric: 'cosine',
      topK: 3,
      similarityThreshold: 0.80,
      enableHybridSearch: false,
      enableGuardrails: true
    };

    const files = RagPipelineScaffolder.scaffold(options);

    assert.strictEqual(files.chunkerPath, 'src/rag/chunker.ts');
    assert.strictEqual(files.vectorStorePath, 'src/rag/vector_store.ts');
    assert.strictEqual(files.retrieverPipelinePath, 'src/rag/rag_pipeline.ts');
    assert.ok(files.retrieverPipelineCode.includes('EnterpriseRagPipeline'));
    assert.ok(files.retrieverPipelineCode.includes('detectInjection'));
    assert.ok(files.dockerComposeYaml.includes('qdrant/qdrant:latest'));
  });

});
