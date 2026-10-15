const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { getCurrentPrivacy, setCurrentPrivacy, getDevicePrivacy, setDevicePrivacy } = require('../desktop/native-privacy.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deveco-privacy-review-'));
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, config: path.join(root, 'config'), state: path.join(root, 'state') };
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  return { ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

// Fixture implements the native 0.2.3 wire/storage contract, not a real account.
async function seed(config, userId) {
  const kek = crypto.randomBytes(32);
  const dek = crypto.randomBytes(32);
  const token = 'fixture.' + Buffer.from(JSON.stringify({ userId, userName: 'Fixture user' })).toString('base64url') + '.fixture';
  const wrapped = encrypt(kek, dek);
  await fs.mkdir(path.join(config, 'keys'), { recursive: true });
  await fs.writeFile(path.join(config, 'keys', 'kek-v2.bin'), kek);
  await fs.writeFile(path.join(config, 'token.dek'), JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', kekId: 'kek-v2', encryptedDek: wrapped.ciphertext, iv: wrapped.iv, authTag: wrapped.authTag, timeStamp: Date.now() }));
  await fs.writeFile(path.join(config, 'token.enc'), JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', ...encrypt(dek, Buffer.from(token)), timeStamp: Date.now() }));
  return token;
}

function fp(userId) { return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16); }

test('missing credentials fail closed without creating credential files', async (t) => {
  const paths = await fixture(t);
  const view = await getCurrentPrivacy(paths);
  assert.equal(view.available, false);
  assert.equal(view.granted, false);
  assert.equal(view.decision, 'unknown');
  assert.equal(await fs.stat(paths.config).then(() => true).catch(() => false), false);
});

test('native encrypted identity and per-account consent round-trip without exposing identity', async (t) => {
  const paths = await fixture(t);
  const identity = 'fixture-user-1000000001';
  const token = await seed(paths.config, identity);
  const initial = await getCurrentPrivacy(paths);
  assert.equal(initial.available, true);
  assert.equal(initial.decision, 'undecided');
  assert.equal(initial.granted, false);
  const saved = await setCurrentPrivacy(paths, true, initial.revision);
  assert.equal(saved.decision, 'granted');
  assert.equal((await getCurrentPrivacy(paths)).granted, true);
  const raw = await fs.readFile(path.join(paths.state, 'improvement-consent.json'), 'utf8');
  assert.equal(JSON.parse(raw).accounts[fp(identity)].granted, true);
  assert.equal(raw.includes(identity), false);
  assert.equal(raw.includes(token), false);
  assert.equal(JSON.stringify(saved).includes(identity), false);
  assert.equal(saved.revision.includes(fp(identity)), false);
});

test('saving preserves unrelated account records and native migration metadata', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-owner');
  await fs.mkdir(paths.state, { recursive: true });
  const original = { schemaVersion: 1, accounts: { [fp('another-fixture-account')]: { granted: true, at: 12 } }, legacyClaimed: true, extraFutureMetadata: 'preserve-me' };
  await fs.writeFile(path.join(paths.state, 'improvement-consent.json'), JSON.stringify(original));
  const view = await getCurrentPrivacy(paths);
  await setCurrentPrivacy(paths, false, view.revision);
  const actual = JSON.parse(await fs.readFile(path.join(paths.state, 'improvement-consent.json'), 'utf8'));
  assert.deepEqual(actual.accounts[fp('another-fixture-account')], original.accounts[fp('another-fixture-account')]);
  assert.equal(actual.legacyClaimed, original.legacyClaimed);
  assert.equal(actual.extraFutureMetadata, original.extraFutureMetadata);
  assert.equal(actual.accounts[fp('fixture-owner')].granted, false);
});

test('stale UI revision cannot write a different account after account switching', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-first-account');
  const view = await getCurrentPrivacy(paths);
  await seed(paths.config, 'fixture-second-account');
  await assert.rejects(setCurrentPrivacy(paths, true, view.revision), /账号状态已变化/);
  assert.equal(await fs.stat(path.join(paths.state, 'improvement-consent.json')).then(() => true).catch(() => false), false);
});

test('malformed encryption keys are never repaired, replaced or deleted by read', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-account');
  const keyPath = path.join(paths.config, 'keys', 'kek-v2.bin');
  await fs.writeFile(keyPath, Buffer.from('damaged-key'));
  const before = await Promise.all(['token.enc', 'token.dek', 'keys/kek-v2.bin'].map((file) => fs.readFile(path.join(paths.config, file))));
  assert.equal((await getCurrentPrivacy(paths)).available, false);
  const after = await Promise.all(['token.enc', 'token.dek', 'keys/kek-v2.bin'].map((file) => fs.readFile(path.join(paths.config, file))));
  assert.deepEqual(after, before);
  assert.equal(await fs.stat(path.join(paths.config, 'keys', 'kek-v1.bin')).then(() => true).catch(() => false), false);
});

test('unknown consent schema cannot be downgraded or silently overwritten', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-account');
  const initial = await getCurrentPrivacy(paths);
  await fs.mkdir(paths.state, { recursive: true });
  const file = path.join(paths.state, 'improvement-consent.json');
  const unknown = '{"schemaVersion":2,"accounts":{},"important":"preserve"}';
  await fs.writeFile(file, unknown);
  assert.equal((await getCurrentPrivacy(paths)).available, false);
  await assert.rejects(setCurrentPrivacy(paths, false, initial.revision), /版本或结构不受支持/);
  assert.equal(await fs.readFile(file, 'utf8'), unknown);
});

