// Tema scelto nelle Impostazioni: "uomo" (navy e oro) o "donna" (champagne e oro rosa), più
// la palette "unisex" (nero, bianco, oro) che vale per entrambi. Caricato subito
// nell'<head> così la pagina non lampeggia con l'altro tema.
(function () {
  let t = 'uomo', p = '';
  try { t = localStorage.getItem('menga-tema') || 'uomo'; p = localStorage.getItem('menga-palette') || ''; } catch (e) { /* niente memoria: tema uomo */ }
  const r = document.documentElement;
  r.dataset.theme = t;
  if (p === 'unisex') r.dataset.palette = 'unisex';
  document.querySelector('meta[name="theme-color"]').content = p === 'unisex' ? '#0b0b0b' : t === 'donna' ? '#f4e9da' : '#1c1d1f';
})();
