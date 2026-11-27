import assert from 'node:assert/strict';
import test from 'node:test';
import {openLocalDatabase} from './helpers/local-db.mjs';
import {handleRequest} from '../src/http/router.ts';
import {OWN_SESSION_QUERY,issueSession,sessionHash} from '../src/modules/identity/sessions.ts';
import {preparePrivateCallInvitation} from '../src/modules/interactions/private-call-invitation.ts';
import {claimPrivateCallDispatch} from '../src/modules/interactions/private-call-dispatch.ts';
import {ownPrivateCallSignal} from '../src/modules/interactions/private-call-signaling.ts';
const owner='private-feature-owner',other='private-feature-other';
const ownId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
const paths=[
  '/worker-profile','/listings','/listings?limit=1','/listings?limit=1&view=management',
  '/listings?id='+ownId+'&view=management','/listings?id='+ownId+'&view=revision',
  '/listings?categoryId=repair&view=management',
  '/service-photo?id='+ownId,'/service-photo?id='+ownId+'&download=1',
  '/service-details?id='+ownId,'/service-area?id='+ownId,
  '/call-preference','/call-availability','/call-device','/call-history',
  '/contact-blocks?lang=en','/contact-block?listingId='+otherId,
  '/service-report?listingId='+otherId,'/service-appeal?listingId='+ownId,'/call?id=INVITATION',
];
const flags=DB=>({DB,CALL_SIGNALING_ENABLED:'1',CALL_DEVICES_ENABLED:'1',CALL_HISTORY_ENABLED:'1',CONTACT_BLOCKS_ENABLED:'1',SERVICE_MODERATION_KEY:'f'.repeat(64)});
const transitions={
  logout:(db,hash)=>db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash),
  expiry:(db,hash)=>db.prepare('UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?').run(hash),
  rebind:(db,hash)=>db.prepare('UPDATE auth_sessions SET account_id=? WHERE token_hash=?').run(other,hash),
  disable:db=>db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(owner),
};
async function setup(){
  const f=openLocalDatabase();
  f.db.exec(`INSERT INTO categories(id,slug,name_en,is_active) VALUES('repair','repair','Repair',1)`);
  for(const [account,listing] of [[owner,ownId],[other,otherId]]){
    f.db.prepare('INSERT INTO accounts(id) VALUES(?)').run(account);
    f.db.prepare('INSERT INTO worker_profiles(account_id) VALUES(?)').run(account);
    f.db.prepare('INSERT INTO worker_listings(id,worker_account_id,category_id) VALUES(?,?,?)').run(listing,account,'repair');
    f.db.prepare('INSERT INTO worker_agora_call_preferences VALUES(?,1,1)').run(account);
    f.db.prepare('INSERT INTO worker_agora_availability_preferences VALUES(?,1,1)').run(account);
  }
  const token=(await issueSession(f.adapter,owner)).accessToken,caller=(await issueSession(f.adapter,other)).accessToken;
  const invitation=await preparePrivateCallInvitation(f.adapter,caller,ownId,'privacy-read-attempt');
  assert.equal(invitation.kind,'created');
  assert.ok(await claimPrivateCallDispatch(f.adapter,caller,invitation.invitationId,owner));
  assert.equal((await ownPrivateCallSignal(f.adapter,token,invitation.invitationId,'accept')).phase,'accepted');
  return {...f,token,hash:await sessionHash(token),invitation:invitation.invitationId};
}
const request=(path,f)=>new Request('https://jodlo.example/api/v1/me'+path.replace('INVITATION',f.invitation),{headers:{Authorization:'Bearer '+f.token}});
function capturePrivateRead(adapter,mutate){
  let captured=0;
  return {...adapter,get captured(){return captured;},prepare(query){
    const stmt=adapter.prepare(query);
    if(query!==OWN_SESSION_QUERY&&query.trimStart().startsWith('SELECT')){
      const original=stmt.all.bind(stmt);
      stmt.all=async()=>{const data=await original();if(++captured===1)await mutate();return data;};
    }
    return stmt;
  }};
}
for(const [transition,mutate] of Object.entries(transitions))test('all private feature reads suppress captured data after '+transition,async()=>{
  for(const path of paths){
    const f=await setup();
    try{
      const baseline=await handleRequest(request(path,f),flags(f.adapter));
      assert.equal(baseline.status,200,path+': '+await baseline.clone().text());
      const raced=capturePrivateRead(f.adapter,()=>mutate(f.db,f.hash));
      const response=await handleRequest(request(path,f),flags(raced));
      assert.ok(raced.captured>=1,path+' must obtain an authenticated private row');
      assert.equal(response.status,401,path);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      const body=await response.text();
      for(const privateValue of [owner,other,ownId,otherId,f.token,f.hash,f.invitation,'categoryId','ringDeadlineMs','registered'])
        assert.ok(!body.includes(privateValue),path+' leaked '+privateValue);
    }finally{f.db.close();}
  }
});
test('a failed final session lookup cannot return a private feature snapshot',async()=>{
  for(const path of paths){
    const f=await setup();
    try{
      let read=false;
      const captured=capturePrivateRead(f.adapter,()=>{read=true;});
      const adapter={...captured,prepare(query){
        if(query===OWN_SESSION_QUERY&&read)throw Error('PRIVATE_SQL_AND_TOKEN');
        return captured.prepare(query);
      }};
      const response=await handleRequest(request(path,f),flags(adapter));
      assert.equal(response.status,503,path);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      const body=await response.text();
      for(const privateValue of [owner,ownId,f.token,'PRIVATE_SQL_AND_TOKEN','ringDeadlineMs'])assert.ok(!body.includes(privateValue));
    }finally{f.db.close();}
  }
});
test('disabled and unknown private features stay absent without any session/database query',async()=>{
  let queries=0;
  const env={DB:{prepare(){queries++;throw Error('Must not query disabled feature');}}};
  for(const path of ['/call?id='+ownId,'/call-availability','/call-device','/call-history','/contact-blocks?lang=en',
    '/contact-block?listingId='+otherId,'/service-report?listingId='+otherId,'/service-appeal?listingId='+ownId,'/unknown']){
    const response=await handleRequest(new Request('https://jodlo.example/api/v1/me'+path,{headers:{Authorization:'Bearer '+'a'.repeat(43)}}),env);
    assert.equal(response.status,404,path);
  }
  assert.equal(queries,0);
});
test('logout during an accepted call succeeds with D1 aggregate trigger changes and stays revoked',async()=>{
  const f=await setup();
  try{
    const d1={...f.adapter,prepare(query){
      const stmt=f.adapter.prepare(query),run=stmt.run.bind(stmt);
      stmt.run=async()=>{const before=f.db.prepare('SELECT total_changes() AS n').get().n;
        await run();return {meta:{changes:f.db.prepare('SELECT total_changes() AS n').get().n-before}};};
      return stmt;
    }};
    const logout=()=>new Request('https://jodlo.example/api/v1/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+f.token}});
    assert.equal((await handleRequest(logout(),{DB:d1})).status,200);
    assert.equal(f.db.prepare('SELECT phase FROM private_call_invitations WHERE id=?').get(f.invitation).phase,'ended');
    assert.equal((await handleRequest(logout(),{DB:d1})).status,401);
  }finally{f.db.close();}
});
