import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const feed = readFileSync(new URL(
  "../apps/android/app/src/main/java/com/rekixo/jodlo/PublicServicesFeed.kt", import.meta.url
), "utf8");
const repo = readFileSync(new URL(
  "../apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloRepositories.kt", import.meta.url
), "utf8");
const routes = readFileSync(new URL(
  "../apps/android/core/src/main/kotlin/com/rekixo/jodlo/core/network/JodloApiCore.kt", import.meta.url
), "utf8");

test("Nearby Search is an explicit approved-category lookup and city+trade selection, never owner search", () => {
  assert.match(feed,/JodloSearchField\(/);
  assert.match(feed,/onClick = \{ searchCategories\(\) \}/);
  assert.match(feed,/if \(city == null\) repository\.searchCursor\(query, lang, limit = 20, after = after\)/);
  assert.match(feed,/else repository\.citySearchCursor\(query, lang, city, limit = 20, after = after\)/);
  assert.match(repo,/JodloRoutes\.searchCursor\(query, language, availableOnly = true,/);
  assert.match(routes,/if \(city != null\) p \+= "city=\$\{city\.wire\}"/);
  assert.match(feed,/onClick = \{\s*filterNames = filterNames \+ \(category\.id to category\.name\)\s*changeScope\(language, category\.id\)/);
  assert.match(feed,/repository\.localizedPublicListings\(lang, after = after, categoryId = filter, city = city\)/);
  assert.match(repo,/JodloRoutes\.publicAllListingPage\(limit, after, language, categoryId, city\)/);
  assert.match(routes,/if \(city != null\) "&city=\$\{city\.wire\}"/);
  assert.doesNotMatch(feed,/contactsRepository\.search|searchWorkersByName|client\.searchWorkers/);
});

test("City and language changes invalidate page/search generations and current detail evidence", () => {
  assert.match(feed,/LaunchedEffect\(repository, city\) \{\s*leaveDetail\(\)\s*clearCategorySearch\(\)/);
  assert.match(feed,/fun clearCategorySearch\(\) \{\s*categorySearchRevision\+\+/);
  assert.match(feed,/if \(categorySearchRevision != generation \|\| language != lang \|\|\s*selected != null\)/);
  assert.match(feed,/fun changeScope\(nextLanguage: Language, nextCategory: String\?\) \{[\s\S]*?clearCategorySearch\(\)/);
  assert.match(feed,/if \(current != revision \|\| language != lang \|\| categoryFilter != filter\)/);
  assert.match(feed,/repository\.reviewedServiceDetail\(row\.id, row\.categoryId, lang, city\)/);
  assert.match(feed,/CustomerServiceCard\.publicWhenChecked\(selectedListing, language, verified\)/);
});

test("Customer city trade Browse is an explicit no-query public-only page and never a GPS/Worker search",()=>{
  const catalog=readFileSync(new URL(
    "../apps/api/src/modules/catalog/catalog.ts",import.meta.url),"utf8");
  assert.match(feed,/fun loadCityCategories\(after: String\? = null\)/);
  assert.match(feed,/repository\.cityBrowse\(lang, selectedCity, limit = 20, after = after\)/);
  assert.match(feed,/generation != cityBrowseRevision \|\| city != selectedCity/);
  assert.match(feed,/resetCityBrowse\(\)/);
  assert.match(feed,/R\.string\.nearby_browse_city_categories/);
  assert.match(feed,/R\.string\.nearby_city_no_categories/);
  assert.match(feed,/R\.string\.nearby_city_categories_failed/);
  assert.match(repo,/fun cityBrowse\(language: Language, city: NearbyPilotCity/);
  assert.match(routes,/city: NearbyPilotCity\? = null\): ApiCall/);
  assert.match(catalog,/function browsePageSql\(availableOnly: boolean, hasCursor: boolean,\s*city:ServiceCity\|null=null\)/);
  assert.match(catalog,/cityEligibleCategoryExists\("categories",city\)/);
  assert.match(catalog,/currentAnchorSql\(availableOnly,0,city\)/);
  assert.match(catalog,/cityRaw !== null && \(availability !== "1" \|\| limitRaw === null/);
  for(const lang of ["values","values-hi"]){
    const xml=readFileSync(new URL("../apps/android/app/src/main/res/"+lang+"/strings.xml",
      import.meta.url),"utf8");
    for(const key of ["nearby_browse_city_categories","nearby_refresh_city_categories",
      "nearby_hide_city_categories","nearby_city_categories_heading",
      "nearby_city_category_disclosure","nearby_city_no_categories",
      "nearby_city_categories_failed"])assert.match(xml,new RegExp('name="'+key+'"'));
  }
  assert.doesNotMatch(feed,/requestLocation|LocationManager|ACCESS_FINE_LOCATION/);
});
