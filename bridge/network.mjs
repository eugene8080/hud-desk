// Outbound connection settings for the bridge process (Google sign-in, Gmail, remote pictures).
import dns from 'node:dns';
import net from 'node:net';

// Why (2026-11-28, Email unavailable for both mailboxes after a bridge restart): Node tries a
// host's addresses one at a time and abandons each attempt after 250 ms by default
// (net.getDefaultAutoSelectFamilyAttemptTimeout). Through the PC's Tailscale exit node the IPv4
// connect to oauth2.googleapis.com took ~270 ms and IPv6 never connected, so Node dropped the
// working IPv4 attempt, waited on IPv6 and failed with undici's 10 s UND_ERR_CONNECT_TIMEOUT.
// curl, which races both families, connected in about 1 s. Measured: 1000 ms and 2500 ms per
// address both reached the token server, www.google.com and Gmail in under 0.9 s.
// 1500 ms keeps a slow but working address and still leaves room inside the 10 s connect limit
// to step past several dead addresses.
export const ADDRESS_ATTEMPT_MS = 1500;

/**
 * Make outbound connections tolerate a slow route. Process-wide, so the server calls it once at
 * start-up; the functions are injectable so a test can check the call without changing its own
 * process defaults.
 * @param {{ setAttemptTimeout?: (ms: number) => void, setResultOrder?: (order: string) => void }} [deps]
 * @returns {{ attemptMs: number, order: string }}
 */
export function patientConnections({
  setAttemptTimeout = ms => net.setDefaultAutoSelectFamilyAttemptTimeout(ms),
  setResultOrder = order => dns.setDefaultResultOrder(order),
} = {}) {
  setAttemptTimeout(ADDRESS_ATTEMPT_MS);
  // IPv4 first: a route that drops IPv6 (as this exit node does) then costs nothing, and a host
  // that only works over IPv6 is still reached after one attempt period.
  setResultOrder('ipv4first');
  return { attemptMs: ADDRESS_ATTEMPT_MS, order: 'ipv4first' };
}
