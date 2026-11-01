/* Applied before first paint (external file so the page needs no inline scripts / CSP exceptions). */
try { var t = JSON.parse(localStorage.getItem('fitwise-prefs') || '{}').theme; if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* ignore */ }
