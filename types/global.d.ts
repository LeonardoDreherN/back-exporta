export {};

/**
 * O código lança `new Error(msg)` e depois pendura campos extras
 * (status, code, upstream, response) pra o error handler central
 * (bootstrap/loggin.js) e os controllers decidirem o status HTTP.
 * Isso documenta esse contrato pro type-checker em vez de silenciar com `any`.
 */
declare global {
  interface Error {
    status?: number;
    code?: string;
    upstream?: unknown;
    response?: unknown;
  }
}
