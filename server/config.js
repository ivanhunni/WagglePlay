// =============================================================================
// config.js – centrálne nastavenia servera.
//
// Každú hodnotu sa dá zmeniť buď priamo tu, alebo bez úpravy kódu cez
// premennú prostredia pri spustení, napr.:
//     HTTP_PORT=8080 HTTPS_PORT=8443 npm start
// =============================================================================

// `export` sprístupní objekt `config` ostatným súborom (import { config } from './config.js').
export const config = {
  // Port pre konzolu (PC). Beží cez obyčajné HTTP a je dostupný iba z tohto počítača.
  // `process.env.HTTP_PORT` je premenná prostredia (text) → `Number(...)` ju prevedie na číslo.
  // `|| 3000` znamená: ak premenná nie je nastavená (alebo nie je platné číslo), použi 3000.
  httpPort: Number(process.env.HTTP_PORT) || 3000,

  // Port pre ovládač (telefón). Beží cez HTTPS a je dostupný z celej lokálnej siete.
  // HTTPS je nutné, pretože prehliadač v telefóne inak nesprístupní gyroskop/akcelerometer.
  httpsPort: Number(process.env.HTTPS_PORT) || 3443,

  // Priečinok, kam sa uloží vygenerovaný certifikát, aby sa nemusel tvoriť pri každom štarte.
  // `import.meta.url` je adresa tohto súboru (file:///.../server/config.js);
  // `new URL('../.certs/', ...)` z nej vypočíta cestu o priečinok vyššie → <projekt>/.certs/
  // `.pathname` z URL vyberie iba cestu na disku.
  certDir: process.env.CERT_DIR || new URL('../.certs/', import.meta.url).pathname,

  // Či sa má po štarte automaticky otvoriť prehliadač s konzolou.
  // Vypneš to spustením `NO_OPEN=1 npm start` (výraz je potom false).
  openBrowser: process.env.NO_OPEN !== '1',
};
