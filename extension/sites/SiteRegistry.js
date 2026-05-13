// SiteRegistry : picks the most specific site handler for the current URL.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  // Order matters: most specific first.
  const HANDLERS = [
    ns.LeverSite,
    ns.GreenhouseSite,
    ns.WorkdaySite,
    ns.TeslaSite,
    ns.GenericSite
  ];

  function pickHandler(url) {
    const u = url instanceof URL ? url : new URL(url);
    for (const H of HANDLERS) {
      try {
        if (H && H.hostMatches(u)) return H;
      } catch (_) {}
    }
    return ns.GenericSite;
  }

  ns.SiteRegistry = { HANDLERS, pickHandler };
})(typeof window !== "undefined" ? window : globalThis);
