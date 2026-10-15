const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  redactText,
  sanitizeProviderSummary,
  findProjectConfigFile,
  parseProjectConfig,
  applyConfigPatch,
  removeConfigValue,
  evaluateSetupReadiness,
  isCustomOpenAIProviderAllowed,
  accountSessionState,
  resolveNodeExecutable,
  prependExecutableDirectory,
  removeDisabledProvider,
} = require("../desktop/control-plane.cjs");

test("diagnostic redaction removes Basic credentials and common API key prefixes", () => {
  const output = redactText("Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l sk-proj-abcdefghijklmno sk-ant-abcdefghijklmnop");
  assert.doesNotMatch(output, /YWx[a-zA-Z0-9+/=]{8}/);
  assert.doesNotMatch(output, /sk-(?:proj-|ant-)/);
  assert.doesNotMatch(output, /Authorization: Basic\s+YWx/);
  assert.match(output, /\[redacted\]/);
});

test("project configuration writes remain inside the selected workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-project-path-"));
  try {
    const selected = path.join(root, "empty-project");
    await fs.mkdir(selected);
    await fs.writeFile(path.join(root, "deveco.jsonc"), "{\"model\":\"parent/model\"}\n");
    assert.equal(findProjectConfigFile(selected), path.join(selected, "deveco.jsonc"));
    await fs.writeFile(path.join(selected, "deveco.json"), "{}\n");
    assert.equal(findProjectConfigFile(selected), path.join(selected, "deveco.json"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("selected Node path takes precedence and project re-add clears only its own disabled entry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deveco-node-selection-"));
  try {
    const selectedNode = path.join(root, "selected-node.exe");
    await fs.writeFile(selectedNode, "fixture");
    assert.equal(resolveNodeExecutable(selectedNode), selectedNode);
    const env = prependExecutableDirectory({ PATH: `C:\\Tools${path.delimiter}${path.dirname(selectedNode)}` }, selectedNode);
    assert.equal(env.PATH.split(path.delimiter)[0], path.dirname(selectedNode));
    assert.equal(env.PATH.split(path.delimiter).length, 2, "selected Node directory is prepended once");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(removeDisabledProvider(["anthropic", "sample", "openai"], "sample"), ["anthropic", "openai"]);
  assert.equal(removeDisabledProvider(undefined, "sample"), null);
});

test("JSONC patch preserves config semantics and removes a legacy API key", () => {
  const before = "{\n  // user's provider\n  \"provider\": {\n    \"sample\": {\n      \"npm\": \"@ai-sdk/openai-compatible\",\n      \"options\": { \"apiKey\": \"fixture-only-secret\", \"baseURL\": \"https://example.test/v1\" }\n    }\n  }\n}\n";
  const changed = applyConfigPatch(before, { provider: { sample: { name: "Sample" } } });
  const withoutKey = removeConfigValue(changed, ["provider", "sample", "options", "apiKey"]);
  const parsed = parseProjectConfig(withoutKey);
  assert.equal(parsed.provider.sample.name, "Sample");
  assert.equal(parsed.provider.sample.options.baseURL, "https://example.test/v1");
  assert.equal(Object.hasOwn(parsed.provider.sample.options, "apiKey"), false);
  assert.match(withoutKey, /\/\/ user's provider/);
});

test("renderer provider summaries expose only a legacy-key presence flag", () => {
  const summary = sanitizeProviderSummary("sample", {
    name: "Sample",
    npm: "@ai-sdk/openai-compatible",
    options: { apiKey: "fixture-only-secret", baseURL: "https://example.test/v1" },
    models: {},
  });
  assert.equal(summary.legacyConfigApiKeyPresent, true);
  assert.equal(JSON.stringify(summary).includes("fixture-only-secret"), false);
  assert.equal(Object.hasOwn(summary, "apiKey"), false);
});

test("custom OpenAI-compatible editor cannot overwrite native catalog SDKs", () => {
  const catalog = new Set(["anthropic", "openai", "custom-api"]);
  assert.equal(isCustomOpenAIProviderAllowed("anthropic", null, catalog), false);
  assert.equal(isCustomOpenAIProviderAllowed("anthropic", { npm: "@ai-sdk/anthropic" }, catalog), false);
  assert.equal(isCustomOpenAIProviderAllowed("custom-api", { npm: "@ai-sdk/openai-compatible" }, catalog), true);
  assert.equal(isCustomOpenAIProviderAllowed("new-api", null, catalog), true);
});

test("cached Huawei metadata is not reported expired without an explicit expiry signal", () => {
  const metadata = { loggedIn: true, realName: "recorded-verified" };
  assert.equal(accountSessionState(metadata, { status: "not-confirmed", loggedIn: false }), "cached-unverified");
  assert.equal(accountSessionState(metadata, { status: "expired", loggedIn: false }), "expired");
  assert.equal(accountSessionState(metadata, { status: "valid", loggedIn: true }), "valid");
  assert.equal(accountSessionState({ loggedIn: false }, { status: "not-confirmed", loggedIn: false }), "signed-out");
});

test("onboarding accepts a configured third-party model without Huawei login", () => {
  const result = evaluateSetupReadiness({
    workspace: "D:\\workspace",
    environment: { items: [
      { id: "node", label: "Node.js", available: true, compatibility: "compatible" },
      { id: "agent", label: "DevEco Code Agent", available: true, compatibility: "detected" },
      { id: "cli", label: "devecocli", available: true, compatibility: "detected" },
    ] },
    providers: {
      connected: ["anthropic"],
      all: [{ id: "anthropic", models: { "claude-sonnet": { name: "Claude Sonnet" } } }],
    },
    auth: [{ providerID: "anthropic", type: "api" }],
    config: { model: "anthropic/claude-sonnet" },
    account: { loggedIn: false, realName: "unknown" },
    identity: { status: "not-confirmed" },
    agreement: { accepted: true },
  });
  assert.equal(result.ready, true);
  assert.equal(result.remoteModelRequestSent, false);
});

test("onboarding requires current consent for a configured DevEco model", () => {
  const result = evaluateSetupReadiness({
    workspace: "D:\\workspace",
    environment: { items: [
      { id: "node", label: "Node.js", available: true, compatibility: "compatible" },
      { id: "agent", label: "DevEco Code Agent", available: true, compatibility: "detected" },
      { id: "cli", label: "devecocli", available: true, compatibility: "detected" },
    ] },
    providers: { connected: ["deveco"], all: [{ id: "deveco", models: { "model-v1": { name: "Model" } } }] },
    auth: [{ providerID: "deveco", type: "oauth" }],
    config: { model: "deveco/model-v1" },
    account: { loggedIn: true, realName: "recorded-verified" },
    identity: { status: "valid" },
    agreement: { accepted: true, upload: { state: "review_required" } },
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.code === "agreement"));
});
