// State shared by the update form and its retries. A new baseline is explicit.
export function newVersionDraft(work,key){return {key,expectedRevision:work.revision,baseVersion:work.version,source:'html',releaseNotes:'',githubURL:'',attempted:false};}
export function editVersionDraft(draft,values,key){return {...draft,...values,key,attempted:false};}
export function rebaseVersionDraft(draft,work,key){return {...draft,key,expectedRevision:work.revision,baseVersion:work.version,attempted:false};}
export function versionWork(work,version){const result={...work,versionId:version.id,version:version.version,coverUrl:version.coverUrl,versionCreatedAt:version.createdAt};delete result.build;if(version.build)result.build=version.build;return result;}
export function previewReferences(preview){return preview.works.map(work=>({workId:work.id,versionId:work.versionId}));}
export function isPinnedPreview(preview){return preview?.payloadSchema===2;}
// Invoke only after the user explicitly generates a preview. Legacy save keys
// remain attached to their original workIds-only request until that action.
export function prepareCardPreview(previous,next,key){return isPinnedPreview(previous)&&previous.fingerprint===next.fingerprint?previous:{...next,payloadSchema:2,saveKey:key};}
export function frozenAction(eventId,type,fields){return Object.freeze({eventId,type,...structuredClone(fields)});}
export const LOCAL_PREVIEW_CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'";
export function localPreviewHTML(html){return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+LOCAL_PREVIEW_CSP+'">'+html;}
