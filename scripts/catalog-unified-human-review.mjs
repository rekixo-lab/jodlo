/**
 * ADR-0011 unified OFFLINE review queue joining all original Categories,
 * Service labels and occupational scopes. No automated legal classification,
 * reviewer authentication, alias import, SQL generation or public activation.
 */
import {lstatSync,readFileSync,readdirSync,realpathSync} from "node:fs";
import {dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedReviewPackets,parsePacketArg} from "./catalog-review-packets.mjs";
import {loadPinnedFullCategoryServiceEvidence} from "./catalog-service-evidence-packets.mjs";
import {loadPinnedCategoryExceptionRegister} from "./catalog-review-exception-register.mjs";
import {
  reconcileCatalogCorrectionPackets,emptyCatalogCorrectionPacketSet,
  loadCatalogCorrectionDirectory,
} from "./catalog-cross-packet-reconcile.mjs";
import {
  reconcileServiceCorrectionPackets,emptyServiceCorrectionPacketSet,
  loadServiceCorrectionDirectory,
} from "./catalog-service-cross-packet-reconcile.mjs";
import {
  makeServiceScopePacket,validateServiceScopePacket,
} from "./catalog-service-scope-intake.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const COUNT=45;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const submitted=x=>x.status==="EVIDENCE_LINKED_UNVERIFIED";
const SOURCE="31303a2af70cdb64186b974194d2cb1a0b068bfdd79a8ac03f5532174f4c3375";
const PENDING="HUMAN_EDITORIAL_OCCUPATIONAL_LEGAL_AND_FOUNDER_REVIEW_REQUIRED";

/** Reuse existing per-stream strict validators; never trust an input's flags,
 * status, names, scope fingerprints, source lineage or proposed D1 IDs.
 */
