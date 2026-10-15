(function attachModelPolicy(root) {
  const DEFAULT_MODEL = "deveco/GLM-5.3";
  const providers = Object.freeze([
    { key: "deveco", name: "DevEco", ids: ["deveco"], logo: "./assets/huawei.svg" },
    { key: "deepseek", name: "DeepSeek", ids: ["deepseek"], logo: "./assets/providers/deepseek.svg", keyUrl: "https://platform.deepseek.com/api_keys" },
    { key: "qwen", name: "通义千问", ids: ["alibaba-cn", "alibaba"], logo: "./assets/providers/qwen.svg", keyUrl: "https://bailian.console.aliyun.com/" },
    { key: "zhipu", name: "智谱 GLM", ids: ["zhipuai", "zai"], logo: "./assets/providers/zhipu.svg", keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys" },
    { key: "moonshot", name: "月之暗面 Kimi", ids: ["moonshotai-cn", "moonshotai"], logo: "./assets/providers/moonshot.svg", keyUrl: "https://platform.moonshot.cn/console/api-keys" },
    { key: "xiaomi", name: "小米 MiMo", ids: ["xiaomi"], logo: "./assets/providers/xiaomi.svg", keyUrl: "https://platform.xiaomimimo.com/" },
  ]);
  const blocked = (id) => /^ollama(?:$|[-_])/i.test(String(id ?? ""));
  const providerId = (value) => String(value ?? "").split("/", 1)[0];
  const brand = (id) => providers.find((item) => item.ids.includes(id)) ?? null;

  function modelName(option) {
    const value = String(option?.value ?? "");
    const name = String(option?.name ?? value);
    const separator = name.indexOf("/");
    return separator >= 0 ? name.slice(separator + 1) : name;
  }

  function buildCatalog(data, authEntries, configProviders) {
    const connected = new Set(data?.connected ?? []);
    const credentials = new Set((authEntries ?? []).map((entry) => entry.providerID));
    const custom = new Set(Object.entries(configProviders ?? {})
      .filter(([id, item]) => !blocked(id) && !brand(id) && item?.npm === "@ai-sdk/openai-compatible")
      .map(([id]) => id));
    const all = (data?.all ?? []).filter((item) => {
      if (!item?.id || blocked(item.id)) return false;
      if (item.id === "deveco") return true;
      return (brand(item.id) || custom.has(item.id)) && (connected.has(item.id) || credentials.has(item.id));
    }).map((item) => ({ ...item, displayName: brand(item.id)?.name ?? item.name ?? item.id }));
    const allowedProviderIDs = all.map((item) => item.id);
    return { all, allowedProviderIDs, defaultModel: DEFAULT_MODEL };
  }

  function providerOrder(left, right, names = {}) {
    const leftRank = providers.indexOf(brand(left));
    const rightRank = providers.indexOf(brand(right));
    const order = (leftRank < 0 ? providers.length : leftRank) - (rightRank < 0 ? providers.length : rightRank);
    return order || String(names[left] ?? left).localeCompare(String(names[right] ?? right), "zh-CN", { numeric: true }) || left.localeCompare(right);
  }

  function filterConfigOptions(configOptions, catalog) {
    const allowed = new Set(catalog?.allowedProviderIDs ?? ["deveco"]);
    return (Array.isArray(configOptions) ? configOptions : []).map((option) => {
      if (!(option?.category === "model" || option?.id === "model" || option?.configId === "model")) return option;
      return { ...option, options: (option.options ?? []).filter((item) => !blocked(providerId(item.value)) && allowed.has(providerId(item.value))) };
    });
  }

  function isAvailable(value, catalog) {
    const id = providerId(value);
    if (blocked(id)) return false;
    const provider = catalog?.all?.find((item) => item.id === id);
    const key = String(value ?? "").slice(id.length + 1);
    const models = Array.isArray(provider?.models) ? provider.models : Object.entries(provider?.models ?? {}).map(([modelId, model]) => ({ id: modelId, ...model }));
    return Boolean(provider && models.some((model) => model.id === key));
  }

  function preferredValue(options, preferred = DEFAULT_MODEL) {
    const available = Array.isArray(options) ? options : [];
    const exact = available.find((option) => String(option.value).toLowerCase() === String(preferred).toLowerCase());
    if (exact) return exact.value;
    const builtin = available.find((option) => String(option.value).toLowerCase() === DEFAULT_MODEL.toLowerCase());
    if (builtin) return builtin.value;
    return available.slice().sort((left, right) => providerOrder(providerId(left.value), providerId(right.value)))[0]?.value ?? null;
  }

  const api = Object.freeze({ DEFAULT_MODEL, providers, blocked, providerId, brand, modelName, buildCatalog, providerOrder, filterConfigOptions, isAvailable, preferredValue });
  root.devecoModelPolicy = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
