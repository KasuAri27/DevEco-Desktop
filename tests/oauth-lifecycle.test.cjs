const test = require("node:test");
const assert = require("node:assert/strict");
const { SingleOAuthGate, clearLateAuthorization } = require("../desktop/oauth-lifecycle.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("one Desktop OAuth reservation blocks every concurrent provider while authorize is pending", () => {
  const gate = new SingleOAuthGate();
  const flow = { providerID: "anthropic", status: "authorizing", cancelRequested: false };
  gate.reserve(flow);
  assert.throws(() => gate.reserve({ providerID: "deveco" }), /已有 Provider 授权流程/);
  assert.throws(() => gate.assertUnlocked("保存配置"), /授权进行中/);
  gate.release(flow);
  assert.doesNotThrow(() => gate.reserve({ providerID: "deveco" }));
});

test("a deferred management save holds the shared lease and rejects OAuth start", async () => {
  const gate = new SingleOAuthGate();
  const write = deferred();
  const lease = gate.beginManagementMutation("保存配置");
  const save = (async () => {
    try {
      await write.promise;
    } finally {
      gate.endManagementMutation(lease);
    }
  })();
  assert.throws(() => gate.reserve({ providerID: "deveco" }), /正在保存管理设置/);
  write.resolve();
  await save;
  assert.doesNotThrow(() => gate.reserve({ providerID: "deveco" }));
});

test("cancel during a deferred authorize request cancels again when its response arrives", async () => {
  const gate = new SingleOAuthGate();
  const flow = { providerID: "deveco", status: "authorizing", cancelRequested: false };
  gate.reserve(flow);
  const response = deferred();
  let coreCancelCount = 0;
  let callbackStarted = false;
  const pendingAuthorization = (async () => {
    const authorization = await response.promise;
    if (await clearLateAuthorization(flow, async () => { coreCancelCount += 1; })) {
      gate.release(flow);
      return { cancelled: true, authorizationMethod: authorization.method };
    }
    callbackStarted = true;
    return { cancelled: false };
  })();

  gate.requestCancel(flow);
  await clearLateAuthorization(flow, async () => { coreCancelCount += 1; });
  assert.equal(gate.isActive(), true, "keep the gate until the in-flight authorize request settles");
  response.resolve({ method: "auto", url: "" });
  const result = await pendingAuthorization;
  assert.deepEqual(result, { cancelled: true, authorizationMethod: "auto" });
  assert.equal(coreCancelCount, 2, "cancel before and after the late authorize response");
  assert.equal(callbackStarted, false, "a late authorize response must not start its callback");
  assert.equal(gate.isActive(), false);
});