export function reconcileUnifiedHumanReview(inputs,context){
  const {categoryPackets,serviceNamePackets,serviceScopePackets}=inputs??{};
  const {review,full,exceptions}=context??{};
  if(!Array.isArray(categoryPackets)||categoryPackets.length!==COUNT||
    !Array.isArray(serviceNamePackets)||serviceNamePackets.length!==COUNT||
    !Array.isArray(serviceScopePackets)||serviceScopePackets.length!==COUNT||
    review?.manifest?.kind!=="JODLO_ALL_CATEGORY_REVIEW_PACKET_MANIFEST_ONLY"||
    full?.manifest?.kind!=="JODLO_ALL_889_FULL_SERVICE_PACKET_MANIFEST_ONLY"||
    exceptions?.kind!=="JODLO_ALL_889_REVIEW_EXCEPTION_REGISTER_ONLY"||
    [review.manifest.sourceJsonSha256,full.manifest.sourceJsonSha256,
      exceptions.sourceJsonSha256].some(x=>x!==SOURCE)||
    JSON.stringify(exceptions.languages)!=='["en","hi"]'||
    exceptions.state!=="DIAGNOSTICS_NOT_LEGAL_OR_EDITORIAL_APPROVAL"||
    exceptions.summary?.historicalCategories!==889||
    exceptions.summary?.historicalServices!==7267||
    exceptions.summary?.deskUnassessedCategories!==872||
    exceptions.summary?.categoriesAuthorizedForActivation!==0||
    !Array.isArray(exceptions.packets)||exceptions.packets.length!==COUNT)
    throw Error("Missing, altered or authorizing unified review source");
  const mapped=reconcileCatalogCorrectionPackets(categoryPackets,review);
  const names=reconcileServiceCorrectionPackets(serviceNamePackets,full);
  if(mapped.categoriesAuthorizedForActivation!==0||
    names.summary.categoriesAuthorizedForActivation!==0||
    names.summary.activatedServices!==0)throw Error("Unexpected activation in review");
  const conflictByCategory=new Map();
  for(const conflict of names.unresolvedPhraseConflicts){
    for(const id of new Set([
      ...conflict.proposedSourceCategoryIds,
      ...conflict.sourceCategoryIdsWithOriginalPhrase,
    ])){
      if(!conflictByCategory.has(id))conflictByCategory.set(id,[]);
      conflictByCategory.get(id).push({
        locale:conflict.locale,normalizedPhrase:conflict.normalizedPhrase,
        unresolvedReasons:conflict.unresolvedReasons,
        proposedServiceReferences:conflict.proposedServiceReferences,
      });
    }
  }

  let serviceCount=0,catCount=0,scopeDrafts=0,bilingualDrafts=0;
  let scopeOnly=0,nameOnly=0,paired=0,categoryDrafts=0;
  let categoriesWithAnyDraft=0,categoriesWithScopeConcerns=0;
  const categoryIds=new Set(),serviceIds=new Set(),packets=[];
  for(let i=0;i<COUNT;i++){
    const source=full.packets[i],diff=exceptions.packets[i];
    const namePacket=serviceNamePackets[i],scopePacket=serviceScopePackets[i];
    const categoryPacket=categoryPackets[i];
    if(source.packetNumber!==i+1||diff.packetNumber!==i+1||
      categoryPacket.packetNumber!==i+1||
      namePacket.packetNumber!==i+1||scopePacket.packetNumber!==i+1||
      source.categories.length!==diff.categories.length||
      source.categories.length!==categoryPacket.categories.length||
      source.categories.length!==namePacket.categories.length||
      source.categories.length!==scopePacket.categories.length)
      throw Error("Review streams have different packet order or Category coverage");
    const scopeSummary=validateServiceScopePacket(scopePacket,full);
    if(scopeSummary.categoriesAuthorizedForActivation!==0||
      scopeSummary.servicesAuthorizedForActivation!==0)
      throw Error("Service scope validation authorized a Service");
    let packetServices=0,packetNameDrafts=0,packetScopeDrafts=0;
    const categories=source.categories.map((sourceCat,j)=>{
      const diagnostic=diff.categories[j];
      const mapping=categoryPacket.categories[j];
      const namesCat=namePacket.categories[j];
      const scopeCat=scopePacket.categories[j];
      const id=sourceCat.sourceCategoryId;
      if(categoryIds.has(id)||[diagnostic.sourceCategoryId,
        mapping.sourceCategoryId,namesCat.sourceCategoryId,
        scopeCat.sourceCategoryId].some(x=>x!==id)||
        diagnostic.packetNumber!==i+1||
        diagnostic.totalHistoricalServices!==sourceCat.services.length||
        diagnostic.reviewState!==
          "HUMAN_LANGUAGE_SAFETY_MAPPING_AND_FOUNDER_REVIEW_PENDING"||
        diagnostic.categoriesAuthorizedForActivation!==0||
        sourceCat.services.length!==namesCat.services.length||
        sourceCat.services.length!==scopeCat.services.length)
        throw Error("Category cross-stream join failed: missing or moved source row");
      categoryIds.add(id);catCount++;
      const isMappingDraft=submitted(mapping);
      categoryDrafts+=Number(isMappingDraft);
      let namesSubmitted=0,scopesSubmitted=0,unpairedNames=0,unpairedScopes=0;
      let concernRows=0,concernCount=0;
      const handoff=[];
      for(const [k,sourceLeaf] of sourceCat.services.entries()){
        const name=namesCat.services[k],scope=scopeCat.services[k];
        const sid=sourceLeaf.sourceServiceId;
        if(serviceIds.has(sid)||name.sourceServiceId!==sid||
          scope.sourceServiceId!==sid||
          name.historicalNameEn!==sourceLeaf.historicalNameEn||
          name.historicalNameHi!==sourceLeaf.historicalNameHi||
          scope.historicalNameEn!==sourceLeaf.historicalNameEn||
          scope.historicalNameHi!==sourceLeaf.historicalNameHi||
          JSON.stringify(name.sourceFlags)!==JSON.stringify(sourceLeaf.sourceFlags)||
          JSON.stringify(scope.sourceFlags)!==JSON.stringify(sourceLeaf.sourceFlags)||
          JSON.stringify(name.otherSourceCategoryChoices)!==
            JSON.stringify(sourceLeaf.otherSourceCategoryChoices)||
          JSON.stringify(scope.otherSourceCategoryChoices)!==
            JSON.stringify(sourceLeaf.otherSourceCategoryChoices))
          throw Error("Service cross-stream join failed: source fingerprint or ID mismatch");
        serviceIds.add(sid);serviceCount++;packetServices++;
        const naming=submitted(name),scoping=submitted(scope);
        namesSubmitted+=Number(naming);scopesSubmitted+=Number(scoping);
        packetNameDrafts+=Number(naming);packetScopeDrafts+=Number(scoping);
        bilingualDrafts+=Number(naming);scopeDrafts+=Number(scoping);
        if(naming&&scoping)paired++;
        if(naming&&!scoping){nameOnly++;unpairedNames++;}
        if(scoping&&!naming){scopeOnly++;unpairedScopes++;}
        if(scoping&&scope.concernCodes.length){
          concernRows++;concernCount+=scope.concernCodes.length;
        }
        if(naming||scoping){
          handoff.push({
            sourceServiceId:sid,
            nameDraftStatus:name.status,scopeDraftStatus:scope.status,
            unresolvedConcernCodes:scope.concernCodes.slice(),
            outstandingChecks:[
              ...(naming&&!scoping?["OCCUPATIONAL_SCOPE_DRAFT_MISSING"]:[]),
              ...(scoping&&!naming?["SERVICE_NAME_DRAFT_MISSING_OR_NOT_REQUIRED_REVIEW"]:[]),
              ...(scope.concernCodes.length?["QUALIFIED_SPECIALIST_REVIEW_REQUIRED"]:[]),
            ],
            nameEvidenceUrlUnverified:name.evidenceUrl,
            scopeEvidenceUrlUnverified:scope.evidenceUrl,
            reviewState:PENDING,
          });
        }
      }
      const unresolvedNameConflicts=(conflictByCategory.get(id)??[])
        .slice().sort((a,b)=>cmp(a.locale,b.locale)||
          cmp(a.normalizedPhrase,b.normalizedPhrase));
      const checks=[
        ...diagnostic.issues.map(x=>x.code),
        ...(isMappingDraft?["CATEGORY_MAPPING_OR_TITLE_PROPOSAL_UNVERIFIED"]:[]),
        ...(unpairedNames?["SERVICE_NAMES_WITHOUT_SCOPE_DRAFTS"]:[]),
        ...(unpairedScopes?["SERVICE_SCOPES_WITHOUT_NAME_DRAFTS"]:[]),
        ...(concernRows?["SERVICE_SPECIALIST_CONCERNS_SUBMITTED"]:[]),
        ...(unresolvedNameConflicts.length?["CROSS_CATEGORY_PHRASE_CONFLICT"]:[]),
      ];
      if(isMappingDraft||namesSubmitted||scopesSubmitted)categoriesWithAnyDraft++;
      if(concernRows)categoriesWithScopeConcerns++;
      return {
        packetNumber:i+1,sourceCategoryId:id,
        sourceGroupId:sourceCat.sourceGroupId,
        sourceFamilyId:sourceCat.sourceFamilyId,
        historicalNameEn:sourceCat.historicalNameEn,
        historicalNameHi:sourceCat.historicalNameHi,
        historicalSafetyTierNotAnAuthorization:sourceCat.historicalSafetyTier,
        deskReviewOnly:diagnostic.deskReviewOnly,
        sourceServiceCount:sourceCat.services.length,
        categoryMappingDraftStatus:mapping.status,
        categoryMappingProposalUnverified:isMappingDraft?
          mapping.proposedCorrections:null,
        categoryMappingEvidenceUrlUnverified:mapping.evidenceUrl,
        serviceNameDraftsUnverified:namesSubmitted,
        serviceScopeDraftsUnverified:scopesSubmitted,
        serviceNamesWithoutScopeDrafts:unpairedNames,
        serviceScopesWithoutNameDrafts:unpairedScopes,
        serviceScopeConcernRowsUnverified:concernRows,
        serviceScopeConcernCodesUnverified:concernCount,
        sourceDiagnostics:diagnostic.issues,
        combinedHumanReviewChecks:[...new Set(checks)].sort(cmp),
        unresolvedProposedNameConflicts:unresolvedNameConflicts,
        submittedServiceReviewHandoff:handoff,
        stillRequiresHumanReview:true,
        reviewState:PENDING,
        categoriesAuthorizedForActivation:0,
      };
    });
    packets.push({packetNumber:i+1,categoryCount:categories.length,
      serviceCount:packetServices,
      categoryMappingDraftsUnverified:categories.filter(c=>
        c.categoryMappingDraftStatus==="EVIDENCE_LINKED_UNVERIFIED").length,
      serviceNameDraftsUnverified:packetNameDrafts,
      serviceScopeDraftsUnverified:packetScopeDrafts,categories});
  }
  if(catCount!==889||categoryIds.size!==889||serviceCount!==7267||
    serviceIds.size!==7267||scopeDrafts!==serviceScopePackets.reduce((n,p)=>
      n+p.categories.reduce((m,c)=>m+c.services.filter(submitted).length,0),0)||
    bilingualDrafts!==names.summary.submittedServiceEvidenceLinksUnverified||
    categoryDrafts!==mapped.evidenceLinksUnverified)
    throw Error("Combined all-trade coverage or cross-stream tallies lost");
  return {
    kind:"JODLO_ALL_CATEGORY_SERVICE_JOINT_HUMAN_REVIEW_QUEUE_ONLY",
    state:"UNVERIFIED_EVIDENCE_ZERO_AUTHORIZATION",
    sourceJsonSha256:SOURCE,languages:["en","hi"],
    summary:{
      packetsValidated:45,historicalCategories:catCount,
      historicalServices:serviceCount,deskAssessedCategories:17,
      deskUnassessedCategories:872,
      categoryMappingDraftsUnverified:categoryDrafts,
      serviceNameDraftsUnverified:bilingualDrafts,
      serviceScopeDraftsUnverified:scopeDrafts,
      serviceNameAndScopeDraftsBothSubmitted:paired,
      serviceNameDraftsMissingScopeDraft: nameOnly,
      serviceScopeDraftsMissingNameDraft:scopeOnly,
      categoriesWithAnyUnverifiedDraft:categoriesWithAnyDraft,
      categoriesWithUnverifiedScopeConcerns:categoriesWithScopeConcerns,
      unresolvedCrossCategoryNamePhraseKeys:
        names.summary.totalUnresolvedPhraseKeys,
      allCategoriesStillRequiringQualifiedReview:889,
      allServicesStillRequiringQualifiedReview:7267,
      qualifiedLegalReviewsAuthenticated:0,
      qualifiedOccupationalReviewsAuthenticated:0,
      humanBilingualReviewsAuthenticated:0,
      founderCategoryApprovalsAuthenticated:0,
      approvedCategoryIds:0,approvedAliases:0,
      categoriesAuthorizedForActivation:0,
      servicesAuthorizedForActivation:0,sqlStatementsGenerated:0,
    },
    packets,
  };
}

