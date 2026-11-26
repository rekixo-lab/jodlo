import assert from 'node:assert/strict';
import test from 'node:test';
import {openLocalDatabase} from './helpers/local-db.mjs';
import {handleRequest} from '../src/http/router.ts';
import {findSessionAccount,issueSession,sessionHash} from '../src/modules/identity/sessions.ts';
const owner='write-race-owner',other='write-race-other';
const id='11111111-1111-4111-8111-111111111111',base='/api/v1/me/listings';
const edit={listingId:id,expectedCategoryId:'plumber',nextCategoryId:'painter'};
const publication={listingId:id,expectedCategoryId:'plumber',expectedRevision:0};
const routes=[
  {name:'worker opt-in',path:'/api/v1/me/worker-profile',method:'POST',worker:false},
  {name:'idempotent worker opt-in',path:'/api/v1/me/worker-profile',method:'POST'},
  {name:'publish new',path:base,method:'POST',body:{categoryId:'painter'}},
  {name:'idempotent publish',path:base,method:'POST',body:{categoryId:'plumber'}},
  {name:'create',path:base+'?create=1',method:'POST',body:{categoryId:'painter'}},
  {name:'legacy resume',path:base+'?resume=1',method:'POST',status:'unpublished',body:{listingId:id,expectedCategoryId:'plumber'}},
  {name:'versioned pause',path:base+'?publication=pause',method:'PUT',body:publication},
  {name:'versioned resume',path:base+'?publication=resume',method:'PUT',status:'unpublished',body:publication},
  {name:'legacy category edit',path:base,method:'PUT',body:edit},
  {name:'versioned category edit',path:base+'?revision=1',method:'PUT',body:{...edit,expectedRevision:0}},
  {name:'unpublish',path:base+'?id='+id,method:'DELETE'},
];
const transitions={
  logout:(db,hash)=>db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash),
  expiry:(db,hash)=>db.prepare('UPDATE auth_sessions SET expires_at=1 WHERE token_hash=?').run(hash),
  rebind:(db,hash)=>db.prepare('UPDATE auth_sessions SET account_id=? WHERE token_hash=?').run(other,hash),
  disable:db=>db.prepare("UPDATE accounts SET status='disabled' WHERE id=?").run(owner),
};
async function setup(route){
  const f=openLocalDatabase();
  for(const account of [owner,other])f.db.prepare('INSERT INTO accounts(id) VALUES(?)').run(account);
  for(const category of ['plumber','painter'])f.db.prepare('INSERT INTO categories(id,slug,name_en,name_hi,is_active) VALUES(?,?,?,?,1)').run(category,category,category,'परीक्षण');
  if(route.worker!==false){
    f.db.prepare('INSERT INTO worker_profiles(account_id) VALUES(?)').run(owner);
    f.db.prepare('INSERT INTO worker_listings(id,worker_account_id,category_id,status) VALUES(?,?,?,?)').run(id,owner,'plumber',route.status??'published');
  }
  const token=(await issueSession(f.adapter,owner)).accessToken;
  const otherToken=(await issueSession(f.adapter,other)).accessToken;
  return {...f,token,otherToken,hash:await sessionHash(token)};
}
const snapshot=db=>({profiles:db.prepare('SELECT * FROM worker_profiles ORDER BY account_id').all(),listings:db.prepare('SELECT * FROM worker_listings ORDER BY id').all()});
function interceptWrite(adapter,before){
  let calls=0;
  return {...adapter,get calls(){return calls;},prepare(query){
    const stmt=adapter.prepare(query);
    if(/^(?:INSERT INTO worker_(?:profiles|listings)|UPDATE worker_listings)/.test(query)){
      for(const method of ['all','run']){
        const original=stmt[method].bind(stmt);
        stmt[method]=async()=>{if(++calls===1)await before();return original();};
      }
    }
    return stmt;
  }};
}
function request(route,token){
  return new Request('https://jodlo.example'+route.path,{method:route.method,headers:{Authorization:'Bearer '+token,...(route.body?{'Content-Type':'application/json'}:{})},...(route.body?{body:JSON.stringify(route.body)}:{})});
}
for(const [transition,mutate] of Object.entries(transitions)){
  test('all worker/listing HTTP mutations reject '+transition+' after initial auth but before SQL write',async()=>{
    for(const route of routes){
      const f=await setup(route);
      try{
        const before=snapshot(f.db),raced=interceptWrite(f.adapter,()=>mutate(f.db,f.hash));
        const response=await handleRequest(request(route,f.token),{DB:raced});
        assert.equal(raced.calls,1,route.name+' must reach the atomic write');
        assert.ok([401,403,404,409].includes(response.status),route.name+': '+response.status);
        assert.deepEqual(snapshot(f.db),before,route.name+' changed persisted owner state after '+transition);
        assert.equal(await findSessionAccount(f.adapter,f.otherToken),other);
        const text=await response.text();
        for(const secret of [owner,other,f.token,f.hash])assert.ok(!text.includes(secret));
      }finally{f.db.close();}
    }
  });
}
test('unchanged real sessions can perform every legacy and revision-aware worker mutation',async()=>{
  for(const route of routes){
    const f=await setup(route);
    try{
      const response=await handleRequest(request(route,f.token),{DB:f.adapter});
      assert.equal(response.status,200,route.name+': '+await response.clone().text());
      assert.equal((await response.json()).ok,true);
    }finally{f.db.close();}
  }
});
test('listing writes use direct RETURNING rows despite trigger side effects; stale retry remains a conflict',async()=>{
  const route=routes.find(r=>r.name==='versioned pause'),f=await setup(route);
  try{
    f.db.exec(`CREATE TABLE synthetic_trigger_audit(listing_id TEXT);
      CREATE TRIGGER synthetic_owner_update AFTER UPDATE OF status ON worker_listings
      BEGIN INSERT INTO synthetic_trigger_audit VALUES(NEW.id);
      INSERT INTO synthetic_trigger_audit VALUES(NEW.id); END;`);
    const response=await handleRequest(request(route,f.token),{DB:f.adapter});
    assert.equal(response.status,200);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM synthetic_trigger_audit').get().n,2);
    assert.equal((await handleRequest(request(route,f.token),{DB:f.adapter})).status,409);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM synthetic_trigger_audit').get().n,2);
  }finally{f.db.close();}
});
