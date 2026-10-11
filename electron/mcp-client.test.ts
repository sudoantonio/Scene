import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { agentConnectionPath } from './mcp-client';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); Object.defineProperty(process, 'platform', platform); });
describe('MCP connection location', () => {
  it('preserves the isolated profile override', () => {
    vi.stubEnv('SCENE_USER_DATA_DIR','/tmp/scene-qa');
    expect(agentConnectionPath()).toBe('/tmp/scene-qa/agent-connection.json');
  });
  it('keeps macOS compatibility and honors the Linux configuration directory', () => {
    vi.stubEnv('SCENE_USER_DATA_DIR',undefined);
    Object.defineProperty(process,'platform',{ value:'darwin' });
    expect(agentConnectionPath()).toBe(path.join(os.homedir(),'Library','Application Support','abaco-animatic','agent-connection.json'));
    Object.defineProperty(process,'platform',{ value:'linux' });
    vi.stubEnv('XDG_CONFIG_HOME','/tmp/scene-config');
    expect(agentConnectionPath()).toBe('/tmp/scene-config/abaco-animatic/agent-connection.json');
    vi.stubEnv('XDG_CONFIG_HOME',undefined);
    expect(agentConnectionPath()).toBe(path.join(os.homedir(),'.config','abaco-animatic','agent-connection.json'));
  });
});