export function emptyUnifiedReviewInputs(review,full){
  return {
    categoryPackets:emptyCatalogCorrectionPacketSet(review),
    serviceNamePackets:emptyServiceCorrectionPacketSet(full),
    serviceScopePackets:Array.from({length:COUNT},(_,i)=>
      makeServiceScopePacket(full,i+1)),
  };
}
function boundedReviewDirectory(root){
  if(!root||isAbsolute(root))throw Error("Need repo-relative review root");
  const path=resolve(ROOT,root),rel=relative(ROOT,path);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||isAbsolute(rel))
    throw Error("Review root must be inside repository");
  const realRoot=realpathSync(ROOT),actual=realpathSync(path);
  if(actual===realRoot||!actual.startsWith(realRoot+sep)||
    !lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())
    throw Error("Unsafe review root or symlink");
  const names=readdirSync(path).sort();
  if(JSON.stringify(names)!==JSON.stringify(
    ["category","service-name","service-scope"]))
    throw Error("Review root requires exactly category, service-name, service-scope");
  return root;
}
function scopeDirectory(relativeRoot){
  const path=resolve(ROOT,relativeRoot,"service-scope");
  const realRoot=realpathSync(ROOT),actual=realpathSync(path);
  if(actual===realRoot||!actual.startsWith(realRoot+sep)||
    !lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())
    throw Error("Unsafe Service scope review directory");
  const wanted=Array.from({length:COUNT},(_,i)=>
    "scope-packet-"+String(i+1).padStart(2,"0")+".json");
  if(JSON.stringify(readdirSync(path).sort())!==JSON.stringify(wanted))
    throw Error("Exactly 45 original Service scope review files required");
  return wanted.map(name=>{
    const file=resolve(path,name),stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_500_000)
      throw Error("Unsafe/oversized Service scope review file");
    const real=realpathSync(file);
    if(!real.startsWith(actual+sep))
      throw Error("Service scope file escapes original review directory");
    return JSON.parse(readFileSync(file,"utf8"));
  });
}
export function loadUnifiedReviewDirectory(root){
  const path=boundedReviewDirectory(root);
  return {
    categoryPackets:loadCatalogCorrectionDirectory(path+"/category"),
    serviceNamePackets:loadServiceCorrectionDirectory(path+"/service-name"),
    serviceScopePackets:scopeDirectory(path),
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [arg,...rest]=process.argv.slice(2);
  if(rest.length||!["--check","--summary","--all"].includes(arg??"--check")&&
    !(arg??"").startsWith("--packet=")&&!(arg??"").startsWith("--category=")&&
    !(arg??"").startsWith("--review-root="))
    throw Error("Use --check, --summary, --all, --packet=N, --category=ID or --review-root=PATH");
  const review=loadPinnedReviewPackets(),full=loadPinnedFullCategoryServiceEvidence();
  const exceptions=loadPinnedCategoryExceptionRegister();
  const inputs=arg?.startsWith("--review-root=")?
    loadUnifiedReviewDirectory(arg.slice("--review-root=".length)):
    emptyUnifiedReviewInputs(review,full);
  const report=reconcileUnifiedHumanReview(inputs,{review,full,exceptions});
  if(arg===undefined||arg==="--check")
    console.log("JODLO unified 45-packet/889 Category/7,267 Service human queue: ZERO approval.");
  else if(arg==="--summary")
    process.stdout.write(JSON.stringify(report.summary,null,2)+"\n");
  else if(arg==="--all"||arg.startsWith("--review-root="))
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
  else if(arg.startsWith("--packet=")){
    const n=parsePacketArg(arg,COUNT);
    process.stdout.write(JSON.stringify(report.packets[n-1],null,2)+"\n");
  }else if(arg.startsWith("--category=")){
    const id=arg.slice("--category=".length);
    const row=report.packets.flatMap(p=>p.categories).find(c=>c.sourceCategoryId===id);
    if(!row)throw Error("Unknown original source Category");
    process.stdout.write(JSON.stringify(row,null,2)+"\n");
  }
}
