import assert from "node:assert/strict";
import test from "node:test";
import {
  makeCatalogCorrectionIntake,validateCatalogCorrectionIntake,
  loadPinnedCatalogCorrectionIntake,
} from "./catalog-correction-evidence.mjs";
import {validJodloReviewUrl} from "./review-evidence-url.mjs";

const {review,intake,summary}=loadPinnedCatalogCorrectionIntake(1);
const link="https://github.com/rekixo-lab/jodlo/pull/95#issuecomment-123456";
const all=review.packets.flatMap(p=>p.categories);
const one=(packet=1)=>makeCatalogCorrectionIntake(review,packet);
const submit=(draft,row,key,value)=>{
  row.proposedCorrections[key]=value;
  row.status="EVIDENCE_LINKED_UNVERIFIED";
  row.evidenceUrl=link;
  return draft;
};
const denied=(mutate)=>{
  const x=structuredClone(intake);mutate(x);
  assert.throws(()=>validateCatalogCorrectionIntake(x,review));
};

test("all 889 source Categories included once in 45 complete, pending correction templates",()=>{
  assert.equal(all.length,889);
  const ids=new Set(all.map(x=>x.sourceCategoryId));
  assert.equal(ids.size,889);
  assert.equal(review.manifest.summary.categoriesAuthorizedForActivation,0);
  assert.deepEqual(summary,{
    packetNumber:1,categoriesInPacket:intake.categories.length,
    correctionLinksUnverified:0,correctedIdsProposed:0,
    correctedSlugsProposed:0,correctedEnglishTitlesProposed:0,
    correctedHindiTitlesProposed:0,humanReviewAuthenticated:0,
    founderCategoryApprovalsAuthenticated:0,
    categoriesAuthorizedForActivation:0,activatedCategories:0,
  });
  const covered=[];
  for(let i=1;i<=45;i++){
    const draft=one(i);
    assert.equal(draft.packetNumber,i);
    assert.equal(draft.categories.length,review.packets[i-1].categories.length);
    assert.equal(validateCatalogCorrectionIntake(draft,review).activatedCategories,0);
    covered.push(...draft.categories.map(x=>x.sourceCategoryId));
    assert.ok(draft.categories.every(x=>
      x.status==="NOT_SUBMITTED" && x.evidenceUrl===null &&
      x.reviewState==="HUMAN_REVIEW_PENDING_NOT_APPROVED" &&
      Object.values(x.proposedCorrections).every(v=>v===null)));
  }
  assert.equal(covered.length,889);
  assert.equal(new Set(covered).size,889);
  assert.equal(one(45).categories.length,9);
  assert.ok(covered.includes("farmer-helper-मजदूर"));
});

test("legitimate Hindi/English corrections with evidence remain UNVERIFIED, never active",()=>{
  const draft=one(1);
  const row=draft.categories[0];
  submit(draft,row,"nameHi","काम की मरम्मत");
  row.proposedCorrections.nameEn="Careful work";
  const s=validateCatalogCorrectionIntake(draft,review);
  assert.equal(s.correctionLinksUnverified,1);
  assert.equal(s.correctedEnglishTitlesProposed,1);
  assert.equal(s.correctedHindiTitlesProposed,1);
  assert.equal(s.humanReviewAuthenticated,0);
  assert.equal(s.founderCategoryApprovalsAuthenticated,0);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(s.activatedCategories,0);
  assert.equal(row.reviewState,"HUMAN_REVIEW_PENDING_NOT_APPROVED");
});

test("source-incompatible Unicode old ID can be proposed, never silently replaced",()=>{
  const packet=review.packets.find(p=>p.categories.some(c=>
    c.sourceCategoryId==="farmer-helper-मजदूर"));
  const draft=one(packet.packetNumber);
  const row=draft.categories.find(c=>c.sourceCategoryId==="farmer-helper-मजदूर");
  submit(draft,row,"categoryId","farmer-helper-manual-review");
  row.proposedCorrections.slug="farmer-helper-manual-review";
  const s=validateCatalogCorrectionIntake(draft,review);
  assert.equal(s.correctedIdsProposed,1);
  assert.equal(s.correctedSlugsProposed,1);
  assert.equal(s.categoriesAuthorizedForActivation,0);
  assert.equal(row.sourceCategoryId,"farmer-helper-मजदूर");
  assert.equal(packet.categories.find(c=>
    c.sourceCategoryId===row.sourceCategoryId).sourceCategoryId,row.sourceCategoryId);
});

