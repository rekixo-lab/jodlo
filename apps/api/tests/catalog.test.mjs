import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";
import { PUBLIC_CATEGORIES_QUERY } from "../src/modules/catalog/catalog.ts";

const request = (path, method = "GET") => new Request("https://jodlo.rekixo.com" + path, { method });
function fakeDb() {
  return {
    prepare(sql) {
      assert.equal(sql, PUBLIC_CATEGORIES_QUERY);
      return {
        bind(language) {
          assert.ok(["en", "hi"].includes(language));
          return {
            async all() {
              return { results: [{ id: "cat-1", slug: "plumbing", name: language === "hi" ? "प्लंबिंग" : "Plumbing" }] };
            },
          };
        },
      };
    },
  };
}

test("GET catalog exposes only projected public data and selected language", async () => {
  for (const language of ["en", "hi"]) {
    const response = await worker.fetch(request("/api/v1/catalog?lang=" + language), { DB: fakeDb() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true,
      data: { language, categories: [{ id: "cat-1", slug: "plumbing", name: language === "hi" ? "प्लंबिंग" : "Plumbing" }] },
    });
  }
});

test("defaults to English, rejects unexpected or repeated query parameters", async () => {
  const good = await worker.fetch(request("/api/v1/catalog"), { DB: fakeDb() });
  assert.equal((await good.json()).data.language, "en");
  for (const path of ["/api/v1/catalog?lang=xx", "/api/v1/catalog?lang=hi&lang=en", "/api/v1/catalog?debug=1", "/api/v1/catalog?lang="]) {
    const response = await worker.fetch(request(path), { DB: fakeDb() });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_QUERY");
  }
});

test("rejects writes and gracefully fails closed without a D1 binding", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await worker.fetch(request("/api/v1/catalog", method), { DB: fakeDb() });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
  }
  const missing = await worker.fetch(request("/api/v1/catalog"));
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" } });
  const failed = await worker.fetch(request("/api/v1/catalog"), {
    DB: { prepare() { throw Error("INTERNAL_DB_SECRET"); } },
  });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes("INTERNAL_DB_SECRET"), false);
});
