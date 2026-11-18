import { AsyncLocalStorage } from 'node:async_hooks';

// Server-only, request-scoped evidence. Never serialize it into a public header.
// The standalone adapter sets this only after validating the session and mapping.
const identities = new AsyncLocalStorage();
export function withVerifiedIdentity(user, operation) {
  return identities.run(Object.freeze({ ...user }), operation);
}
export function currentVerifiedIdentity() { return identities.getStore(); }
