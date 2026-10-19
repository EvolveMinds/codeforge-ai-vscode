/**
 * fde/requirementsDocReader.ts — Document Ingestion & Text Extraction Engine
 * Extracts clean, plain-text requirements from files including Markdown, Text,
 * Word documents (.docx), PDFs (.pdf), JSON, YAML, PlantUML, and Mermaid.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface ExtractedDocResult {
  success: boolean;
  fileName: string;
  format: 'docx' | 'pdf' | 'text' | 'json' | 'yaml' | 'uml' | 'unknown';
  text: string;
  charCount: number;
  wordCount: number;
  error?: string;
}

export class RequirementsDocReader {
  /**
   * Primary entry point: extracts text from a file path or Buffer
   */
  public static async extractText(options: {
    filePath?: string;
    fileBuffer?: Buffer;
    fileName?: string;
  }): Promise<ExtractedDocResult> {
    const fileName = options.fileName || (options.filePath ? path.basename(options.filePath) : 'requirements_doc.txt');
    const ext = path.extname(fileName).toLowerCase();

    let buffer: Buffer;
    if (options.fileBuffer) {
      buffer = options.fileBuffer;
    } else if (options.filePath) {
      if (!fs.existsSync(options.filePath)) {
        return {
          success: false,
          fileName,
          format: 'unknown',
          text: '',
          charCount: 0,
          wordCount: 0,
          error: `File not found: ${options.filePath}`
        };
      }
      buffer = fs.readFileSync(options.filePath);
    } else {
      return {
        success: false,
        fileName,
        format: 'unknown',
        text: '',
        charCount: 0,
        wordCount: 0,
        error: 'No filePath or fileBuffer provided.'
      };
    }

    try {
      if (ext === '.docx') {
        return await this.extractFromDocx(buffer, fileName);
      } else if (ext === '.pdf') {
        return this.extractFromPdf(buffer, fileName);
      } else if (ext === '.puml' || ext === '.plantuml' || ext === '.wsd') {
        const text = buffer.toString('utf8');
        return this.formatResult(text, fileName, 'uml');
      } else if (ext === '.mmd' || ext === '.mermaid') {
        const text = buffer.toString('utf8');
        return this.formatResult(text, fileName, 'uml');
      } else if (ext === '.json') {
        return this.extractFromJson(buffer, fileName);
      } else if (ext === '.yaml' || ext === '.yml') {
        const text = buffer.toString('utf8');
        return this.formatResult(text, fileName, 'yaml');
      } else {
        // Default text-based: .txt, .md, .markdown, .rst, .csv, .tsv, etc.
        const text = buffer.toString('utf8');
        return this.formatResult(text, fileName, 'text');
      }
    } catch (err: any) {
      return {
        success: false,
        fileName,
        format: 'unknown',
        text: '',
        charCount: 0,
        wordCount: 0,
        error: err?.message || String(err)
      };
    }
  }

  /**
   * Extract formatted text from a Word .docx file using JSZip
   */
  private static async extractFromDocx(buffer: Buffer, fileName: string): Promise<ExtractedDocResult> {
    try {
      // Lazy load JSZip
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const documentXmlFile = zip.file('word/document.xml');

      if (!documentXmlFile) {
        return {
          success: false,
          fileName,
          format: 'docx',
          text: '',
          charCount: 0,
          wordCount: 0,
          error: 'Invalid .docx file: word/document.xml missing'
        };
      }

      const xml = await documentXmlFile.async('text');

      // Convert Word paragraph elements (<w:p>) to newlines and extract text
      const cleanText = xml
        .replace(/<w:p[^>]*>/gi, '\n')
        .replace(/<w:br[^>]*>/gi, '\n')
        .replace(/<w:tab[^>]*>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return this.formatResult(cleanText, fileName, 'docx');
    } catch (err: any) {
      return {
        success: false,
        fileName,
        format: 'docx',
        text: '',
        charCount: 0,
        wordCount: 0,
        error: `Failed to extract DOCX text: ${err?.message || err}`
      };
    }
  }

  /**
   * Extract text blocks and streams from a PDF file
   */
  private static extractFromPdf(buffer: Buffer, fileName: string): ExtractedDocResult {
    try {
      const content = buffer.toString('latin1');
      const textParts: string[] = [];

      // Scan PDF streams
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let match: RegExpExecArray | null;

      while ((match = streamRegex.exec(content)) !== null) {
        const rawStream = Buffer.from(match[1], 'latin1');
        let uncompressed: Buffer;

        try {
          uncompressed = zlib.inflateSync(rawStream);
        } catch {
          // If not compressed with FlateDecode, use as is
          uncompressed = rawStream;
        }

        const streamStr = uncompressed.toString('latin1');

        // Extract PDF literal text strings in parentheses: (Some text) Tj or [(Some) -20 (text)] TJ
        const textLiteralRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
        let tMatch: RegExpExecArray | null;
        let streamLine = '';

        while ((tMatch = textLiteralRegex.exec(streamStr)) !== null) {
          const rawChunk = tMatch[1];
          // Unescape octal and standard PDF escapes
          const cleanedChunk = rawChunk
            .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
            .replace(/\\([nrtbf\\()])/g, (_, esc) => {
              switch (esc) {
                case 'n': return '\n';
                case 'r': return '\r';
                case 't': return '\t';
                case 'b': return '\b';
                case 'f': return '\f';
                default: return esc;
              }
            });

          streamLine += cleanedChunk + ' ';
        }

        // Also check for TJ array format: [ (Text) 120 (more text) ] TJ
        const arrayRegex = /\[((?:(?:\([^)]+\)|[0-9.-]+)\s*)+)\]\s*TJ/g;
        let arrMatch: RegExpExecArray | null;
        while ((arrMatch = arrayRegex.exec(streamStr)) !== null) {
          const inner = arrMatch[1];
          const chunks = inner.match(/\(([^)]+)\)/g);
          if (chunks) {
            for (const c of chunks) {
              streamLine += c.slice(1, -1) + ' ';
            }
          }
        }

        if (streamLine.trim()) {
          textParts.push(streamLine.trim());
        }
      }

      let extractedText = textParts.join('\n\n').trim();

      // If PDF text extraction yielded very little (e.g. non-standard stream encoding), fallback to readable ASCII strings
      if (extractedText.length < 50) {
        const asciiMatches = content.match(/[\x20-\x7E]{4,}/g) || [];
        const filtered = asciiMatches.filter(s => 
          !s.startsWith('%PDF') && 
          !s.startsWith('/Filter') && 
          !s.startsWith('/Length') && 
          !s.includes('endobj') && 
          !s.includes('xref')
        );
        if (filtered.length > 5) {
          extractedText = filtered.join(' ');
        }
      }

      return this.formatResult(extractedText, fileName, 'pdf');
    } catch (err: any) {
      return {
        success: false,
        fileName,
        format: 'pdf',
        text: '',
        charCount: 0,
        wordCount: 0,
        error: `Failed to extract PDF text: ${err?.message || err}`
      };
    }
  }

  /**
   * Extract formatted text from JSON requirements / user stories
   */
  private static extractFromJson(buffer: Buffer, fileName: string): ExtractedDocResult {
    try {
      const raw = buffer.toString('utf8');
      const parsed = JSON.parse(raw);
      let text = '';

      if (typeof parsed === 'string') {
        text = parsed;
      } else if (Array.isArray(parsed)) {
        text = parsed.map((item, idx) => {
          if (typeof item === 'string') return `${idx + 1}. ${item}`;
          return `${idx + 1}. ${JSON.stringify(item, null, 2)}`;
        }).join('\n');
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Check for common keys like requirements, userStories, architecture, steps, flows
        const keys = Object.keys(parsed);
        const sections: string[] = [];
        for (const k of keys) {
          const v = parsed[k];
          if (typeof v === 'string') {
            sections.push(`## ${k}\n${v}`);
          } else if (Array.isArray(v)) {
            sections.push(`## ${k}\n` + v.map((item, idx) => `${idx + 1}. ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
          } else {
            sections.push(`## ${k}\n${JSON.stringify(v, null, 2)}`);
          }
        }
        text = sections.join('\n\n');
      } else {
        text = raw;
      }

      return this.formatResult(text, fileName, 'json');
    } catch {
      // Fall back to raw text if JSON parsing fails
      return this.formatResult(buffer.toString('utf8'), fileName, 'text');
    }
  }

  private static formatResult(
    text: string,
    fileName: string,
    format: ExtractedDocResult['format']
  ): ExtractedDocResult {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    return {
      success: trimmed.length > 0,
      fileName,
      format,
      text: trimmed,
      charCount: trimmed.length,
      wordCount: words,
      error: trimmed.length === 0 ? 'Document appears empty or contains no readable text.' : undefined
    };
  }
}
