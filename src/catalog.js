import { z } from 'zod';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Validate known MCP fields without returning Zod's parsed (potentially stripped) object.
export const LosslessCatalogSchema = z.custom(value => ListToolsResultSchema.safeParse(value).success);
const scopedIdentifiers = new Set(['sessionid', 'session_id', 'mcp-session-id', 'progresstoken', 'progress_token', 'requestid', 'request_id', 'taskid', 'task_id']);
export function replayableCatalog(value, toolDefinition = false) {
  if (!value || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(entry => replayableCatalog(entry));
  return Object.entries(value).every(([key, entry]) => {
    // Parameter schemas describe identifiers; they do not carry live session values.
    if (toolDefinition && (key === 'inputSchema' || key === 'outputSchema')) return true;
    if (scopedIdentifiers.has(key.toLowerCase())) return false;
    return key === 'tools' && Array.isArray(entry) ? entry.every(tool => replayableCatalog(tool, true)) : replayableCatalog(entry);
  });
}