test("forged approvals, missing/sorted rows and stale source digests fail closed",()=>{
  denied(x=>{x.kind="ACTIVE";});
  denied(x=>{x.state="APPROVED";});
  denied(x=>{x.languages=["en","hi-Latn"];});
  denied(x=>{x.sourceJsonSha256="0".repeat(64);});
  denied(x=>{x.packetNumber=2;});
  denied(x=>{x.categories.pop();});
  denied(x=>{x.categories.reverse();});
  denied(x=>{x.categories[0].sourceCategoryId="invented";});
  denied(x=>{x.categories[0].sourceCategorySha256="0".repeat(64);});
  denied(x=>{x.categories[0].reviewState="APPROVED";});
  denied(x=>{x.categories[0].approved=true;});
  denied(x=>{x.categories[0].is_active=1;});
  denied(x=>{x.categories[0].proposedCorrections.seed=true;});
  denied(x=>{x.categories[0].status="SIGNED_OFF";});
});

test("no proposed edit without evidence, no evidence without actual edit",()=>{
  denied(x=>{x.categories[0].proposedCorrections.nameHi="नया काम";});
  denied(x=>{x.categories[0].status="EVIDENCE_LINKED_UNVERIFIED";});
  denied(x=>{x.categories[0].status="EVIDENCE_LINKED_UNVERIFIED";x.categories[0].evidenceUrl=link;});
  denied(x=>{
    const orig=review.packets[0].categories[0].historicalNameEn;
    submit(x,x.categories[0],"nameEn",orig);
  });
  denied(x=>{x.categories[0].evidenceUrl=link;});
});

test("reject unsafe scripts, malformed D1 identifiers, slug or names before evidence intake",()=>{
  const changes=[
    ["categoryId","farmer-helper-मजदूर"],["categoryId","contains spaces"],
    ["categoryId","A".repeat(65)],["slug","UPPER_case"],
    ["slug","abc--//"],["slug","x"],["nameHi","English only"],
    ["nameHi","मरम्मत English"],["nameHi","न".repeat(121)],
    ["nameEn","अनुवाद"],["nameEn","Work मरम्मत"],
    ["nameEn","A".repeat(121)],["nameEn","Name\nLine"],
    ["nameHi","नाम\u0000"],["nameHi","  काम"],
  ];
  for(const [key,value] of changes){
    const draft=one(1);
    submit(draft,draft.categories[0],key,value);
    assert.throws(()=>validateCatalogCorrectionIntake(draft,review),key);
  }
  for(const key of ["nameEn","nameHi"]){
    const draft=one(1);
    submit(draft,draft.categories[0],key,
      key==="nameHi"?"नयी  भाषा":"New  Name");
    // stylistically reviewable; no automatic editorial claim.
    assert.equal(validateCatalogCorrectionIntake(draft,review).activatedCategories,0);
  }
});

test("unchanged source ID and all existing 889 slugs are protected against collisions",()=>{
  const other=all.find(x=>x.sourceCategoryId!==
    review.packets[0].categories[0].sourceCategoryId &&
    x.mappingCompatibility.categoryIdCandidate!==null &&
    x.mappingCompatibility.slugCandidate!==null);
  assert.ok(other);
  const idDraft=one(1);
  submit(idDraft,idDraft.categories[0],"categoryId",other.sourceCategoryId);
  assert.throws(()=>validateCatalogCorrectionIntake(idDraft,review),/collides/);
  const slugDraft=one(1);
  submit(slugDraft,slugDraft.categories[0],"slug",
    other.mappingCompatibility.slugCandidate);
  assert.throws(()=>validateCatalogCorrectionIntake(slugDraft,review),/collides/);
});

test("two proposed replacements in one packet cannot reuse same ID or slug",()=>{
  const draft=one(1),[a,b]=draft.categories;
  submit(draft,a,"categoryId","new-reviewed-category-unique");
  submit(draft,b,"categoryId","new-reviewed-category-unique");
  assert.throws(()=>validateCatalogCorrectionIntake(draft,review),/collides/);
  const next=one(1),[x,y]=next.categories;
  submit(next,x,"slug","reviewed-unique-slug");
  submit(next,y,"slug","reviewed-unique-slug");
  assert.throws(()=>validateCatalogCorrectionIntake(next,review),/collides/);
});

test("only JODLO HTTPS PR or PR-comment URLs accepted, including old 17-category intake contract",()=>{
  assert.ok(validJodloReviewUrl("https://github.com/rekixo-lab/jodlo/pull/95"));
  assert.ok(validJodloReviewUrl(link));
  for(const url of [
    "http://github.com/rekixo-lab/jodlo/pull/95",
    "https://github.com/other/jodlo/pull/95",
    "https://github.com.evil.example/rekixo-lab/jodlo/pull/95",
    "https://github.com/rekixo-lab/jodlo/issues/95",
    "https://github.com/rekixo-lab/jodlo/pull/0",
    "https://github.com/rekixo-lab/jodlo/pull/95?token=secret",
    "javascript:alert(1)",
  ]){
    assert.equal(validJodloReviewUrl(url),false,url);
    const draft=one(1);
    submit(draft,draft.categories[0],"nameHi","नयी मरम्मत");
    draft.categories[0].evidenceUrl=url;
    assert.throws(()=>validateCatalogCorrectionIntake(draft,review),url);
  }
});
