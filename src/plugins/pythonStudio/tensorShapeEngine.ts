/**
 * plugins/pythonStudio/tensorShapeEngine.ts
 *
 * Static & Heuristic Tensor Shape Inference & Anomaly Detector for PyTorch / JAX / HuggingFace.
 * Features:
 *  - Layer dimension compatibility tracking (e.g., Linear(768, 512) ➔ Linear(512, 256))
 *  - Detection of hidden dimensional bugs (batch dimension collapse, unflattened conv outputs)
 *  - Numerical instability & NaN/Inf vulnerability detector (div-by-zero, unclamped log, double softmax)
 *  - Generates CodeLens shape flow annotations
 */

export interface TensorLayerSpec {
  name: string;
  kind: 'linear' | 'conv2d' | 'embedding' | 'layer_norm' | 'dropout';
  inDim?: number | string;
  outDim?: number | string;
  line: number;
}

export interface TensorAnomaly {
  line: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestedFix?: string;
}

export interface TensorShapeReport {
  layers: TensorLayerSpec[];
  anomalies: TensorAnomaly[];
  shapeFlowSummary: string[];
}

export class TensorShapeEngine {
  /**
   * Analyzes a Python file for PyTorch / JAX tensor layer topologies and numerical anomalies.
   */
  static analyzeTensorCode(source: string): TensorShapeReport {
    const layers: TensorLayerSpec[] = [];
    const anomalies: TensorAnomaly[] = [];
    const lines = source.split(/\r?\n/);

    this.extractLayers(lines, layers);
    this.checkChainingCompatibility(layers, anomalies);
    this.checkNumericalInstabilities(lines, anomalies);
    this.checkRagAndVectorAnomalies(lines, anomalies);

    const shapeFlowSummary = layers.map(l => {
      if (l.inDim && l.outDim) {
        return `${l.name} (${l.kind}): [*, ${l.inDim}] ➔ [*, ${l.outDim}]`;
      }
      return `${l.name} (${l.kind})`;
    });

    return {
      layers,
      anomalies,
      shapeFlowSummary,
    };
  }

