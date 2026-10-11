import { app, safeStorage, shell } from 'electron';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
type Credentials = { clientId: string; subject: string; email?: string; idToken: string; accessToken: string; refreshToken: string; scopes: string[]; expiresAt: number; model?: string };
type Store = { hostId: string; active?: string; accounts: Record<string, Credentials> };
type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string; token_type?: string };
let refreshJob: Promise<string> | undefined;
const credentialsPath = () => path.join(app.getPath('userData'), 'chatgpt-credentials.enc');
const random = () => randomBytes(32).toString('base64url');

async function readStore(): Promise<Store> {
  try {
    const encoded = await fs.readFile(credentialsPath());
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS encryption is unavailable.');
    return JSON.parse(safeStorage.decryptString(encoded)) as Store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { hostId: `urn:uuid:${randomUUID()}`, accounts: {} };
  }
}
async function writeStore(value: Store) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS encryption is unavailable.');
  const target = credentialsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  await fs.rename(temporary, target);
}
async function configuration(): Promise<{ jwks_uri: string; revocation_endpoint: string }> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error('Cannot read the OpenAI configuration.');
  const result = await response.json() as { issuer: string; jwks_uri: string; revocation_endpoint: string };
  if (result.issuer !== issuer || !result.jwks_uri.startsWith(`${issuer}/`)) throw new Error('Invalid OpenAI configuration.');
  return result;
}
async function verifyIdToken(token: string, audience: string, nonce: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg: string; kid: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported ID token algorithm.');
  const config = await configuration();
  const response = await fetch(config.jwks_uri);
  if (!response.ok) throw new Error('OpenAI verification keys are unavailable.');
  const keys = await response.json() as { keys: Array<JsonWebKey & { kid?: string }> };
  const jwk = keys.keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as import('node:crypto').JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid ID token signature.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { iss: string; aud: string | string[]; exp: number; nbf?: number; nonce: string; sub: string; email?: string };
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer || !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience) || claims.exp <= now || (claims.nbf && claims.nbf > now) || claims.nonce !== nonce || !claims.sub) throw new Error('Invalid ChatGPT identity.');
  return claims;
}
async function exchange(form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const body = await response.json() as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) throw new Error(body.error_description || body.error || `OAuth: ${response.status}`);
  return body;
}
export async function connectChatGpt() {
  const store = await readStore();
  await writeStore(store);
  const previous = store.active ? store.accounts[store.active] : undefined;
  const state = random();
  const nonce = random();
  const verifier = random();
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('OAuth port unavailable.');
  const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
  const params = new URLSearchParams({ client_id: previous?.clientId ?? 'dynamic_agent_client', response_type: 'code', redirect_uri: redirect, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), ext_agent_host_id: store.hostId });
  if (previous) { params.set('id_token_hint', previous.idToken); if (previous.email) params.set('login_hint', previous.email); }
  else params.set('agent_name_hint', 'Scene');
  const callback = new Promise<URL>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Accesso ChatGPT scaduto.')), 180000);
    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', redirect);
      if (url.pathname !== '/auth/callback') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><p>You can return to Scene.</p></body></html>');
      clearTimeout(timer);
      resolve(url);
    });
  });
  try {
    await shell.openExternal(`${issuer}/api/accounts/authorize?${params}`);
    const url = await callback;
    if (url.searchParams.get('state') !== state) throw new Error('Invalid OAuth state.');
    if (url.searchParams.get('error')) throw new Error(`ChatGPT sign-in: ${url.searchParams.get('error')}`);
    const code = url.searchParams.get('code');
    const clientId = url.searchParams.get('client_id') ?? previous?.clientId;
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (previous && clientId !== previous.clientId)) throw new Error('ChatGPT sign-in incomplete.');
    const tokens = await exchange({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect, resource });
    if (!tokens.id_token || !tokens.refresh_token) throw new Error('Incomplete ChatGPT tokens.');
    const identity = await verifyIdToken(tokens.id_token, clientId, nonce);
    if (previous && identity.sub !== previous.subject) throw new Error('A different account was selected.');
    const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
    if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('The account did not grant access to its ChatGPT plan.');
    store.accounts[clientId] = { clientId, subject: identity.sub, email: identity.email, idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes, expiresAt: Date.now() + tokens.expires_in * 1000, model: previous?.model };
    store.active = clientId;
    await writeStore(store);
    return chatGptStatus();
  } finally { server.close(); }
}
export async function chatGptToken(): Promise<{ token: string; model: string } | null> {
  const store = await readStore();
  const account = store.active ? store.accounts[store.active] : undefined;
  if (!account) return null;
  if (account.expiresAt - Date.now() > 60000) return { token: account.accessToken, model: account.model ?? 'gpt-6.1-sol' };
  if (!refreshJob) refreshJob = (async () => {
    const tokens = await exchange({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource });
    account.accessToken = tokens.access_token;
    account.refreshToken = tokens.refresh_token ?? account.refreshToken;
    account.expiresAt = Date.now() + tokens.expires_in * 1000;
    if (tokens.scope) account.scopes = tokens.scope.split(/\s+/).filter(Boolean);
    await writeStore(store);
    return account.accessToken;
  })().finally(() => { refreshJob = undefined; });
  return { token: await refreshJob, model: account.model ?? 'gpt-6.1-sol' };
}
export async function chatGptStatus() {
  const store = await readStore();
  const account = store.active ? store.accounts[store.active] : undefined;
  if (!account) return { connected: false, models: [], usageUrl: 'https://chatgpt.com/#settings/usage' };
  try {
    const access = await chatGptToken();
    const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${access!.token}` } });
    if (!response.ok) throw new Error(`Model catalogue: ${response.status}`);
    const body = await response.json() as { models?: Array<{ slug: string; display_name: string; visibility: string }> };
    const models = (body.models ?? []).filter((model) => model.visibility === 'list').map(({ slug, display_name }) => ({ id: slug, name: display_name }));
    return { connected: true, email: account.email, model: account.model ?? models[0]?.id, models, usageUrl: 'https://chatgpt.com/#settings/usage' };
  } catch (error) { return { connected: true, email: account.email, model: account.model, models: [], error: error instanceof Error ? error.message : String(error), usageUrl: 'https://chatgpt.com/#settings/usage' }; }
}
export async function setChatGptModel(model: string) {
  const status = await chatGptStatus();
  if (!status.connected || !status.models.some((item) => item.id === model)) throw new Error('Model unavailable for this account.');
  const store = await readStore();
  store.accounts[store.active!].model = model;
  await writeStore(store);
  return chatGptStatus();
}
export async function disconnectChatGpt() {
  const store = await readStore();
  const account = store.active ? store.accounts[store.active] : undefined;
  if (!account) return { disconnected: true, revoked: true };
  let revoked = false;
  try {
    const config = await configuration();
    const response = await fetch(config.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }) });
    revoked = response.ok;
  } finally {
    account.accessToken = ''; account.refreshToken = ''; account.idToken = ''; account.expiresAt = 0;
    store.active = undefined;
    await writeStore(store);
  }
  return { disconnected: true, revoked };
}
