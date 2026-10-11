import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const agentConnectionPath = () => path.join(process.env.SCENE_USER_DATA_DIR ?? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'abaco-animatic') : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'abaco-animatic')), 'agent-connection.json');

export async function callAgentBridge(method: string, args?: unknown): Promise<unknown> {
  let connection: { port: number; token: string };
  try { connection = JSON.parse(await fs.readFile(agentConnectionPath(), 'utf8')); }
  catch { throw new Error('Scene is not open. Launch Scene and retry.'); }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${connection.port}/rpc`, {
      method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(method === 'export' || method === 'bundle' ? 610000 : 70000),
    });
  } catch { throw new Error('The local connection to Scene is unavailable. Launch Scene and retry.'); }
  const payload = await response.json() as { result?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Scene request failed.');
  return payload.result;
}
