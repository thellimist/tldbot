import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getAvailableSources, hasRegistrarApi } from './config.js';
import {
  logger,
  generateRequestId,
  setRequestId,
  clearRequestId,
} from './utils/logger.js';
import { wrapError } from './utils/errors.js';
import { formatToolResult, formatToolError } from './utils/format.js';
import { prewarmRdapBootstrap } from './fallbacks/rdap.js';
import {
  listRegisteredToolSchemas,
  executeRegisteredTool,
} from './app/tool-registry.js';

const SERVER_NAME = 'tldbot';
const SERVER_VERSION = '0.0.1';
const MCP_OUTPUT_FORMAT = 'table';

export function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: listRegisteredToolSchemas() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const requestId = generateRequestId();

    try {
      setRequestId(requestId);
      logger.info('Tool call started', { tool: name, request_id: requestId });

      const result = await executeRegisteredTool(name, args || {});

      logger.info('Tool call completed', {
        tool: name,
        request_id: requestId,
      });

      return {
        content: [
          {
            type: 'text',
            text: formatToolResult(name, result, MCP_OUTPUT_FORMAT),
          },
        ],
      };
    } catch (error) {
      const wrapped = wrapError(error);

      logger.error('Tool call failed', {
        tool: name,
        request_id: requestId,
        error: wrapped.message,
        code: wrapped.code,
      });

      return {
        content: [
          {
            type: 'text',
            text: formatToolError(
              {
                code: wrapped.code,
                userMessage: wrapped.userMessage,
                retryable: wrapped.retryable,
                suggestedAction: wrapped.suggestedAction,
              },
              MCP_OUTPUT_FORMAT,
            ),
          },
        ],
        isError: true,
      };
    } finally {
      clearRequestId();
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  logger.info('tldbot MCP starting', {
    version: SERVER_VERSION,
    node_version: process.version,
    transport: 'stdio',
    sources: getAvailableSources(),
    has_registrar_api: hasRegistrarApi(),
  });

  if (!hasRegistrarApi()) {
    logger.warn('No pricing API configured. Falling back to RDAP/WHOIS and public estimates only.');
  }

  const server = createServer();

  prewarmRdapBootstrap().catch((err) => {
    logger.debug('RDAP pre-warm failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('tldbot MCP ready', {
    tools: listRegisteredToolSchemas().length,
    transport: 'stdio',
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const invokedPath = process.argv[1] || '';
if (/(^|\/|\\)server\.js$/.test(invokedPath)) {
  startServer().catch((error) => {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}
