// ResumeUploader — fetches a file packaged with the extension and assigns it
// to a file <input> using the DataTransfer trick. Works in Chromium-based
// browsers (Chrome, Brave, Edge) when the file is served from a
// chrome-extension:// URL declared in web_accessible_resources.
(function (root) {
  const ns = (root.AutoApply = root.AutoApply || {});

  const RESUME_PATTERNS = [/\bresume\b/, /\bcv\b/, /\bcurriculum[\s_-]*vitae\b/];
  const COVER_PATTERNS  = [/\bcover[\s_-]*letter\b/];

  function isFileInput(el) {
    return el && el.tagName === "INPUT" && (el.type || "").toLowerCase() === "file";
  }

  function classifyFileInput(el) {
    const text = ns.FieldMatcher.collectLabelText(el);
    if (!text) return null;
    for (const re of COVER_PATTERNS) if (re.test(text)) return "cover";
    for (const re of RESUME_PATTERNS) if (re.test(text)) return "resume";
    return null;
  }

  async function fetchAsFile(assetPath, fileName, mimeType) {
    const url = chrome.runtime.getURL(assetPath);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${assetPath}: ${res.status}`);
    const blob = await res.blob();
    return new File([blob], fileName, { type: mimeType || blob.type || "application/octet-stream" });
  }

  /**
   * Attaches a file to a file input. Returns true on success.
   * @param {HTMLInputElement} input
   * @param {File} file
   */
  function attachFile(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // Some sites (Lever) wrap the real <input type="file"> behind a styled
      // anchor/button — dispatching change on the input is enough; the form
      // will read input.files on submit.
      return input.files && input.files.length > 0;
    } catch (e) {
      console.warn("AutoApply: attachFile failed", e);
      return false;
    }
  }

  /**
   * Tries to upload the resume into a single file input.
   */
  async function uploadResume(input, profile) {
    if (!profile?.resumeAsset) return false;
    const file = await fetchAsFile(profile.resumeAsset, profile.resumeFileName || "resume.pdf", profile.resumeMimeType);
    return attachFile(input, file);
  }

  ns.ResumeUploader = { isFileInput, classifyFileInput, fetchAsFile, attachFile, uploadResume };
})(typeof window !== "undefined" ? window : globalThis);
