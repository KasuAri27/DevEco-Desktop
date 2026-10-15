const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ControlPlane } = require("../desktop/control-plane.cjs");
const { isolatedRuntimeEnv } = require("./helpers/isolated-env.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const DEVECO_EXECUTABLE = "D:\\Dev\\tool\\npm\\node_modules\\@deveco\\deveco-code\\node_modules\\@deveco\\deveco-code-windows-x64\\bin\\deveco.exe";

test("real DevEco Code 0.2.3 project config writes a recognized JSONC file and reads it back", async (t) => {
  try { await fs.access(DEVECO_EXECUTABLE); }
  catch {
    t.skip("installed DevEco Code 0.2.3 binary is unavailable");
    return;
  }

  const workspace = path.resolve(APP_ROOT, ".tmp-contract-smoke-" + process.pid + "-" + crypto.randomBytes(5).toString("hex"));
  assert.ok(workspace.startsWith(APP_ROOT + path.sep), "temporary test root must stay under the project workspace");
  await fs.mkdir(workspace, { recursive: true });
  const envRoot = path.join(workspace, ".isolated-runtime");
  const environment = isolatedRuntimeEnv(envRoot);
  await fs.mkdir(path.dirname(environment.DEVECO_MODELS_PATH), { recursive: true });
  await fs.writeFile(environment.DEVECO_MODELS_PATH, "{}");
  const control = new ControlPlane(DEVECO_EXECUTABLE, { cwd: workspace, environment, pureMode: true });
  try {
    await control.start();
    const paths = await control.request("/path");
    for (const key of ["config", "state"]) {
      const resolved = path.resolve(paths?.[key] ?? "");
      assert.ok(resolved.startsWith(path.resolve(envRoot) + path.sep), `isolated ${key} path must stay under the temporary root`);
    }
    const auth = await control.getAuthMetadata();
    assert.equal(auth.length, 0, "isolated test auth store must begin empty");
    await control.request("/global/config", { method: "PATCH", body: { username: "global-fixture" } });
    const result = await control.patchProjectConfig(workspace, { username: "project-fixture" });
    const project = await control.request("/config?directory=" + encodeURIComponent(workspace));
    const global = await control.request("/global/config");
    assert.equal(result.fields.username, "project-fixture");
    assert.equal(project.username, "project-fixture");
    assert.equal(global.username, "global-fixture");
    await assert.rejects(fs.access(path.join(workspace, "config.json")));
    assert.ok((await fs.readFile(path.join(workspace, "deveco.jsonc"), "utf8")).includes("project-fixture"));

    const providerID = "desktop-fixture-" + process.pid;
    const providerInput = {
      id: providerID,
      name: "Temporary Provider Fixture",
      baseURL: "https://example.invalid/v1",
      modelId: "fixture-model",
      modelName: "Fixture Model",
      contextLimit: 8192,
      outputLimit: 1024,
      supportsTools: "false",
      apiKey: "fixture-key-never-sent",
    };
    await control.addOrEditProvider(providerInput, "project", workspace);
    let authMetadata = await control.getAuthMetadata();
    assert.ok(authMetadata.some((entry) => entry.providerID === providerID && entry.type === "api"));
    assert.equal(JSON.stringify(authMetadata).includes("fixture-key-never-sent"), false);
    await control.removeProvider(providerID, "project", workspace);
    assert.equal((await control.getProviders(workspace)).all.some((entry) => entry.id === providerID), false);
    await control.addOrEditProvider(providerInput, "project", workspace);
    assert.equal((await control.getProviders(workspace)).all.some((entry) => entry.id === providerID), true);
    await control.removeCredential(providerID);
    assert.equal((await control.getAuthMetadata()).length, 0, "the test must not create or change credentials");
  } finally {
    await control.stop();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
