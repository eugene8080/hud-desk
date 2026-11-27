// Pictures that a newsletter links to (<img src="https://...">) rather than attaches (Eugene,
// 2026-11-27: the Bloomberg Morning Briefing's images did not show). The URL comes from an email, so
// it is untrusted: only https on port 443, and the connection may reach only public addresses. The
// check runs inside the socket's DNS lookup, so a name cannot resolve to a public address for a check
// and a private one for the connection, and it runs again for every redirect. A private address would
// let a crafted email make the bridge call into the LAN, the tailnet or this PC.
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

export const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

// Loopback, private, link-local, carrier-grade NAT (which includes Tailscale's 100.64/10),
// multicast and reserved ranges, for IPv4, IPv6 and IPv4-mapped IPv6.
export function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped) return privateAddress(mapped);
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
  }
  return true;
}

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options?.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) {
      return callback(Object.assign(new Error('private address'), { code: 'EPRIVATE' }));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// The picture's bytes. Throws Error('remote-refused') for a URL it will not fetch and
// Error('remote-failed') when the fetch fails.
export function fetchPublicImage(url, { redirects = 3, maxBytes = MAX_REMOTE_BYTES, timeout = 15000, lookup = publicLookup } = {}) {
  let target;
  try { target = new URL(url); } catch { return Promise.reject(new Error('remote-refused')); }
  if (target.protocol !== 'https:' || (target.port && target.port !== '443') || target.username || target.password ||
      net.isIP(target.hostname.replace(/^\[|\]$/g, ''))) return Promise.reject(new Error('remote-refused'));
  return new Promise((resolve, reject) => {
    const request = https.get(target, {
      lookup, timeout, headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' },
    }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) return reject(new Error('remote-failed'));
        let next;
        try { next = new URL(response.headers.location, target).href; } catch { return reject(new Error('remote-refused')); }
        return resolve(fetchPublicImage(next, { redirects: redirects - 1, maxBytes, timeout, lookup }));
      }
      if (status !== 200 || !/^image\//i.test(String(response.headers['content-type'] ?? ''))) {
        response.resume();
        return reject(new Error('remote-failed'));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(); reject(new Error('remote-failed')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => reject(new Error('remote-failed')));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => reject(new Error(error?.code === 'EPRIVATE' ? 'remote-refused' : 'remote-failed')));
  });
}
