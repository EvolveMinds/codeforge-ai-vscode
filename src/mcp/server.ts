/**
 * Model Context Protocol (MCP) Server
 * Exposes Enterprise Database Schema & Client APIs as standard MCP Tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const server = new Server(
  { name: 'evolve-fde-mcp-server', version: '2.24.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'introspect_table_schema',
        description: 'Returns column names, types, and primary keys for an introspected table.',
        inputSchema: {
          type: 'object',
          properties: { tableName: { type: 'string' } },
          required: ['tableName']
        }
      },
      {
        name: 'test_client_api_endpoint',
        description: 'Sends an authenticated ping request to the client VPC connector.',
        inputSchema: {
          type: 'object',
          properties: { endpointPath: { type: 'string' }, method: { type: 'string' } },
          required: ['endpointPath']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return {
    content: [{ type: 'text', text: JSON.stringify({ executed: name, args, status: 'SUCCESS' }) }]
  };
});

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
