const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { AcpClient } = require("../desktop/acp-client.cjs");
const { isolatedRuntimeEnv } = require("./helpers/isolated-env.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const DEVECO_EXECUTABLE = "D:\\Dev\\tool\\npm\\node_modules\\@deveco\\deveco-code\\node_modules\\@deveco\\deveco-code-windows-x64\\bin\\deveco.exe";

test("real ACP exposes source model/effort options and resumes only when declared", async (t) => {
  try { await fs.access(DEVECO_EXECUTABLE); }
  catch {
    t.skip("installed DevEco Code 0.2.3 binary is unavailable");
    return;
  }

  const workspace = path.resolve(APP_ROOT, ".tmp-acp-contract-" + process.pid + "-" + crypto.randomBytes(5).toString("hex"));
  assert.ok(workspace.startsWith(APP_ROOT + path.sep), "temporary ACP workspace must stay under the project workspace");
  await fs.mkdir(workspace, { recursive: true });
  const isolated = path.join(workspace, ".isolated-runtime");
  const environment = isolatedRuntimeEnv(isolated);
  await fs.mkdir(path.dirname(environment.DEVECO_MODELS_PATH), { recursive: true });
  await fs.writeFile(environment.DEVECO_MODELS_PATH, "{}");
  await fs.mkdir(environment.XDG_STATE_HOME, { recursive: true });
  await fs.writeFile(path.join(environment.XDG_STATE_HOME, "kv.json"), JSON.stringify({
    analytics_enabled: false,
    crash_upload_enabled: false,
  }));
  await fs.writeFile(path.join(workspace, "deveco.jsonc"), JSON.stringify({
    model: "desktop-acp-fixture/variant-model",
    provider: {
      "desktop-acp-fixture": {
        name: "Temporary ACP Fixture",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://example.invalid/v1", apiKey: "fixture-key-never-sent" },
        models: {
          "variant-model": {
            name: "Variant Fixture",
            limit: { context: 8192, output: 1024 },
            variants: { default: {}, low: {}, high: {} },
          },
          "plain-model": {
            name: "Plain Fixture",
            limit: { context: 4096, output: 512 },
          },
        },
      },
    },
  }, null, 2));

  let client = new AcpClient(DEVECO_EXECUTABLE, workspace, { env: environment, pureMode: true });
  let resumedClient = null;
  try {
    const session = await client.connect();
    const model = session.configOptions.find((option) => option.id === "model" || option.category === "model");
    assert.ok(model, "ACP must return its model config option");
    const modelValues = model.options.map((option) => option.value);
    assert.ok(modelValues.includes("desktop-acp-fixture/variant-model"));
    assert.ok(modelValues.includes("desktop-acp-fixture/plain-model"));

    let changed = await client.setConfigOption("model", "desktop-acp-fixture/plain-model");
    assert.equal(changed.configOptions.find((option) => option.id === "model").currentValue, "desktop-acp-fixture/plain-model");
    assert.equal(changed.configOptions.some((option) => option.category === "thought_level" || option.id === "effort"), false);

    changed = await client.setConfigOption("model", "desktop-acp-fixture/variant-model");
    const effort = changed.configOptions.find((option) => option.id === "effort" || option.category === "thought_level");
    assert.ok(effort, "switching model must refresh the thought-level option");
    assert.deepEqual(effort.options.map((option) => option.value), ["default", "low", "high"]);
    changed = await client.setConfigOption("effort", "high");
    assert.equal(changed.configOptions.find((option) => option.id === "effort").currentValue, "high");

    const canLoadSession = session.agentCapabilities?.loadSession === true;
    const sessionId = session.sessionId;
    await client.stop();
    if (canLoadSession) {
      resumedClient = new AcpClient(DEVECO_EXECUTABLE, workspace, { env: environment, pureMode: true, resumeSessionId: sessionId });
      const resumed = await resumedClient.connect();
      assert.equal(resumed.sessionId, sessionId);
    }
    assert.equal(Boolean(client.activePrompt), false, "the test must not send prompts or models requests");
    t.diagnostic(`loadSession capability declared: ${canLoadSession}`);
  } catch (error) {
    const diagnostics = client?.getDiagnostics?.() ?? [];
    error.message += "\nRedacted ACP diagnostics: " + JSON.stringify(diagnostics);
    throw error;
  } finally {
    await client.stop();
    await resumedClient?.stop();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
