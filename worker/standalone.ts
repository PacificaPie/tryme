import { reportUnexpectedError, reportJobOutcome } from '../lib/funtrack/error-reporting.mjs';
import { createPublishDraftService } from '../lib/funtrack/publish-draft-service.mjs';
import handler from 'vinext/server/fetch-handler';
import { createClerkClient } from '@clerk/backend';
import { createStandaloneHandler } from '../lib/funtrack/standalone-auth.mjs';
import { createCoverDraftService } from '../lib/funtrack/cover-draft-service.mjs';
import { createCoverReviewService } from '../lib/funtrack/cover-review-service.mjs';
import { captureExternalCover } from '../lib/funtrack/external-cover-capture.mjs';
import { createAutoCoverService } from '../lib/funtrack/auto-cover-service.mjs';
import { captureHostedHTML } from '../lib/funtrack/auto-cover-capture.mjs';
import { createVideoPreviewService } from '../lib/funtrack/video-preview-service.mjs';
import { captureVideoPreview } from '../lib/funtrack/video-preview-capture.mjs';
import { retainPublishCapture } from '../lib/funtrack/publish-capture-lifetime.mjs';

// This entry is selected only by the standalone build. The Sites Worker remains
// unchanged and retains its platform-owned authentication and resource bindings.
export default {
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env) {
    const bindings=env as unknown as { DB: D1Database; BUCKET: R2Bucket; BROWSER?: Fetcher; FUNTRACK_AUTO_COVER_ENABLED?: string; FUNTRACK_VIDEO_PREVIEW_ENABLED?: string; FUNTRACK_COVER_REVIEW_ENABLED?: string };
    const drafts=createCoverDraftService({db:()=>bindings.DB,bucket:()=>bindings.BUCKET,configured:()=>false,capture:async()=>{},bodyJSON:async()=>({})});
    try { await drafts.cleanup(); } catch(error) { reportUnexpectedError(error,'cleanup_cover'); }
    const mediaDrafts=createPublishDraftService({db:()=>bindings.DB,bucket:()=>bindings.BUCKET} as any);
    try { await mediaDrafts.cleanup(); } catch(error) { reportUnexpectedError(error,'cleanup_media'); }
    const covers=createAutoCoverService({db:()=>bindings.DB,bucket:()=>bindings.BUCKET,configured:()=>bindings.FUNTRACK_COVER_REVIEW_ENABLED!=='1'&&bindings.FUNTRACK_AUTO_COVER_ENABLED==='1'&&typeof bindings.BROWSER?.fetch==='function',capture:(html:string)=>captureHostedHTML(bindings.BROWSER,html)});
    try { reportJobOutcome(await covers.processPending(),'scheduled_cover'); } catch(error) { reportUnexpectedError(error,'scheduled_cover'); }
    const external=createCoverReviewService({db:()=>bindings.DB,bucket:()=>bindings.BUCKET,configured:()=>bindings.FUNTRACK_COVER_REVIEW_ENABLED==='1'&&typeof bindings.BROWSER?.fetch==='function',capture:(content:string,options:{source:string;waitMs:number})=>options.source==='html'?captureHostedHTML(bindings.BROWSER,content,{settleMs:options.waitMs}):captureExternalCover(bindings.BROWSER,content,options)});
    try { reportJobOutcome(await external.processPending(),'scheduled_external'); } catch(error) { reportUnexpectedError(error,'scheduled_external'); }
    const previews=createVideoPreviewService({db:()=>bindings.DB,bucket:()=>bindings.BUCKET,configured:()=>bindings.FUNTRACK_VIDEO_PREVIEW_ENABLED==='1'&&typeof bindings.BROWSER?.fetch==='function',capture:(html:string)=>captureVideoPreview(bindings.BROWSER,html)});
    try { reportJobOutcome(await previews.processPending(),'scheduled_video'); } catch(error) { reportUnexpectedError(error,'scheduled_video'); }
  },
  fetch: createStandaloneHandler({
    fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => retainPublishCapture(request, ctx, handler.fetch(request, env, ctx)),
    createClerkClient,
  }),
};
