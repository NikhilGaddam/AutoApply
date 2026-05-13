// GenericSite : fallback handler. Pure label/name/placeholder matching.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class GenericSite extends BaseSite {
    static id = "generic";
    static label = "Generic";
    static hostMatches() { return true; } // always matches as a last resort
  }

  ns.GenericSite = GenericSite;
})(typeof window !== "undefined" ? window : globalThis);
