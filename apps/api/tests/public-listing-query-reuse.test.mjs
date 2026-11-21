import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  PUBLIC_LISTING_ELIGIBILITY, PUBLIC_LISTINGS_QUERY,
  PAGED_PUBLIC_LISTINGS_QUERY, CONTINUED_PUBLIC_LISTINGS_QUERY,
  PUBLIC_LISTING_DETAIL_QUERY, PUBLIC_APPROVED_SERVICE_DETAIL_QUERY,
  PAGED_ALL_PUBLIC_LISTINGS_QUERY, CONTINUED_ALL_PUBLIC_LISTINGS_QUERY,
} from "../src/modules/workers/listings.ts";
import {AVAILABLE_PUBLIC_CATEGORIES_QUERY} from "../src/modules/catalog/catalog.ts";

test("all public customer discovery queries share one authoritative eligibility", () => {
  const queries = [
    PUBLIC_LISTINGS_QUERY, PAGED_PUBLIC_LISTINGS_QUERY,
    CONTINUED_PUBLIC_LISTINGS_QUERY, PUBLIC_LISTING_DETAIL_QUERY,
    PUBLIC_APPROVED_SERVICE_DETAIL_QUERY,
    PAGED_ALL_PUBLIC_LISTINGS_QUERY, CONTINUED_ALL_PUBLIC_LISTINGS_QUERY,
    AVAILABLE_PUBLIC_CATEGORIES_QUERY,
  ];
  for (const query of queries) {
    assert.ok(query.includes(PUBLIC_LISTING_ELIGIBILITY), "Missing visibility rule");
    for (const required of [
      "JOIN accounts AS a ON a.id=wl.worker_account_id",
      "JOIN worker_profiles AS wp ON wp.account_id=a.id",
      "JOIN categories AS c ON c.id=wl.category_id",
    ]) assert.ok(query.includes(required), "Missing current DB join: " + required);
  }
  const source = readFileSync(new URL("../src/modules/workers/listings.ts", import.meta.url), "utf8");
  assert.equal(source.split("FROM worker_listings AS wl JOIN accounts AS a ON a.id=wl.worker_account_id").length - 1, 1,
    "Do not copy/paste public DB joins between browse, detail, and cursor paths");
});
