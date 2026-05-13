// Lever (jobs.lever.co) : Lever uses a fairly consistent <li>-based form with
// .application-label and named inputs (name="name", name="email", name="phone",
// name="location", name="org", name="urls[LinkedIn]" etc).
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});
  const { BaseSite } = ns;

  class LeverSite extends BaseSite {
    static id = "lever";
    static label = "Lever";

    static hostMatches(url) {
      return /(^|\.)jobs\.lever\.co$/i.test(url.hostname);
    }

    findFields() {
      // Lever splits the page into multiple <form>s: the main application form
      // (id=application-form) and a separate one for the demographic survey.
      // Include every form on the page so we cover both.
      const forms = Array.from(document.querySelectorAll("form"));
      const scope = forms.length ? forms : [document];
      const { FormFiller } = ns;
      const seen = new Set();
      const all = [];
      for (const f of scope) {
        for (const el of f.querySelectorAll("input, select, textarea")) {
          if (seen.has(el)) continue;
          if (!FormFiller.isFillable(el)) continue;
          // Skip the location typeahead : resolveLocationTypeahead() handles
          // it specially via Lever's /searchLocations API. Filling it through
          // the regular pipeline would dispatch input events that open the
          // dropdown and lead to the hidden #selected-location being cleared.
          if (el.id === "location-input" || el.name === "location" || el.id === "selected-location" || el.name === "selectedLocation") continue;
          seen.add(el);
          all.push(el);
        }
      }
      return all;
    }

    customMappings() {
      const map = new Map();
      const byName = (name, key) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) map.set(el, key);
      };
      // Lever's canonical field names
      byName("name", "fullName");
      byName("email", "email");
      byName("phone", "phone");
      // NOTE: deliberately do NOT map name="location" here. That field is a
      // typeahead : filling it via FormFiller would dispatch an `input` event
      // which opens Lever's dropdown, and a subsequent blur would clear the
      // companion #selected-location hidden field. resolveLocationTypeahead()
      // handles location end-to-end (visible + hidden) without firing events.
      byName("org", "currentCompany");
      byName("urls[LinkedIn]", "links.linkedin");
      byName("urls[GitHub]", "links.github");
      byName("urls[Portfolio]", "links.portfolio");
      byName("urls[Other]", "links.website");
      return map;
    }

    async fill() {
      const result = await super.fill();
      try { await this.resolveLocationTypeahead(result); } catch (e) { console.warn("AutoApply Lever location:", e); }
      return result;
    }

    /**
     * Lever's location field is a typeahead backed by /searchLocations?text=…
     * which returns [{name, id}, …]. The submit-time validator reads a hidden
     * #selected-location whose value must be {"name": …, "id": …} from that
     * API : name alone is not enough. Synthetic events can't trigger the real
     * dropdown click (Lever's React listener requires a trusted event), so we
     * hit the API ourselves with the page's cookies and write the full record
     * into both the visible input and the hidden field.
     */
    async resolveLocationTypeahead(result) {
      const loc = this.profile?.currentLocation;
      if (!loc) return;
      const input = document.querySelector("#location-input, input[name='location']");
      const hidden = document.querySelector("#selected-location, input[name='selectedLocation']");
      if (!input || !hidden) return;
      // Already fully resolved (hidden field has both name AND id)?
      try {
        const parsed = JSON.parse(hidden.value || "{}");
        if (parsed && parsed.name && parsed.id) return;
      } catch (_) {}

      let record = null;
      try {
        const res = await fetch(
          "/searchLocations?text=" + encodeURIComponent(loc),
          { credentials: "include" }
        );
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length) record = list[0];
        }
      } catch (e) { console.warn("AutoApply: searchLocations failed", e); }
      if (!record || !record.id) return;

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      // IMPORTANT: do NOT dispatch input/change events on `#location-input`.
      // Lever's retrieveLocations.js binds:
      //   $('.location-input').on('input', () => showDropdown())
      //   $('.location-input').on('blur',  () => { if dropdown open and user
      //     didn't click an option, CLEAR #selected-location })
      // So dispatching `input` would open the dropdown, and the next time the
      // field lost focus the hidden field would be wiped to {"name":""}.
      // No React value-tracker here (Lever is jQuery), so events aren't needed
      // for the value to "stick" : only to satisfy other listeners.
      const stamp = () => {
        setter.call(input, record.name);
        setter.call(hidden, JSON.stringify({ name: record.name, id: record.id }));
      };
      stamp();
      // Defensively force-hide the dropdown in case it's currently shown.
      document.querySelectorAll(".dropdown-container").forEach((d) => { d.style.display = "none"; });

      // Lever's parseResume.js runs after the resume upload (typically ~1-3s
      // later) and writes parsed values to all of #name, #email, #phone,
      // #location-input AND #selected-location. If the resume parse didn't
      // detect a location, those two get clobbered to ''/{"name":""}.
      // The visible #location-input has a `change`-based "touched" tracker
      // (parseResume skips touched fields), but #selected-location does NOT
      // : it always gets overwritten. So we re-stamp every 250ms for ~6s,
      // covering the parseResume response window, and also dispatch a
      // `change` event on #location-input to mark it touched.
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const deadline = Date.now() + 15000;
      const interval = setInterval(() => {
        if (Date.now() > deadline) { clearInterval(interval); return; }
        let parsed = {};
        try { parsed = JSON.parse(hidden.value || "{}"); } catch (_) {}
        if (!parsed || !parsed.id || parsed.id !== record.id || input.value !== record.name) {
          stamp();
        }
      }, 200);

      if (result && Array.isArray(result.filled)) {
        const already = result.filled.find((f) => f.el === input);
        if (already) already.value = record.name;
        else result.filled.push({ el: input, key: "currentLocation", value: record.name });
        if (Array.isArray(result.unmapped)) {
          const idx = result.unmapped.indexOf(input);
          if (idx >= 0) result.unmapped.splice(idx, 1);
        }
      }
    }
  }

  ns.LeverSite = LeverSite;
})(typeof window !== "undefined" ? window : globalThis);
