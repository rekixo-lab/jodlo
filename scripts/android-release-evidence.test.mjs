import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

test("unsigned AAB evidence verifies structure, secret/path rejection and repeated payload integrity",()=>{
  const script=fileURLToPath(new URL("./android-release-evidence.py",import.meta.url));
  const result=spawnSync("python3",[script,"--self-test"],{encoding:"utf8",maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.match(result.stderr,/Ran 7 tests/);
});
