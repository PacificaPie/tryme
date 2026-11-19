// A navigation or file re-selection can close a capture's HTTP connection.
// Keep the already admitted capture alive within the provider's bounded
// waitUntil window so that the same attempt ID can recover its result.
// Authentication still runs before this wrapper is invoked.
export function retainPublishCapture(request, context, response) {
  if (request.method === 'POST' && /^\/api\/publish-drafts\/[\w-]+\/capture$/.test(new URL(request.url).pathname)) {
    context.waitUntil(Promise.resolve(response).then(() => {}, () => {}));
  }
  return response;
}
