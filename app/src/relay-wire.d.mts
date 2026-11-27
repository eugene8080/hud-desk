export const ROUTE_ID: RegExp;
export const NONCE_BYTES: number;
export const FRAME_ID_BYTES: number;
export const MAX_BODY: number;
export const MAX_PACKET: number;
export const RPC_TIMEOUT_MS: number;
export function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer>;
export function pack(meta: object, body?: Uint8Array): Uint8Array<ArrayBuffer>;
export function unpack(bytes: Uint8Array<ArrayBuffer>): {
  meta: Record<string, unknown>;
  body: Uint8Array<ArrayBuffer>;
};
export function aad(routeId: string, requestNonce?: Uint8Array): Uint8Array<ArrayBuffer>;
