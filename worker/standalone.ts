import handler from 'vinext/server/fetch-handler';
import { createClerkClient } from '@clerk/backend';
import { createStandaloneHandler } from '../lib/funtrack/standalone-auth.mjs';

// This entry is selected only by the standalone build. The Sites Worker remains
// unchanged and retains its platform-owned authentication and resource bindings.
export default {
  fetch: createStandaloneHandler({
    fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => handler.fetch(request, env, ctx),
    createClerkClient,
  }),
};
