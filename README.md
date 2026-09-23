# WagglePlay

Lokálny herný systém inšpirovaný konzolou Nintendo Wii. **Počítač** je konzola, **telefón** je pohybový ovládač
(gyroskop + akcelerometer). Všetko beží v lokálnej sieti, bez internetu a registrácie.

## Spustenie

Potrebuješ Node.js 20+.

```bash
npm install && npm start
```

Konzola sa otvorí v prehliadači na `http://localhost:3000`. Naskenuj QR kód telefónom **v rovnakej Wi-Fi sieti**.

> Pri prvom pripojení telefón upozorní na neznámy certifikát (je self-signed, generuje sa lokálne).
> Potvrď „Pokračovať“ – HTTPS je nutné, inak prehliadač nesprístupní pohybové senzory.

### Nastavenia (env premenné)

| Premenná | Predvolená | Popis |
|---|---|---|
| `HTTP_PORT` | `3000` | port konzoly (iba localhost) |
| `HTTPS_PORT` | `3443` | port pre telefóny (LAN) |
| `NO_OPEN` | – | `1` = neotvárať prehliadač automaticky |

Vývoj s automatickým reštartom: `npm run dev`.

Architektúra a komunikačný protokol: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Čo znamenajú polia v `package.json`

Formát JSON nepodporuje komentáre, preto je vysvetlenie tu:

| Pole | Význam |
|---|---|
| `name`, `version`, `description` | Názov, verzia a popis balíka. Verziu zvyšuj pri vydaní novej verzie. |
| `type: "module"` | Súbory `.js` používajú moderné `import`/`export` (ES moduly) namiesto `require`. |
| `main` | Hlavný súbor projektu (`server/index.js`). |
| `bin` | Zaregistruje príkaz `waggleplay`, ktorý spustí `bin/waggleplay.js` (napr. cez `npx waggleplay`). |
| `scripts.start` | Čo sa vykoná pri `npm start`: spustí server. |
| `scripts.dev` | `npm run dev`: server sa po uložení zmeneného súboru sám reštartuje (`node --watch`). |
| `engines.node` | Minimálna verzia Node.js, ktorú projekt potrebuje. |
| `dependencies` | Knižnice z npm: `express` (webový server), `socket.io` (WebSocket komunikácia), `qrcode` (generovanie QR kódu), `selfsigned` (HTTPS certifikát). Pridávajú sa príkazom `npm install <názov>`. |
| `license` | Licencia, pod ktorou je kód zverejnený. |

`package-lock.json` sa generuje automaticky a zaručuje, že každý nainštaluje presne rovnaké verzie knižníc. Ručne ho neupravuj.
