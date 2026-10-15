/*
 * Native account privacy adapter based on DevEco Code 0.2.3, commit
 * bbf950db3b6158f3488a2bfc08358a248339e7d8:
 *   src/security/local-crypto.ts (AES-GCM storage format)
 *   src/plugin/deveco/improvement-consent.ts (account/store format)
 *   packages/core/src/util/flock.ts (cross-process lock format)
 * Copyright (c) 2025 opencode
 * MIT License: Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including without
 * limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom
 * the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const revisionSecret = crypto.randomBytes(32);
const MAX_FILE_BYTES = 1024 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizePaths(paths) {
  if (!paths || !path.isAbsolute(paths.config || '') || !path.isAbsolute(paths.state || '')) {
    throw new Error('账号配置路径不可用');
  }
  return { config: path.resolve(paths.config), state: path.resolve(paths.state) };
}

async function readJson(file) {
  const info = await fs.stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('原生账号状态文件格式不受支持');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function decryptGcm(key, ivText, tagText, ciphertextText) {
  const iv = Buffer.from(ivText || '', 'base64');
  const tag = Buffer.from(tagText || '', 'base64');
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16 || typeof ciphertextText !== 'string') {
    throw new Error('原生凭据格式不受支持');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64')), decipher.final()]);
}

// Privileged runtime operation only. It never repairs, rewrites or deletes keys
// or credentials; decoded token/identity is never returned across renderer IPC.
async function currentIdentity(configDir) {
  const token = await readJson(path.join(configDir, 'token.enc'));
  const wrapped = await readJson(path.join(configDir, 'token.dek'));
  if (token.version !== 1 || token.algorithm !== 'aes-256-gcm' || wrapped.version !== 1 ||
      wrapped.algorithm !== 'aes-256-gcm' || !/^kek-v[123]$/.test(wrapped.kekId || '')) {
    throw new Error('原生凭据版本不受支持');
  }
  const kek = await fs.readFile(path.join(configDir, 'keys', wrapped.kekId + '.bin'));
  const dek = decryptGcm(kek, wrapped.iv, wrapped.authTag, wrapped.encryptedDek);
  try {
    const plaintext = decryptGcm(dek, token.iv, token.authTag, token.ciphertext);
    try {
      const part = plaintext.toString('utf8').split('.')[1];
      const payload = part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) : null;
      if (typeof payload?.userId !== 'string' || !payload.userId) throw new Error('无法识别当前账号');
      // This identifies the preference owner only; it does not validate login,
      // JWT signatures, expiry, real-name verification, or developer privileges.
      return payload.userId;
    } finally { plaintext.fill(0); }
  } finally { dek.fill(0); kek.fill(0); }
}

function identityRevision(config, userId) {
  return crypto.createHmac('sha256', revisionSecret).update(config + '\0' + userId).digest('hex');
}

function fingerprint(userId) {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

async function lastActivity(lockDir) {
  for (const relative of ['heartbeat', 'meta.json', '']) {
    try { return (await fs.stat(path.join(lockDir, relative))).mtimeMs; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

async function withStoreLock(state, filename, namespace, operation) {
  const file = path.join(state, filename);
  const locks = path.join(state, 'locks');
  const hash = crypto.createHash('sha1').update(namespace + file).digest('hex');
  const lockDir = path.join(locks, hash + '.lock');
  const breaker = lockDir + '.breaker';
  if (!lockDir.startsWith(path.resolve(state) + path.sep)) throw new Error('隐私锁路径无效');
  await fs.mkdir(locks, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 6000;
  const token = crypto.randomUUID();
  let owned = false;
  while (!owned) {
    try { await fs.mkdir(lockDir, { mode: 0o700 }); owned = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const activity = await lastActivity(lockDir);
      if (activity !== null && Date.now() - activity > 60_000) {
        let breakerOwned = false;
        try {
          await fs.mkdir(breaker, { mode: 0o700 });
          breakerOwned = true;
          const current = await lastActivity(lockDir);
          if (current !== null && Date.now() - current > 60_000) await fs.rm(lockDir, { recursive: true, force: true });
        } catch (claimError) {
          if (!['EEXIST', 'ENOENT'].includes(claimError.code)) throw claimError;
        } finally {
          if (breakerOwned) await fs.rm(breaker, { recursive: true, force: true });
        }
      }
      if (Date.now() >= deadline) throw new Error('原生隐私设置正在被其他进程更新，请重试');
      await delay(70);
    }
  }
  let heartbeat;
  try {
    await fs.writeFile(path.join(lockDir, 'heartbeat'), '', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(lockDir, 'meta.json'), JSON.stringify({ token, pid: process.pid, hostname: os.hostname(), createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    heartbeat = setInterval(() => {
      const now = new Date();
      fs.utimes(path.join(lockDir, 'heartbeat'), now, now).catch(() => {});
    }, 5000);
    heartbeat.unref();
    return await operation(file);
  } finally {
    clearInterval(heartbeat);
    const metadata = await readJson(path.join(lockDir, 'meta.json')).catch(() => null);
    if (metadata?.token === token) await fs.rm(lockDir, { recursive: true, force: true });
  }
}

const withNativeLock = (state, operation) => withStoreLock(state, 'improvement-consent.json', 'improvement-consent:', operation);

async function readConsent(file) {
  let data;
  try { data = await readJson(file); }
  catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, accounts: {} };
    throw new Error('原生隐私设置无法读取，已保留原文件');
  }
  if (data?.schemaVersion !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) {
    throw new Error('原生隐私设置版本或结构不受支持，已保留原文件');
  }
  return data;
}

function viewOf(entry, revision) {
  const decided = typeof entry?.granted === 'boolean' && Number.isFinite(entry?.at);
  return {
    available: true,
    granted: decided && entry.granted === true,
    decision: decided ? (entry.granted ? 'granted' : 'declined') : 'undecided',
    revision,
    source: 'native-account-preference',
  };
}

async function writeConsent(file, data) {
  const temp = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

async function getCurrentPrivacy(paths) {
  try {
    const { config, state } = normalizePaths(paths);
    const userId = await currentIdentity(config);
    const revision = identityRevision(config, userId);
    return await withNativeLock(state, async (file) => {
      const data = await readConsent(file);
      const owner = fingerprint(userId);
      // Match native one-time migration of an explicitly recorded old choice.
      // Missing/unreadable kv or missing toggle never implies consent.
      if (!data.accounts[owner] && !data.legacyClaimed) {
        const legacy = await readJson(path.join(state, 'kv.json')).catch(() => null);
        if (typeof legacy?.deveco_tool_improvement_enabled === 'boolean') {
          data.accounts[owner] = { granted: legacy.deveco_tool_improvement_enabled, at: Date.now() };
          data.legacyClaimed = true;
          await writeConsent(file, data);
        }
      }
      return viewOf(data.accounts[owner], revision);
    });
  } catch {
    return { available: false, granted: false, decision: 'unknown', source: 'native-account-preference', reason: '无法读取当前华为账号的原生隐私偏好。请登录后刷新；凭据或偏好文件异常时不会自动修复。' };
  }
}

async function setCurrentPrivacy(paths, granted, expectedRevision) {
  if (typeof granted !== 'boolean' || typeof expectedRevision !== 'string' || !expectedRevision) {
    throw new Error('请先刷新当前账号隐私状态，再保存明确的开关选择');
  }
  const { config, state } = normalizePaths(paths);
  const userId = await currentIdentity(config).catch(() => null);
  if (!userId || identityRevision(config, userId) !== expectedRevision) {
    throw new Error('账号状态已变化，请刷新隐私设置后重试');
  }
  return withNativeLock(state, async (file) => {
    // Recheck the owner after waiting for a native writer.
    const owner = await currentIdentity(config).catch(() => null);
    if (owner !== userId) throw new Error('账号状态已变化，隐私选择未保存');
    const data = await readConsent(file);
    data.accounts[fingerprint(userId)] = { granted, at: Date.now() };
    await writeConsent(file, data);
    return viewOf(data.accounts[fingerprint(userId)], expectedRevision);
  });
}

function deviceRevision(state, raw) {
  return crypto.createHmac('sha256', revisionSecret).update(state + '\0device\0' + raw).digest('hex');
}

async function readDeviceStore(file) {
  let raw;
  try {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('KV 状态过大');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('原生设备隐私偏好无法读取，原文件未改变');
    raw = '{}';
  }
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('原生 KV 状态格式无效，原文件未改变'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('原生 KV 状态格式无效，原文件未改变');
  return { raw, data };
}

function deviceView(state, raw, data) {
  return {
    available: true,
    analyticsEnabled: typeof data.analytics_enabled === 'boolean' ? data.analytics_enabled : true,
    crashUploadEnabled: typeof data.crash_upload_enabled === 'boolean' ? data.crash_upload_enabled : true,
    revision: deviceRevision(state, raw),
    source: 'native-device-preference',
  };
}

async function getDevicePrivacy(paths) {
  try {
    const { state } = normalizePaths(paths);
    // Native readers intentionally use a separate lock; the TUI owns its
    // writer lease for its lifetime and commits kv.json through atomic rename.
    return await withStoreLock(state, 'kv.json', 'privacy-kv:', async (file) => {
      const { raw, data } = await readDeviceStore(file);
      return deviceView(state, raw, data);
    });
  } catch {
    return { available: false, analyticsEnabled: null, crashUploadEnabled: null, source: 'native-device-preference', reason: '设备隐私偏好无法读取，请重试。原生 KV 文件不会被自动重置。' };
  }
}

async function setDevicePrivacy(paths, choice, expectedRevision) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || typeof expectedRevision !== 'string') {
    throw new Error('请先刷新设备隐私偏好再保存');
  }
  const keys = { analyticsEnabled: 'analytics_enabled', crashUploadEnabled: 'crash_upload_enabled' };
  const entries = Object.entries(choice);
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(keys, key) || typeof value !== 'boolean')) {
    throw new Error('只允许保存使用统计和崩溃报告的明确开关选择');
  }
  const { state } = normalizePaths(paths);
  // Coordinate with native TUI writers rather than only other privacy readers.
  return withStoreLock(state, 'kv.json', 'tui-kv:', async (file) => {
    const { raw, data } = await readDeviceStore(file);
    if (deviceRevision(state, raw) !== expectedRevision) throw new Error('原生设备设置已变化，请刷新后再保存');
    for (const [key, value] of entries) data[keys[key]] = value;
    await writeConsent(file, data);
    const updated = await readDeviceStore(file);
    return deviceView(state, updated.raw, updated.data);
  });
}

module.exports = { getCurrentPrivacy, setCurrentPrivacy, getDevicePrivacy, setDevicePrivacy };
