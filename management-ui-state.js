(function attachManagementState(root) {
  const state = Object.freeze({
    agreement(agreement, consentChecked = false) {
      const reviewRequired = agreement?.upload?.state === "review_required";
      const accepted = agreement?.accepted === true && !reviewRequired;
      return {
        reviewRequired,
        accepted,
        needsConsent: Boolean(agreement) && !accepted,
        canSubmit: Boolean(agreement) && !accepted && consentChecked,
      };
    },
    acpOptions(configOptions) {
      const options = Array.isArray(configOptions) ? configOptions : [];
      return {
        model: options.find((option) => option?.category === "model" || option?.id === "model" || option?.configId === "model") ?? null,
        effort: options.find((option) => option?.category === "thought_level" || option?.id === "effort" || /effort|think/i.test(option?.id ?? option?.configId ?? "")) ?? null,
        mode: options.find((option) => option?.category === "mode" || option?.id === "mode" || option?.configId === "mode") ?? null,
      };
    },
    effortOptions(configOption) {
      const source = Array.isArray(configOption?.options) ? configOption.options : [];
      const effortRank = new Map([
        ["default", -1], ["auto", -1], ["minimal", 0], ["low", 1], ["medium", 2],
        ["high", 3], ["xhigh", 4], ["extra-high", 4], ["extrahigh", 4], ["max", 5], ["ultra", 6],
      ]);
      const options = source.map((option, sourceIndex) => {
        const value = typeof option === "string" ? option : String(option?.value);
        const normalized = value.toLocaleLowerCase();
        return {
          value,
          label: normalized === "default" || normalized === "auto"
            ? "自动"
            : (typeof option === "string" ? option : option?.name ?? option?.label ?? value),
          sourceIndex,
          rank: effortRank.has(normalized) ? effortRank.get(normalized) : null,
        };
      }).sort((left, right) => {
        if (left.rank !== null && right.rank !== null) return left.rank - right.rank;
        if (left.rank !== null) return -1;
        if (right.rank !== null) return 1;
        return left.sourceIndex - right.sourceIndex;
      });
      const defaultIndex = options.findIndex((option) => ["default", "auto"].includes(option.value.toLocaleLowerCase()));
      const knownStrength = options.reduce((best, option, index) => option.rank !== null && option.rank >= 0 ? index : best, -1);
      const currentIndex = options.findIndex((option) => String(option.value) === String(configOption?.currentValue));
      return {
        options,
        defaultIndex: defaultIndex >= 0 ? defaultIndex : 0,
        currentIndex,
        highestIndex: knownStrength,
        disabled: options.length < 2,
      };
    },
  });
  root.devecoManagementState = state;
  if (typeof module === "object" && module.exports) module.exports = state;
})(globalThis);
