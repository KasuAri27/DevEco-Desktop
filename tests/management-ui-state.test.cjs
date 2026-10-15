const test = require("node:test");
const assert = require("node:assert/strict");
const uiState = require("../management-ui-state.js");

test("updated agreements re-enable explicit consent even when older acceptance is stored", () => {
  const agreement = { accepted: true, upload: { state: "review_required" } };
  assert.deepEqual(uiState.agreement(agreement, false), {
    reviewRequired: true,
    accepted: false,
    needsConsent: true,
    canSubmit: false,
  });
  assert.equal(uiState.agreement(agreement, true).canSubmit, true);
});

test("accepted current agreements keep consent submission disabled", () => {
  const result = uiState.agreement({ accepted: true, upload: { state: "accepted" } }, true);
  assert.equal(result.accepted, true);
  assert.equal(result.needsConsent, false);
  assert.equal(result.canSubmit, false);
});

test("ACP model and thought-level options follow the flat source contract", () => {
  const sourceFixture = [
    { id: "model", category: "model", currentValue: "anthropic/claude-sonnet", options: [
      { value: "anthropic/claude-sonnet", name: "Anthropic / Claude Sonnet" },
    ] },
    { id: "effort", category: "thought_level", currentValue: "default", options: [
      { value: "max", name: "Maximum" },
      { value: "high", name: "High" },
      { value: "default", name: "Default" },
      { value: "medium", name: "Medium" },
      { value: "low", name: "Low" },
      { value: "ultra", name: "Ultra" },
      { value: "extra-high", name: "Extra High" },
    ] },
  ];
  const selected = uiState.acpOptions(sourceFixture);
  assert.equal(selected.model.currentValue, "anthropic/claude-sonnet");
  assert.equal(selected.effort.id, "effort");
  const effort = uiState.effortOptions(selected.effort);
  assert.deepEqual(effort.options.map((option) => option.value), ["default", "low", "medium", "high", "extra-high", "max", "ultra"]);
  assert.equal(effort.defaultIndex, 0);
  assert.equal(effort.highestIndex, 6);
  assert.equal(effort.disabled, false);
  const xhighAlias = uiState.effortOptions({ options: ["max", "xhigh", "extra-high"] });
  assert.deepEqual(xhighAlias.options.map((option) => option.value), ["xhigh", "extra-high", "max"]);
});

test("models without ACP thought-level variants disable the effort slider", () => {
  const effort = uiState.effortOptions({ id: "effort", category: "thought_level", options: [] });
  assert.deepEqual(effort.options, []);
  assert.equal(effort.disabled, true);
  assert.equal(effort.highestIndex, -1);
});
