#!/usr/bin/env node
// ↑ „shebang“ – hovorí systému (Linux/macOS), že tento súbor sa má spustiť cez Node.js.
//   Vďaka nemu sa dá súbor spustiť priamo ako príkaz `waggleplay` (po `npm install -g`
//   alebo cez `npx waggleplay`). Príkaz je zaregistrovaný v package.json v poli "bin".

// Iba naimportuje hlavný súbor servera. Samotný import ho spustí, pretože
// server/index.js vykonáva svoj kód hneď pri načítaní (nemá žiadnu funkciu „main“).
import '../server/index.js';
