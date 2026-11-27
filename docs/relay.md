# HUD Desk relay
Updated: 2026-11-27

The relay lets a HUD Desk bridge connect from behind NAT without accepting inbound Internet
traffic. Both the phone and the bridge connect to a single public origin.

## Connections and pairing

- The bridge opens one outbound WebSocket at `wss://<relay>/bridge/<routeId>`. It reconnects
  with exponential backoff and jitter. The relay pings the bridge every 20 seconds to detect
  half-open connections.
- The app sends encrypted requests as HTTPS POSTs to `https://<relay>/r/<routeId>/`.
  The trailing slash is required. The original HTTP method, path, query string, media type,
  and body are inside the encrypted request. The relay attaches a random correlation ID to the
  WebSocket frame so it can return the matching encrypted response to the right HTTP caller.
- After decryption and replay checks, the bridge dispatches to its existing `/healthz` and
  `/api/` handlers. This also covers Email and Chat. The direct HTTP host gate still applies to
  direct callers. Relayed requests use their own encrypted authentication and enter through an
  in-process adapter. Raw voice PCM travels as bytes. The current image APIs return the panel
  pixels in JSON, and the transport supports binary responses too.
- An `eho2.<routeId>.<key>` pairing code carries a route ID and a 256-bit AES key in base64url.
  The bridge and phone store the key locally. Existing `eho1` codes still select the direct
  Tailscale transport and use its existing bearer credential.

## Set up after a relay origin is chosen

1. On the relay host, use Node 22 or newer and run `npm ci --omit=dev` at the repository root.
   Run `node relay/server.mjs` behind an HTTPS reverse proxy supporting WebSocket upgrades. The
   server binds to `127.0.0.1:8797` by default and accepts `HOST` and `PORT`. Allow a 390-second
   upstream response plus upload and network time, and an HTTP body of at least 4 MiB plus 8 KiB
   and framing. Pass the WebSocket upgrade and its Authorization header through. Disable request
   and response body logging, caching, and disk buffering in the proxy. The service requires
   one replica because pending requests and registered sockets are in memory.
2. On a self-hoster's PC, run `npm ci` at the repository root. In `bridge/config.local.json`,
   set `"relay": { "url": "https://<relay>" }`, using the exact origin without a trailing
   slash. Start the bridge using the usual local command. Run `npm run pair` on the same
   checkout, then paste the printed v2 code into HUD Desk on the phone. Keep the printed code
   and `bridge/.relay-identity` private. To revoke all v2 codes from a bridge, stop it, replace
   the identity file, restart it, and pair the phone again. Set `"relay": null` to disable the
   outbound link.
3. In the app build, set `ORCA_GLASS_RELAY_ORIGIN` to the chosen origin and add that exact
   HTTPS origin to the network whitelist in `app/app.json`. The origin and manifest have to
   agree for `npm run beta:pack`. Keep the existing Tailscale whitelist entry and
   `ORCA_GLASS_BRIDGE_ORIGIN` for eho1 connections. The relay origin is currently unset.
   Verify a packaged WebView on a phone before release, including WebCrypto availability,
   cross-origin fetch, and uploading voice audio. See [Even Hub's networking documentation](https://hub.evenrealities.com/docs/build/networking).

HTTP origins are accepted only on loopback for local tests. Run `npm ci` and
`npm ci --prefix app` before running `npm test`. The relay tests use ephemeral localhost ports.

## Threat model and limits

AES-256-GCM authenticates both directions with random 96-bit nonces. A reserved nonce bit separates
request and response nonce spaces. Additional authenticated data binds the direction and route,
and ties each response to the nonce of its exact request. After authenticating a request, the bridge
requires the phone's timestamp to be within 60 seconds and records the nonce before processing the
request. Keep the phone and PC clocks synchronized. The bridge issues an encrypted session epoch that
survives relay reconnects and changes when the bridge restarts. An old request cannot execute in a
new epoch. On a disconnect or timeout after submission, the app treats delivery of a write as
uncertain. A bridge operation that already started can finish after the app times out.

The relay sees the route ID, network metadata such as IP addresses and connection timing, the
ciphertext sizes and correlation IDs, and whether a request could be forwarded or was refused.
It sees a bridge-only WebSocket registration credential whose SHA-256 hash is the route ID. That
credential lets the relay validate registration and is independent of the AES key. The relay
cannot read API paths or bodies, voice, images, session data, mail or chat, or forge authenticated API
commands. A relay operator can deny service, delay a previously unseen request within its permitted
window, or substitute an unavailable bridge. The bridge and phone are the trusted endpoints.
Possession of a v2 pairing code gives the holder the bridge's full app access, including writes.
The protocol does not provide forward secrecy if the long-lived pairing key is later compromised.

The Node relay buffers only opaque packets for forwarding and has no body logs or persistence.
Each request or response carries up to 4 MiB of body plus up to 8 KiB of encrypted metadata
and framing. Limits are 15 seconds for upload, 390 seconds waiting for a bridge response,
and 15 seconds to flush the response. Each route gets six requests per second on average, with a
burst of 48. Caps are four in-flight requests per route, 32 globally, and 256 route records. The
bridge also limits concurrent relayed work to four requests. A shared public relay can be exhausted
by enough registrations or traffic. Public abuse controls such as ingress connection limits can be
added at the reverse proxy without giving it the pairing keys.

## Hosting options

Prices checked 2026-11-27. No provider or domain is configured.

| Option | Cost | WebSockets and limits |
| --- | --- | --- |
| Node on a small VPS, such as Hetzner Cloud | Hetzner's June tariff lists CX23 at €5.49/month in Germany, excluding VAT and IPv4. Check regional availability and pricing before ordering. Domain and any applicable traffic charges are separate. | Runs this Node service unchanged. A regular HTTPS proxy passes the WebSocket upgrade. Use the service's size and rate limits and set proxy timeouts to cover slow transcription. A VM restart drops live sockets and the clients reconnect. [Hetzner price notice](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |
| Cloudflare Workers with one Durable Object per route | Durable Objects Free includes 100,000 requests and 13,000 GB-s daily. Workers Paid starts at US$5/month with bundled usage and metered overage. | Durable Objects support persistent WebSockets with hibernation and a 32 MiB incoming WebSocket message limit. The wire protocol fits, but the server would need a Workers adapter and per-route object routing. Open RPCs and long-running requests affect duration cost. [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |

Use a small Node VPS for the first release. It runs the implementation directly and gives the
operator control of the WebSocket and HTTP timeouts. Revisit Durable Objects if the relay needs
multiple instances or per-route isolation at larger scale.
