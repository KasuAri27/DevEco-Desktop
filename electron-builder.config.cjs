const { spawnSync } = require("node:child_process");
const path = require("node:path");

function copyBundledCliDependencies(context) {
  if (process.platform !== "win32") return;
  const source = path.join(__dirname, "bundled-runtime", "node_modules", "@deveco", "deveco-code", "node_modules");
  const destination = path.join(context.appOutDir, "resources", "node_modules", "@deveco", "deveco-code", "node_modules");
  const result = spawnSync("robocopy.exe", [source, destination, "/E", "/COPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], {
    windowsHide: true,
    stdio: "ignore",
  });
  if (result.error) throw result.error;
  if ((result.status ?? 16) >= 8) throw new Error(`Copying bundled devecocli dependencies failed (robocopy ${result.status}).`);
}

module.exports = {
  appId: "com.deveco.agentdesktop",
  productName: "DevEco Agent Desktop",
  artifactName: "DevEco-Agent-Desktop-${version}-${arch}.${ext}",
  directories: {
    output: "release",
    buildResources: "assets",
  },
  files: [
    "desktop/**/*",
    "assets/**/*",
    "index.html",
    "styles.css",
    "app.js",
    "management-ui-state.js",
    "model-policy.js",
    "package.json",
  ],
  extraResources: [
    {
      from: "bundled-runtime/node_modules/@deveco/deveco-code",
      to: "node_modules/@deveco/deveco-code",
    },
    {
      from: "bundled-runtime/node-runtime",
      to: "node",
      filter: ["**/*"],
    },
    {
      from: "bundled-runtime/NOTICE.md",
      to: "NOTICE-DevEco-runtime.md",
    },
  ],
  afterPack: copyBundledCliDependencies,
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  electronDist: "node_modules/electron/dist",
  win: {
    icon: "assets/deveco-agent.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "DevEco Agent Desktop",
    installerIcon: "assets/deveco-agent.ico",
    uninstallerIcon: "assets/deveco-agent.ico",
  },
};
