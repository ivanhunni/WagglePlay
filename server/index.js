// =============================================================================
// index.js – hlavný súbor servera. Spúšťa sa príkazom `npm start`.
//
// Postup:
//   1. zistí IP adresu počítača v sieti
//   2. pripraví Express (webový server, ktorý posiela HTML/CSS/JS súbory)
//   3. spustí dva servery: HTTP pre konzolu (PC) a HTTPS pre telefón
//   4. pripojí k nim Socket.IO (WebSocket komunikácia v reálnom čase)
//   5. vypíše adresy do terminálu a otvorí prehliadač
// =============================================================================

// Vstavané moduly Node.js:
import http from 'node:http';           // obyčajný (nešifrovaný) HTTP server
import https from 'node:https';         // šifrovaný HTTPS server
import path from 'node:path';           // skladanie ciest k súborom
import { fileURLToPath } from 'node:url'; // prevod adresy súboru (file://...) na bežnú cestu

// Knižnice z npm:
import express from 'express';          // framework na obsluhu webových požiadaviek
import { Server } from 'socket.io';     // WebSocket server

// Naše vlastné moduly (priečinok server/):
import { config } from './config.js';
import { getLanAddress } from './network.js';
import { getCertificate } from './certs.js';
import { SessionStore } from './sessions.js';
import { registerSocketHandlers } from './socket.js';
import { openBrowser } from './open-browser.js';

// Absolútna cesta ku koreňovému priečinku projektu (o úroveň vyššie ako server/).
// Potrebujeme ju, aby sme našli priečinky public/ a shared/ bez ohľadu na to,
// odkiaľ bol príkaz spustený.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// IP adresa počítača v lokálnej sieti, napr. 192.168.1.23.
const lanAddress = getLanAddress();
// Adresa konzoly – otvára sa na PC, preto stačí localhost.
const consoleUrl = `http://localhost:${config.httpPort}/console/`;
// Základná adresa pre telefón – musí byť IP adresa a HTTPS. Použije sa do QR kódu.
const controllerBaseUrl = `https://${lanAddress}:${config.httpsPort}`;

// --- Express: posielanie súborov klientom -----------------------------------

// Vytvoríme Express aplikáciu. Tá rozhoduje, čo sa pošle na ktorú adresu.
const app = express();
// Nepridávať hlavičku „X-Powered-By: Express“ (zbytočne prezrádza technológiu).
app.disable('x-powered-by');
// Adresa "/" (napr. http://localhost:3000/) presmeruje rovno na konzolu.
app.get('/', (_req, res) => res.redirect('/console/'));
// Súbory z priečinka shared/ budú dostupné na /shared/... (napr. /shared/protocol.js).
app.use('/shared', express.static(path.join(root, 'shared')));
// Súbory z priečinka public/ budú dostupné priamo, napr. public/console/index.html → /console/
app.use(express.static(path.join(root, 'public')));
// Jednoduchá kontrola, či server beží: /api/health vráti {"ok":true}.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Dva servery, jedna aplikácia, jeden Socket.IO --------------------------
// HTTP  :3000 – konzola na PC (localhost sa v prehliadači považuje za bezpečný aj bez HTTPS).
// HTTPS :3443 – ovládač v telefóne (senzory pohybu fungujú iba cez HTTPS).

// Načítame alebo vytvoríme certifikát pre HTTPS (viď certs.js).
// `await` na najvyššej úrovni súboru funguje, lebo projekt používa ES moduly ("type": "module").
const { key, cert } = await getCertificate(config.certDir, lanAddress);
// Oba servery obsluhuje tá istá Express aplikácia → posielajú rovnaké súbory.
const httpServer = http.createServer(app);
const httpsServer = https.createServer({ key, cert }, app);

// Jeden Socket.IO server pripojený k obom → konzola (HTTP) a telefón (HTTPS)
// sú v rovnakom „svete“ a môžu si posielať správy.
// serveClient: true = Socket.IO sám poskytne svoju prehliadačovú knižnicu
// na adrese /socket.io/socket.io.min.js (používajú ju naše HTML stránky).
const io = new Server({ serveClient: true });
io.attach(httpServer);
io.attach(httpsServer);
// Zaregistrujeme obsluhu všetkých správ (viď socket.js) s novým úložiskom relácií.
registerSocketHandlers(io, new SessionStore(), { controllerBaseUrl });

// Spustíme počúvanie:
//   '127.0.0.1' – HTTP je dostupné IBA z tohto počítača (nikto zo siete sa naň nedostane)
//   '0.0.0.0'   – HTTPS je dostupné zo všetkých sieťových kariet (teda aj z telefónu vo Wi-Fi)
httpServer.listen(config.httpPort, '127.0.0.1');
httpsServer.listen(config.httpsPort, '0.0.0.0');

// Počkáme, kým oba servery naozaj začnú počúvať (alebo kým nastane chyba,
// napr. port je obsadený iným programom – vtedy program skončí s chybou).
await Promise.all([once(httpServer, 'listening'), once(httpsServer, 'listening')]);

// Vypíšeme adresy do terminálu.
console.log(`
  WagglePlay beží 🎮

  Konzola (PC):      ${consoleUrl}
  Ovládač (telefón): ${controllerBaseUrl}/controller/

  Telefón musí byť v rovnakej Wi-Fi sieti. Ukončíš cez Ctrl+C.
`);

// Otvoríme konzolu v prehliadači (ak to nie je vypnuté cez NO_OPEN=1).
if (config.openBrowser) openBrowser(consoleUrl);

// Pomocná funkcia: vráti Promise (prísľub), ktorý sa splní, keď server vyšle udalosť
// `event` (napr. 'listening'), alebo zlyhá, ak server vyšle 'error'.
// Vďaka tomu naň môžeme čakať cez `await`.
function once(server, event) {
  return new Promise((resolve, reject) => {
    server.once(event, resolve);
    server.once('error', reject);
  });
}
