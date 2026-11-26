#!/usr/bin/env node
// Ported from messenger-glass/companion/mail-auth.mjs (MIT).
// Run once per account from the local bridge checkout.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readOAuthClient, GMAIL_SCOPE, TOKEN_URL } from '../bridge/gmail.mjs';
import { readMailConfig } from '../bridge/mail.mjs';

const TIMEOUT_MS = 10 * 60 * 1000;

async function authorizationCode(clientId) {
  // The verifier stays in this process; state ties the callback to this run.
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consent.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state,
    access_type: 'offline', prompt: 'consent',
  });
  let timer;
  try {
    const code = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Consent callback timed out.')), TIMEOUT_MS);
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirectUri);
        const reply = (status, text) => {
          res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(text);
        };
        if (req.method !== 'GET' || url.pathname !== '/') return reply(404, 'Not found.');
        if (url.searchParams.get('state') !== state) return reply(400, 'Invalid consent callback.');
        if (url.searchParams.has('error')) {
          reply(400, 'Consent was refused. You can close this tab.');
          reject(new Error('Consent was refused.'));
          return;
        }
        const value = url.searchParams.get('code');
        if (!value) return reply(400, 'Missing authorization code.');
        reply(200, 'Authorization received. Close this tab and return to the terminal.');
        resolve(value);
      });
      console.log(`\nOPEN THIS GOOGLE CONSENT URL IN YOUR BROWSER\n\n${consent.href}\n`);
      console.log('Sign in with the configured account. The callback expires in 10 minutes.');
    });
    return { code, redirectUri, verifier };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

async function jsonFrom(url, options, error) {
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new Error(error);
  }
}

async function saveToken(account, token) {
  const path = account.tokenFile;
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(token, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } catch {
    throw new Error('Could not save the Gmail token under .local/.');
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--account') throw new Error('Usage: node scripts/mail-auth.mjs --account <id>');
  let config;
  try {
    const file = new URL('../bridge/config.local.json', import.meta.url);
    config = readMailConfig(JSON.parse(await readFile(file, 'utf8')).mail);
  } catch {
    throw new Error('Could not load the mail block in bridge/config.local.json.');
  }
  const account = config?.accounts.find(entry => entry.id === args[1]);
  if (!account) throw new Error('Account is not configured in a valid mail block.');
  const { client_id, client_secret } = await readOAuthClient(config.oauthClientFile);
  const { code, redirectUri, verifier } = await authorizationCode(client_id);
  const token = await jsonFrom(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id, client_secret, redirect_uri: redirectUri,
      grant_type: 'authorization_code', code_verifier: verifier,
    }),
  }, 'Google token exchange failed.');
  const scopes = String(token.scope ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GMAIL_SCOPE)) throw new Error('Google did not grant gmail.modify.');
  if (!token.access_token || !token.refresh_token) throw new Error('Google did not return both tokens.');

  const profile = await jsonFrom('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }, 'Google mailbox verification failed.');
  if (typeof profile.emailAddress !== 'string' ||
      profile.emailAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('Signed in with the wrong account. Run consent again with the configured mailbox.');
  }
  await saveToken(account, {
    account: profile.emailAddress, scopes, refresh_token: token.refresh_token, created: new Date().toISOString(),
  });
  console.log('Verified the mailbox and saved its Gmail refresh token under .local/.');
}

main(process.argv.slice(2)).catch(error => {
  const message = error.code === 'auth' ? 'Could not read the installed OAuth client.' : error.message;
  console.error(`[mail-auth] ${message}`);
  process.exitCode = 1;
});
