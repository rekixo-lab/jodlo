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
  assert.match(feed,/repository\.searchCursor\(query, lang, limit = 20, after = after\)/);
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
