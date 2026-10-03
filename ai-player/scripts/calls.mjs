/**
 * Run a list of tool calls through the MCP server and print each answer — for
 * trying the tools by hand without a Claude Code session.
 *
 *   node ai-player/scripts/calls.mjs '[["start_game",{"scenario":"valleydy","seed":1}],["move",{"direction":"east"}]]'
 *
 * Headless unless EXILE_HEADLESS=0. Uses the real profile (ai-player/runs/profile)
 * unless EXILE_PROFILE names another.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const calls = JSON.parse(process.argv[2] ?? '[]');
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(HERE, '..', 'server', 'server.mjs')],
  env: { ...process.env, EXILE_HEADLESS: process.env.EXILE_HEADLESS ?? '1' },
});
const client = new Client({ name: 'calls', version: '1.0.0' });
await client.connect(transport);
try {
  for (const [name, args] of calls) {
    const res = await client.callTool({ name, arguments: args ?? {} });
    const words = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    console.log(`>>> ${name} ${JSON.stringify(args ?? {})}\n${words}\n`);
  }
} finally {
  await client.close();
}
