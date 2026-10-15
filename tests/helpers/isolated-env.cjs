const path = require("node:path");

const SAFE_WINDOWS_ENV = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "ComSpec", "COMSPEC"];

function isolatedRuntimeEnv(root) {
  const env = {};
  for (const key of SAFE_WINDOWS_ENV) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEVECO_AUTH_CONTENT|DEVECO_CONFIG(?:_CONTENT|_DIR)?|DEVECO_MODELS(?:_URL|_PATH)?|DEVECO_DISABLE_MODELS_FETCH|DEVECO_DISABLE_AUTOUPDATE|OPENCODE_)/i.test(key)) continue;
    if (/(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SECRET|PASSWORD|CREDENTIAL|_TOKEN)$/i.test(key)) continue;
    if (/^(OPENAI|ANTHROPIC|AZURE|AWS|GOOGLE|HUGGINGFACE|HF_|GITHUB)_/i.test(key) &&
        /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) continue;
    if (["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DEVECO_HOME", "DEVECO_SDK_HOME", "DEVECO_EXECUTABLE", "DEVECO_BIN_PATH", "NODE_OPTIONS"].includes(key.toUpperCase())) continue;
    env[key] = value;
  }
  env.XDG_CONFIG_HOME = path.join(root, "config");
  env.XDG_DATA_HOME = path.join(root, "data");
  env.XDG_CACHE_HOME = path.join(root, "cache");
  env.XDG_STATE_HOME = path.join(root, "state");
  env.DEVECO_TEST_HOME = root;
  env.DEVECO_PURE = "1";
  env.DEVECO_CLI_DISABLE_TELEMETRY = "1";
  env.DEVECO_DISABLE_MODELS_FETCH = "1";
  env.DEVECO_DISABLE_AUTOUPDATE = "1";
  env.DEVECO_MODELS_PATH = path.join(root, "models.json");
  return env;
}

module.exports = { isolatedRuntimeEnv };
