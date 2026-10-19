/**
 * mcp/reaBridge.ts — Native REA (Reverse Engineer Anything) MCP Bridge
 *
 * Implements the Model Context Protocol (MCP) tool suite connecting Evolve AI's
 * Forward Deployed Engineer (FDE) and AI chat interfaces to REA capabilities.
 *
 * Enforces the Compact Schema Profile (< 12 KB per tool) to prevent context
 * rejection on Gemini, Moonshot, and Anthropic Claude.
 *
 * Exposes:
 *  1. `rea_analyze_binary`: Disassembles .NET, JVM, WASM, and Electron binaries.
 *  2. `rea_introspect_application`: Recovers databases, tables, APIs, and IPC.
 *  3. `rea_generate_dbt_models`: Auto-generates dbt staging SQL and sources.yml.
 *  4. `rea_verify_evidence`: Audits cryptographic evidence ledger and unknowns.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CompactSchemaProfile, McpToolDefinition } from './compactSchema';
import { BinaryIngestionEngine } from '../core/binaryIngest';
import { AppIntrospector } from '../fde/appIntrospector';
import { EvidenceLedger } from '../fde/provenance';

export class ReaMcpBridge {
  private static readonly RAW_TOOLS: McpToolDefinition[] = [
    {
      name: 'rea_analyze_binary',
      description: 'Disassembles compiled binaries (.dll, .exe, .class, .wasm, .asar) into structured source declarations with verifiable evidence proof.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute or relative path to the compiled binary artifact'
          },
          extractAllModules: {
            type: 'boolean',
            description: 'Whether to extract all disassembled virtual source files'
          }
        },
        required: ['filePath']
      }
    },
    {
      name: 'rea_introspect_application',
      description: 'Scans client application bundles or directories, extracting database connections, tables, API endpoints, and IPC messaging channels.',
      inputSchema: {
        type: 'object',
        properties: {
          targetPath: {
            type: 'string',
            description: 'Root folder, ASAR package, or bundle file to introspect'
          },
          appName: {
            type: 'string',
            description: 'Human-readable name of the client application'
          },
          sourceName: {
            type: 'string',
            description: 'Target dbt source name prefix (defaults to client_raw)'
          }
        },
        required: ['targetPath']
      }
    },
    {
      name: 'rea_generate_dbt_models',
      description: 'Auto-generates production dbt staging models (stg_<source>__<table>.sql) and sources.yml from discovered table shapes.',
      inputSchema: {
        type: 'object',
        properties: {
          tables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                columns: { type: 'array', items: { type: 'string' } }
              },
              required: ['name']
            },
            description: 'Array of table definitions with name and column lists'
          },
          sourceName: {
            type: 'string',
            description: 'Database source identifier for dbt models'
          }
        },
        required: ['tables']
      }
    },
    {
      name: 'rea_verify_evidence',
      description: 'Audits the Zero-Hallucination Evidence Ledger, validating cryptographic proofs and cataloging unresolved unknowns.',
      inputSchema: {
        type: 'object',
        properties: {
          filterSeverity: {
            type: 'string',
            enum: ['all', 'blocking', 'warning'],
            description: 'Filter level for reporting unresolved unknowns'
          }
        }
      }
    }
  ];

  /**
   * Returns all REA tools formatted and compressed to strictly conform
   * to the sub-13KB Compact Schema Profile.
   */
  public static getTools(): McpToolDefinition[] {
    return this.RAW_TOOLS.map(t => CompactSchemaProfile.compressTool(t));
  }

  /**
   * Dispatches an incoming MCP tool invocation to the corresponding REA engine.
   */
  public static async handleToolCall(
    name: string,
    args: Record<string, any> = {},
    ledger: EvidenceLedger = new EvidenceLedger()
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      switch (name) {
        case 'rea_analyze_binary': {
          const filePath = String(args.filePath || '');
          if (!fs.existsSync(filePath)) {
            return {
              content: [{ type: 'text', text: `Error: Specified binary file not found: ${filePath}` }],
              isError: true
            };
          }

          const { files, metadata } = await BinaryIngestionEngine.ingestArtifact(filePath, ledger);
          const response = {
            status: 'SUCCESS',
            artifact: path.basename(filePath),
            architecture: metadata.architecture,
            type: metadata.type,
            symbolsRecovered: metadata.symbolsCount,
            extractedModules: metadata.extractedModules.slice(0, 50),
            disassemblySummary: metadata.disassemblySummary,
            filesExtractedCount: files.length,
            sampleCodePreview: files[0]?.content.slice(0, 1000) || ''
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
          };
        }

        case 'rea_introspect_application': {
          const targetPath = String(args.targetPath || '');
          if (!fs.existsSync(targetPath)) {
            return {
              content: [{ type: 'text', text: `Error: Target path does not exist: ${targetPath}` }],
              isError: true
            };
          }

          const result = await AppIntrospector.introspect({
            targetPath,
            appName: args.appName,
            sourceName: args.sourceName,
            ledger
          });

          const response = {
            status: 'SUCCESS',
            appName: result.appName,
            scannedFilesCount: result.scannedFilesCount,
            discoveredDatabasesCount: result.connections.length,
            discoveredTablesCount: result.tables.length,
            discoveredRoutesCount: result.routes.length,
            discoveredIpcChannelsCount: result.ipcChannels.length,
            generatedDbtModelsCount: result.dbtModels.length,
            tables: result.tables.map(t => ({ name: t.name, columnsCount: t.columns.length, ops: t.operations })),
            routes: result.routes.slice(0, 20).map(r => `[${r.method}] ${r.path}`),
            connections: result.connections.map(c => ({ dialect: c.dialect, uri: c.sanitizedUri })),
            architectureBlueprintPreview: result.architectureBlueprint.slice(0, 1500)
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
          };
        }

        case 'rea_generate_dbt_models': {
          const tables = Array.isArray(args.tables) ? args.tables : [];
          const sourceName = String(args.sourceName || 'client_raw');

          const formattedTables = tables.map((t: any) => ({
            name: String(t.name || 'table'),
            sourceFile: 'mcp_input',
            columns: Array.isArray(t.columns) ? t.columns : ['id', 'created_at'],
            operations: ['SELECT' as const]
          }));

          const { dbtModels, dbtSourcesYaml } = AppIntrospector.generateDbtAssets(formattedTables, sourceName);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'SUCCESS',
                generatedModelsCount: dbtModels.length,
                models: dbtModels.map(m => ({ path: m.filePath, sql: m.sqlContent })),
                sourcesYaml: dbtSourcesYaml
              }, null, 2)
            }]
          };
        }

        case 'rea_verify_evidence': {
          const manifest = ledger.exportManifest();
          const filter = args.filterSeverity || 'all';

          let unknowns = manifest.unknowns;
          if (filter === 'blocking') {
            unknowns = unknowns.filter(u => u.severity === 'blocking');
          } else if (filter === 'warning') {
            unknowns = unknowns.filter(u => u.severity === 'warning');
          }

          const response = {
            status: 'SUCCESS',
            auditDigest: manifest.digest,
            verifiedRecordsCount: manifest.recordsCount,
            unknownsCount: unknowns.length,
            blockingUnknownsCount: manifest.blockingUnknownsCount,
            isZeroHallucinationProven: manifest.blockingUnknownsCount === 0,
            evidenceSummary: manifest.evidence.slice(0, 20).map(e => `[${e.kind}] (${e.confidence}) ${e.summary}`),
            unknowns: unknowns.map(u => ({ target: u.target, severity: u.severity, remediation: u.remediation }))
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown REA tool '${name}'` }],
            isError: true
          };
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error executing REA tool '${name}': ${err?.message || String(err)}` }],
        isError: true
      };
    }
  }
}