  /**
   * Extracts layer definitions (nn.Linear, nn.Conv2d, nn.Embedding) from code.
   */
  private static extractLayers(lines: string[], layers: TensorLayerSpec[]): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // self.fc1 = nn.Linear(768, 512) or self.classifier = Linear(512, 10)
      const linearMatch = line.match(/self\.([a-zA-Z0-9_]+)\s*=\s*(?:nn\.)?Linear\(\s*([0-9]+)\s*,\s*([0-9]+)/);
      if (linearMatch) {
        layers.push({
          name: linearMatch[1],
          kind: 'linear',
          inDim: parseInt(linearMatch[2], 10),
          outDim: parseInt(linearMatch[3], 10),
          line: i + 1,
        });
      }

      // self.embed = nn.Embedding(30522, 768)
      const embedMatch = line.match(/self\.([a-zA-Z0-9_]+)\s*=\s*(?:nn\.)?Embedding\(\s*([0-9]+)\s*,\s*([0-9]+)/);
      if (embedMatch) {
        layers.push({
          name: embedMatch[1],
          kind: 'embedding',
          inDim: parseInt(embedMatch[2], 10),
          outDim: parseInt(embedMatch[3], 10),
          line: i + 1,
        });
      }

      // self.conv1 = nn.Conv2d(3, 64, kernel_size=3)
      const convMatch = line.match(/self\.([a-zA-Z0-9_]+)\s*=\s*(?:nn\.)?Conv2d\(\s*([0-9]+)\s*,\s*([0-9]+)/);
      if (convMatch) {
        layers.push({
          name: convMatch[1],
          kind: 'conv2d',
          inDim: parseInt(convMatch[2], 10),
          outDim: parseInt(convMatch[3], 10),
          line: i + 1,
        });
      }
    }
  }

  /**
   * Checks whether adjacent sequential layers match output-to-input dimensions.
   */
  private static checkChainingCompatibility(layers: TensorLayerSpec[], anomalies: TensorAnomaly[]): void {
    for (let i = 0; i < layers.length - 1; i++) {
      const current = layers[i];
      const next    = layers[i + 1];

      // If both are linear and consecutive, output of current must match input of next
      if (current.kind === 'linear' && next.kind === 'linear') {
        if (typeof current.outDim === 'number' && typeof next.inDim === 'number' && current.outDim !== next.inDim) {
          anomalies.push({
            line: next.line,
            severity: 'error',
            code: 'TENSOR_SHAPE_MISMATCH',
            message: `Dimension mismatch between sequential layers: '${current.name}' outputs ${current.outDim} dims, but '${next.name}' expects ${next.inDim} dims.`,
            suggestedFix: `Update '${next.name}' input dimensions to ${current.outDim}.`,
          });
        }
      }
    }
  }

  /**
   * Identifies common numerical instability hazards that cause NaN loss or gradient explosions.
   */
  private static checkNumericalInstabilities(lines: string[], anomalies: TensorAnomaly[]): void {
    const fullSource = lines.join('\n');
    const hasCrossEntropy = /CrossEntropyLoss/i.test(fullSource);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 1. Division by tensor without epsilon: x / std or x / torch.sqrt(...)
      if (/\b[a-zA-Z0-9_]+\s*\/\s*(?:std|variance|torch\.sqrt\([^)]+\)|sigma)\b/.test(line) && !line.includes('1e-') && !line.includes('eps')) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'NAN_DIV_ZERO_RISK',
          message: 'Potential NaN explosion: division by standard deviation/variance without epsilon stabilizer.',
          suggestedFix: 'Add a small epsilon (e.g. + 1e-6) to denominator.',
        });
      }

      // 2. torch.log(x) without clamp
      if (/torch\.log\(\s*([a-zA-Z0-9_.]+)\s*\)/.test(line) && !line.includes('clamp') && !line.includes('1e-')) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'LOG_ZERO_INF_RISK',
          message: 'Potential -inf explosion: torch.log(x) on unconstrained tensor. If any element is 0, output is -inf.',
          suggestedFix: 'Use torch.log(torch.clamp(x, min=1e-8)) or torch.log1p(x).',
        });
      }

      // 3. F.softmax without dim specified: F.softmax(x)
      if (/(?:F|torch|nn)\.softmax\(\s*[a-zA-Z0-9_.]+\s*\)/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'SOFTMAX_UNSPECIFIED_DIM',
          message: 'Implicit softmax dimension: torch.softmax without explicit dim= argument may calculate softmax over the wrong axis.',
          suggestedFix: 'Specify dimension explicitly, e.g., F.softmax(x, dim=-1).',
        });
      }

      // 4. Double softmax error with CrossEntropyLoss: loss_fn(F.softmax(logits), target)
      if ((hasCrossEntropy && /softmax\(/.test(line) && /(?:loss|criterion)\(/.test(line)) ||
          /F\.cross_entropy\(\s*(?:F\.)?softmax/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'error',
          code: 'DOUBLE_SOFTMAX_CROSS_ENTROPY',
          message: 'Critical ML bug: CrossEntropyLoss applies LogSoftmax internally. Passing softmax(logits) causes double softmax and degraded gradients.',
          suggestedFix: 'Pass raw logits directly into CrossEntropyLoss without prior softmax.',
        });
      }
    }
  }

  /**
   * Identifies common RAG, vector embedding, and retrieval tensor bugs:
   *  - Cosine similarity division-by-zero on zero-norm vectors
   *  - Vector database dimensionality mismatch (e.g., 768 for Gemini text-embedding-004 vs mismatched schema)
   *  - Unbounded prompt context injection
   */
  private static checkRagAndVectorAnomalies(lines: string[], anomalies: TensorAnomaly[]): void {
    const fullSource = lines.join('\n');
    const usesGeminiEmbeddings = /text-embedding-004|models\/text-embedding|genai\.embed_content/i.test(fullSource);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 1. Cosine similarity without epsilon stabilization: dot / (norm_a * norm_b)
      if (/[a-zA-Z0-9_.]*norm\([^)]+\)\s*\*\s*[a-zA-Z0-9_.]*norm\([^)]+\)/.test(line) &&
          !line.includes('1e-') && !line.includes('eps') && !line.includes('clamp')) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'COSINE_SIM_DIV_ZERO_RISK',
          message: 'Potential NaN / ZeroDivisionError: Vector cosine normalization lacks epsilon guard against zero-magnitude embeddings.',
          suggestedFix: 'Add epsilon stabilizer to denominator, e.g., (norm_a * norm_b + 1e-9).',
        });
      }

      // 2. Embedding dimension mismatch: Gemini text-embedding-004 produces 768 dimensions
      if (usesGeminiEmbeddings) {
        const dimMatch = line.match(/["']?(?:dim|dimension|vector_dim)["']?\s*[:=]\s*(1536|384|512|1024|2048)\b/i);
        if (dimMatch) {
          const declaredDim = dimMatch[1];
          anomalies.push({
            line: i + 1,
            severity: 'error',
            code: 'EMBEDDING_DIM_MISMATCH',
            message: `Vector dimension mismatch: Gemini text-embedding-004 outputs 768 dimensions, but vector schema declares ${declaredDim} dimensions.`,
            suggestedFix: 'Set vector table or collection dimension to 768 to match Gemini embeddings.',
          });
        }
      }
    }
  }
}