test('concurrent account writes use the native shared lock without losing other records', async (t) => {
  const paths = await fixture(t);
  const first = { config: path.join(paths.root, 'account-a'), state: paths.state };
  const second = { config: path.join(paths.root, 'account-b'), state: paths.state };
  await Promise.all([seed(first.config, 'fixture-user-a'), seed(second.config, 'fixture-user-b')]);
  const [a, b] = await Promise.all([getCurrentPrivacy(first), getCurrentPrivacy(second)]);
  await Promise.all([setCurrentPrivacy(first, true, a.revision), setCurrentPrivacy(second, false, b.revision)]);
  const data = JSON.parse(await fs.readFile(path.join(paths.state, 'improvement-consent.json'), 'utf8'));
  assert.equal(data.accounts[fp('fixture-user-a')].granted, true);
  assert.equal(data.accounts[fp('fixture-user-b')].granted, false);
});

test('the reader waits for an active lock in native Flock format', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-account');
  const file = path.join(path.resolve(paths.state), 'improvement-consent.json');
  const hash = crypto.createHash('sha1').update('improvement-consent:' + file).digest('hex');
  const lock = path.join(paths.state, 'locks', hash + '.lock');
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, 'meta.json'), JSON.stringify({ token: 'fixture-native-owner' }));
  await fs.writeFile(path.join(lock, 'heartbeat'), '');
  let finished = false;
  const read = getCurrentPrivacy(paths).then((value) => { finished = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(finished, false);
  await fs.rm(lock, { recursive: true, force: true });
  assert.equal((await read).available, true);
});

test('native explicit legacy choice is migrated once and never inherited by another account', async (t) => {
  const paths = await fixture(t);
  await seed(paths.config, 'fixture-legacy-owner');
  await fs.mkdir(paths.state, { recursive: true });
  await fs.writeFile(path.join(paths.state, 'kv.json'), JSON.stringify({ deveco_tool_improvement_enabled: true }));
  assert.equal((await getCurrentPrivacy(paths)).decision, 'granted');
  const stored = JSON.parse(await fs.readFile(path.join(paths.state, 'improvement-consent.json'), 'utf8'));
  assert.equal(stored.legacyClaimed, true);
  await seed(paths.config, 'fixture-new-account');
  const second = await getCurrentPrivacy(paths);
  assert.equal(second.decision, 'undecided');
  assert.equal(second.granted, false);
});

test('device privacy works without a Huawei identity and preserves unrelated native KV', async (t) => {
  const paths = await fixture(t);
  const initial = await getDevicePrivacy(paths);
  assert.equal(initial.available, true);
  assert.equal(initial.analyticsEnabled, true);
  assert.equal(initial.crashUploadEnabled, true);
  await fs.writeFile(path.join(paths.state, 'kv.json'), JSON.stringify({ unrelated: { value: 'preserve-private-value' }, analytics_enabled: true }));
  const before = await getDevicePrivacy(paths);
  const result = await setDevicePrivacy(paths, { analyticsEnabled: false, crashUploadEnabled: false }, before.revision);
  assert.equal(result.analyticsEnabled, false);
  assert.equal(result.crashUploadEnabled, false);
  assert.equal(JSON.stringify(result).includes('preserve-private-value'), false);
  const stored = JSON.parse(await fs.readFile(path.join(paths.state, 'kv.json'), 'utf8'));
  assert.deepEqual(stored.unrelated, { value: 'preserve-private-value' });
  assert.equal((await getCurrentPrivacy(paths)).available, false);
});

test('stale device revision and corrupt KV cannot overwrite native preferences', async (t) => {
  const paths = await fixture(t);
  const before = await getDevicePrivacy(paths);
  const file = path.join(paths.state, 'kv.json');
  await fs.writeFile(file, '{"unrelated":"changed by native writer"}');
  await assert.rejects(setDevicePrivacy(paths, { analyticsEnabled: false }, before.revision), /设置已变化/);
  assert.equal(await fs.readFile(file, 'utf8'), '{"unrelated":"changed by native writer"}');
  await fs.writeFile(file, '{corrupt');
  assert.equal((await getDevicePrivacy(paths)).available, false);
  await assert.rejects(setDevicePrivacy(paths, { analyticsEnabled: false }, before.revision));
  assert.equal(await fs.readFile(file, 'utf8'), '{corrupt');
});

test('device writes coordinate with the native TUI writer lease', async (t) => {
  const paths = await fixture(t);
  const view = await getDevicePrivacy(paths);
  const file = path.join(path.resolve(paths.state), 'kv.json');
  const hash = crypto.createHash('sha1').update('tui-kv:' + file).digest('hex');
  const lock = path.join(paths.state, 'locks', hash + '.lock');
  await fs.mkdir(lock, { recursive: true });
  await fs.writeFile(path.join(lock, 'meta.json'), JSON.stringify({ token: 'fixture-tui-writer' }));
  await fs.writeFile(path.join(lock, 'heartbeat'), '');
  let finished = false;
  const write = setDevicePrivacy(paths, { analyticsEnabled: false }, view.revision).then((value) => { finished = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(finished, false);
  await fs.rm(lock, { recursive: true, force: true });
  assert.equal((await write).analyticsEnabled, false);
});
