// Tema scelto nelle Impostazioni: "uomo" (scuro) o "donna" (chiaro avana). Caricato subito
// nell'<head> così la pagina non lampeggia con l'altro tema.
(function () {
  let t = 'uomo';
  try { t = localStorage.getItem('menga-tema') || 'uomo'; } catch (e) { /* niente memoria: tema scuro */ }
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === 'donna' ? '#e6d5b8' : '#1f1d1a';
})();
