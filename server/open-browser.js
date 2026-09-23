// =============================================================================
// open-browser.js – po štarte otvorí konzolu v predvolenom prehliadači,
// aby používateľ nemusel adresu kopírovať ručne.
// =============================================================================

// `spawn` spustí iný program operačného systému (ako keby si ho napísal do terminálu).
import { spawn } from 'node:child_process';

// Otvorí `url` v predvolenom prehliadači. Ak to nejde, potichu to ignoruje –
// adresa je aj tak vypísaná v termináli.
export function openBrowser(url) {
  // Každý systém má na otvorenie odkazu iný príkaz:
  //   macOS   → `open <url>`
  //   Windows → `cmd /c start "" <url>`
  //   Linux   → `xdg-open <url>`
  // process.platform vráti 'darwin' (macOS), 'win32' (Windows) alebo 'linux'.
  // Výsledok je dvojica [príkaz, argumenty], ktorú rozložíme do premenných cmd a args.
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];

  try {
    spawn(cmd, args, {
      stdio: 'ignore', // výstup prehliadača nechceme vidieť v termináli
      detached: true,  // prehliadač beží nezávisle od nášho servera
    })
      .on('error', () => {}) // ak príkaz neexistuje, chybu ignorujeme (inak by spadol server)
      .unref();              // server nebude čakať, kým sa prehliadač zatvorí
  } catch {
    // Žiadny prehliadač (napr. server bez grafického prostredia) – nič nerobíme.
  }
}
