// Local HTTP fixtures must opt into the same review flow used by the website.
// Start the local Worker with FUNTRACK_REVIEWER_IDS=local-reviewer, or set both
// that variable and FUNTRACK_TEST_REVIEWER_ID to the same dedicated local ID.
import assert from 'node:assert/strict';

export function createDiscoveryReviewer({request,ok}) {
  const reviewer=process.env.FUNTRACK_TEST_REVIEWER_ID||'local-reviewer';let checked=false;
  return async function approveFixture(workId,user) {
    if(!checked){
      const account=ok(await request('/api/me',{user:reviewer}));
      assert.equal(account.canReview,true,'Configure local Worker FUNTRACK_REVIEWER_IDS to match FUNTRACK_TEST_REVIEWER_ID (default local-reviewer).');checked=true;
    }
    let work=ok(await request('/api/works/'+workId,{user})).work;
    if(work.discovery.reviewStatus==='approved'&&work.discovery.approvedVersionId===work.versionId)return work;
    if(work.discovery.reviewStatus!=='pending'||work.discovery.kind==='unspecified'||!work.discovery.playDescription){
      work=ok(await request('/api/works/'+workId+'/discovery',{method:'POST',user,json:{
        action:'submit',expectedRevision:work.discovery.revision,kind:'prototype',playDescription:'A local test prototype: interact with the controls and observe the game state.',rulesAccepted:true,
      }})).work;
    }
    return ok(await request('/api/review/works/'+workId,{method:'POST',user:reviewer,json:{
      decision:'approve',expectedRevision:work.discovery.revision,versionId:work.versionId,
    }})).work;
  };
}
