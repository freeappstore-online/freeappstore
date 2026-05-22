/**
 * Auto-detect language for <pre><code> blocks and run Prism highlighting.
 * Heuristic: look at content patterns to guess ts/tsx/bash/sql/json.
 * Must load AFTER prism.js (both use defer so order is preserved).
 */
(function () {
  if (typeof Prism === 'undefined' || !Prism.highlightAll) return;

  document.querySelectorAll('pre > code:not([class*="language-"])').forEach(function (code) {
    var text = code.textContent || '';
    var lang = 'typescript'; // default

    if (/^\s*#\s|^\s*npm |^\s*pnpm |^\s*pas |^\s*cd |^\s*git |^\s*curl /m.test(text)) {
      lang = 'bash';
    } else if (/^\s*\{[\s\S]*\}\s*$/m.test(text) && /"[\w]+"/.test(text)) {
      lang = 'json';
    } else if (/\b(SELECT|INSERT|CREATE TABLE|UPDATE|DELETE FROM|ALTER)\b/i.test(text)) {
      lang = 'sql';
    } else if (/[<>].*[<>]|JSX\.|tsx|React\.|&lt;/.test(text)) {
      lang = 'tsx';
    }

    code.className = 'language-' + lang;
  });

  Prism.highlightAll();
})();
