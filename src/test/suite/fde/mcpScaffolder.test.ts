import * as assert from 'assert';
import { McpScaffolder } from '../../../fde/mcpScaffolder';

suite('FDE Suite — McpScaffolder', () => {
  test('scaffolds complete TypeScript stdio MCP package with all enterprise manifests', () => {
    const res = McpScaffolder.scaffold({
      language: 'typescript',
      transport: 'stdio',
      appName: 'acme-enterprise-mcp',
      appVersion: '1.2.0',
      tools: {
        dbSchema: true,
        safeSql: true,
        vectorSearch: true,
        restGateway: true,
        piiMask: true,
        fileReader: true
      },
      includeClaudeConfig: true,
      includeDocker: true,
      includeAuditLogging: true
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.language, 'typescript');
    assert.strictEqual(res.transport, 'stdio');
    assert.strictEqual(res.filePath, 'src/mcp/server.ts');

    const filePaths = res.filesWritten.map(f => f.path);
    assert.ok(filePaths.includes('src/mcp/server.ts'));
    assert.ok(filePaths.includes('src/mcp/tools.ts'));
    assert.ok(filePaths.includes('src/mcp/security.ts'));
    assert.ok(filePaths.includes('src/mcp/package.json'));
    assert.ok(filePaths.includes('src/mcp/claude_desktop_config.json'));
    assert.ok(filePaths.includes('src/mcp/Dockerfile.mcp'));
    assert.ok(filePaths.includes('src/mcp/docker-compose.mcp.yml'));
    assert.ok(filePaths.includes('src/mcp/README.md'));

    // Server contents
    const serverFile = res.filesWritten.find(f => f.path === 'src/mcp/server.ts');
    assert.ok(serverFile?.content.includes('@modelcontextprotocol/sdk/server/stdio.js'));
    assert.ok(serverFile?.content.includes('acme-enterprise-mcp'));

    // Tools contents
    const toolsFile = res.filesWritten.find(f => f.path === 'src/mcp/tools.ts');
    assert.ok(toolsFile?.content.includes('introspect_schema'));
    assert.ok(toolsFile?.content.includes('execute_safe_sql'));
    assert.ok(toolsFile?.content.includes('vector_search'));
    assert.ok(toolsFile?.content.includes('call_enterprise_api'));
    assert.ok(toolsFile?.content.includes('mask_sensitive_payload'));
    assert.ok(toolsFile?.content.includes('read_workspace_document'));

    // Security contents
    const secFile = res.filesWritten.find(f => f.path === 'src/mcp/security.ts');
    assert.ok(secFile?.content.includes('validateSafeSqlQuery'));
    assert.ok(secFile?.content.includes('maskPii'));
    assert.ok(secFile?.content.includes('auditLogToolCall'));
  });

  test('scaffolds TypeScript SSE microservice with Express transport on custom port', () => {
    const res = McpScaffolder.scaffold({
      language: 'typescript',
      transport: 'sse',
      port: 9090,
      appName: 'cloud-mcp-service'
    });

    assert.strictEqual(res.transport, 'sse');
    const serverFile = res.filesWritten.find(f => f.path === 'src/mcp/server.ts');
    assert.ok(serverFile?.content.includes('@modelcontextprotocol/sdk/server/sse.js'));
    assert.ok(serverFile?.content.includes("app.get('/sse'"));
    assert.ok(serverFile?.content.includes("app.post('/messages'"));
    assert.ok(serverFile?.content.includes("app.get('/health'"));
    assert.ok(serverFile?.content.includes('9090'));

    const pkgFile = res.filesWritten.find(f => f.path === 'src/mcp/package.json');
    assert.ok(pkgFile?.content.includes('"express"'));
    assert.ok(pkgFile?.content.includes('"cors"'));
  });

  test('scaffolds Python FastMCP server with Pydantic v2 schemas and requirements.txt', () => {
    const res = McpScaffolder.scaffold({
      language: 'python',
      transport: 'stdio',
      appName: 'py-agent-mcp'
    });

    assert.strictEqual(res.language, 'python');
    assert.strictEqual(res.filePath, 'src/mcp/server.py');

    const filePaths = res.filesWritten.map(f => f.path);
    assert.ok(filePaths.includes('src/mcp/server.py'));
    assert.ok(filePaths.includes('src/mcp/tools.py'));
    assert.ok(filePaths.includes('src/mcp/security.py'));
    assert.ok(filePaths.includes('src/mcp/requirements.txt'));

    const serverFile = res.filesWritten.find(f => f.path === 'src/mcp/server.py');
    assert.ok(serverFile?.content.includes('from mcp.server.fastmcp import FastMCP'));
    assert.ok(serverFile?.content.includes('register_enterprise_tools(mcp)'));

    const toolsFile = res.filesWritten.find(f => f.path === 'src/mcp/tools.py');
    assert.ok(toolsFile?.content.includes('@mcp.tool()'));
    assert.ok(toolsFile?.content.includes('def introspect_schema'));
    assert.ok(toolsFile?.content.includes('def execute_safe_sql'));

    const reqsFile = res.filesWritten.find(f => f.path === 'src/mcp/requirements.txt');
    assert.ok(reqsFile?.content.includes('mcp[cli]>=1.0.0'));
    assert.ok(reqsFile?.content.includes('pydantic>=2.0.0'));
  });

  test('dynamically binds introspected database tables to MCP tools catalog', () => {
    const customTables = [
      {
        tableName: 'insurance_claims',
        schema: 'claims_db',
        columns: [
          { name: 'claim_id', type: 'UUID', isPrimary: true },
          { name: 'policy_holder', type: 'VARCHAR(128)' },
          { name: 'payout_amount', type: 'NUMERIC(12,2)' }
        ]
      }
    ];

    const res = McpScaffolder.scaffold({
      language: 'typescript',
      transport: 'stdio',
      tables: customTables
    });

    const toolsFile = res.filesWritten.find(f => f.path === 'src/mcp/tools.ts');
    assert.ok(toolsFile?.content.includes('insurance_claims'));
    assert.ok(toolsFile?.content.includes('claim_id'));
    assert.ok(toolsFile?.content.includes('payout_amount'));
  });

  test('generates Claude Desktop configuration JSON matching official schema', () => {
    const configStr = McpScaffolder.generateClaudeConfig(
      {
        language: 'typescript',
        transport: 'stdio',
        port: 8080,
        tools: { dbSchema: true, safeSql: true, vectorSearch: true, restGateway: true, piiMask: true, fileReader: true },
        includeClaudeConfig: true,
        includeDocker: true,
        includeAuditLogging: true,
        readOnlyAst: true,
        tables: [],
        appName: 'evolve-test-mcp',
        appVersion: '1.0.0'
      },
      'd:/EvolveMInds/EvolveAI'
    );

    const parsed = JSON.parse(configStr);
    assert.ok(parsed.mcpServers['evolve-test-mcp']);
    assert.strictEqual(parsed.mcpServers['evolve-test-mcp'].command, 'node');
    assert.ok(parsed.mcpServers['evolve-test-mcp'].args.includes('d:/EvolveMInds/EvolveAI/src/mcp/server.ts'));
  });

  test('generates comprehensive MCP Architectural Decision Record (ADR-MCP-001)', () => {
    const adr = McpScaffolder.generateAdr({
      language: 'typescript',
      transport: 'sse',
      port: 8080
    });

    assert.ok(adr.includes('# Architectural Decision Record (ADR): Enterprise Model Context Protocol (MCP) Server'));
    assert.ok(adr.includes('ADR-MCP-001'));
    assert.ok(adr.includes('MCP 2024-11-05 Specification'));
    assert.ok(adr.includes('AST Read-Only Query Guard'));
    assert.ok(adr.includes('SOX 404 Cryptographic Audit Trail'));
    assert.ok(adr.includes('Server-Sent Events'));
  });
});
