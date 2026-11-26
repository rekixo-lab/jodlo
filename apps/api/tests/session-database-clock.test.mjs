import assert from 'node:assert/strict';
import test from 'node:test';
import {openLocalDatabase} from './helpers/local-db.mjs';
import {handleRequest} from '../src/http/router.ts';
import {
  findSessionAccount, issueSession, sessionHash, revokeSession, revokeAllSessions,
  OWN_SESSION_QUERY, INSERT_BOUNDED_SESSION_QUERY, REVOKE_SESSION_QUERY,
  REVOKE_ALL_SESSIONS_QUERY, MAX_ACTIVE_SESSIONS,
} from '../src/modules/identity/sessions.ts';
import {OWN_DRAFT_QUERY} from '../src/modules/workers/profile.ts';
import {
  readOwnWorkerAgoraCallPreference, setOwnWorkerAgoraCallPreference,
  READ_OWN_AGORA_CALL_PREFERENCE_QUERY, INSERT_AGORA_CALL_PREFERENCE_QUERY,
  UPDATE_AGORA_CALL_PREFERENCE_QUERY,
} from '../src/modules/workers/agora-call-preference.ts';

const owner = 'database-clock-owner';

/** Advance SQLite's execution clock without sleeping or changing the session
 * row. This models a queued statement crossing natural expiry after binding
 * its application timestamp, which explicit expires_at=1 races cannot cover. */
async function fixture() {
  const f = openLocalDatabase();
  const start = Math.floor(Date.now() / 1000);
  let clock = start;
  f.db.function('unixepoch', () => clock);
  f.db.prepare('INSERT INTO accounts(id) VALUES(?)').run(owner);
  f.db.prepare('INSERT INTO worker_profiles(account_id) VALUES(?)').run(owner);
  const token = (await issueSession(f.adapter, owner)).accessToken;
  const hash = await sessionHash(token);
  const expires = start + 60;
  f.db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(expires, hash);
  return {...f, token, hash, start, expires, expire: () => { clock = expires; }};
}

function beforeSql(adapter, matches, before) {
  let executions = 0;
  return {
    ...adapter,
    get executions() { return executions; },
    prepare(query) {
      const statement = adapter.prepare(query);
      if (matches(query)) for (const method of ['all', 'run']) {
        const execute = statement[method].bind(statement);
        statement[method] = async () => {
          executions++;
          before();
          return execute();
        };
      }
      return statement;
    },
  };
}

test('a queued session lookup rejects natural expiry at database execution time', async () => {
  const f = await fixture();
  try {
    assert.equal(await findSessionAccount(f.adapter, f.token), owner);
    const queued = beforeSql(f.adapter, q => q === OWN_SESSION_QUERY, f.expire);
    assert.equal(await findSessionAccount(queued, f.token), null);
    assert.equal(queued.executions, 1);
    assert.equal(f.db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').get(f.hash).expires_at, f.expires);
  } finally { f.db.close(); }
});

test('the final HTTP session guard suppresses an already captured private row when its SQL queue crosses expiry', async () => {
  const f = await fixture();
  try {
    let captured = false, finalChecks = 0;
    const queued = {...f.adapter, prepare(query) {
      const statement = f.adapter.prepare(query), execute = statement.all.bind(statement);
      statement.all = async () => {
        if (query === OWN_SESSION_QUERY && captured) { finalChecks++; f.expire(); }
        const result = await execute();
        if (query === OWN_DRAFT_QUERY) captured = true;
        return result;
      };
      return statement;
    }};
    const response = await handleRequest(new Request('https://jodlo.example/api/v1/me/worker-profile', {
      headers: {Authorization: 'Bearer ' + f.token},
    }), {DB: queued});
    assert.equal(captured, true);
    assert.equal(finalChecks, 1);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {ok: false, error: {code: 'UNAUTHORIZED', message: 'Authentication required'}});
  } finally { f.db.close(); }
});

for (const [name, query, revoke] of [
  ['single session', REVOKE_SESSION_QUERY, revokeSession],
  ['all owner sessions', REVOKE_ALL_SESSIONS_QUERY, revokeAllSessions],
]) test('natural expiry cannot authorize queued revocation of ' + name, async () => {
  const f = await fixture();
  try {
    const second = (await issueSession(f.adapter, owner)).accessToken;
    const queued = beforeSql(f.adapter, q => q.startsWith(query), f.expire);
    assert.equal(await revoke(queued, f.token), false);
    assert.equal(queued.executions, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 2);
    assert.equal(await findSessionAccount(f.adapter, second), owner);
  } finally { f.db.close(); }
});

for (const revision of [0, 1]) test('natural expiry blocks a queued call-consent ' + (revision ? 'update' : 'insert'), async () => {
  const f = await fixture();
  try {
    if (revision) f.db.prepare('INSERT INTO worker_agora_call_preferences VALUES(?,1,1)').run(owner);
    const before = f.db.prepare('SELECT * FROM worker_agora_call_preferences').all();
    const query = revision ? UPDATE_AGORA_CALL_PREFERENCE_QUERY : INSERT_AGORA_CALL_PREFERENCE_QUERY;
    const queued = beforeSql(f.adapter, q => q.startsWith(query), f.expire);
    assert.deepEqual(await setOwnWorkerAgoraCallPreference(queued, f.token, !revision, revision), {kind: 'denied'});
    assert.equal(queued.executions, 1);
    assert.deepEqual(f.db.prepare('SELECT * FROM worker_agora_call_preferences').all(), before);
  } finally { f.db.close(); }
});

test('a queued call-consent read does not disclose the preference after natural expiry', async () => {
  const f = await fixture();
  try {
    f.db.prepare('INSERT INTO worker_agora_call_preferences VALUES(?,1,1)').run(owner);
    const queued = beforeSql(f.adapter, q => q === READ_OWN_AGORA_CALL_PREFERENCE_QUERY, f.expire);
    assert.equal(await readOwnWorkerAgoraCallPreference(queued, f.token), null);
    assert.equal(queued.executions, 1);
  } finally { f.db.close(); }
});

test('sessions that naturally expire while login is queued no longer occupy its active-session cap', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i < MAX_ACTIVE_SESSIONS; i++) {
      f.db.prepare('INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)')
        .run(String(i).repeat(64), owner, f.expires);
    }
    const queued = beforeSql(f.adapter, q => q === INSERT_BOUNDED_SESSION_QUERY, f.expire);
    const issued = await issueSession(queued, owner);
    assert.ok(issued);
    assert.equal(queued.executions, 1);
    assert.equal(await findSessionAccount(f.adapter, issued.accessToken), owner);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at>unixepoch()').get().n, 1);
  } finally { f.db.close(); }
});

test('bounded expiry cleanup also uses the database clock rather than its older bound timestamp', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 105; i++) {
      f.db.prepare('INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)')
        .run(i.toString(16).padStart(64, '0'), owner, f.expires);
    }
    f.expire();
    assert.ok(await issueSession(f.adapter, owner));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at<=unixepoch()').get().n, 6);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at>unixepoch()').get().n, 1);
  } finally { f.db.close(); }
});
