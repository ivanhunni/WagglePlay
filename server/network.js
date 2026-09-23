// =============================================================================
// network.js – zistí IP adresu počítača v lokálnej (Wi-Fi) sieti.
//
// Túto adresu potrebujeme do QR kódu – telefón sa na počítač nedokáže pripojiť
// cez „localhost“ (to by pre telefón znamenalo „telefón sám“), ale iba cez
// skutočnú IP adresu počítača v sieti, napr. 192.168.1.23.
// =============================================================================

// Vstavaný modul Node.js s informáciami o operačnom systéme (vrátane sieťových kariet).
import os from 'node:os';

// Vráti najpravdepodobnejšiu LAN IPv4 adresu (tú, na ktorú dosiahne telefón v rovnakej Wi-Fi).
export function getLanAddress() {
  // Sem budeme zbierať všetky vhodné adresy, ktoré nájdeme.
  const candidates = [];

  // os.networkInterfaces() vráti objekt { názovKarty: [zoznam adries] },
  // napr. { wlan0: [...], eth0: [...], lo: [...] }.
  // Object.entries ho prevedie na dvojice [názov, adresy], cez ktoré prejdeme cyklom.
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    // `addrs ?? []` – ak by adresy chýbali (undefined), použije sa prázdne pole.
    for (const addr of addrs ?? []) {
      // Preskočíme IPv6 adresy (chceme jednoduchú IPv4) a interné adresy (127.0.0.1 = loopback).
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Zapamätáme si názov karty aj adresu.
      candidates.push({ name, address: addr.address });
    }
  }

  // Regulárny výraz rozpoznávajúci názvy virtuálnych sieťových kariet
  // (Docker, VPN, virtuálne stroje…) – na tie sa telefón pripojiť nevie.
  // `^` = začiatok názvu, `|` = alebo, `i` = nerozlišuje veľké/malé písmená.
  // Ak sa ti vyberá zlá adresa, pridaj sem názov nechcenej karty.
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|zt)/i;

  // Z kandidátov necháme iba „skutočné“ (fyzické) karty.
  const physical = candidates.filter((c) => !virtual.test(c.name));

  // Ak existujú fyzické karty, hľadáme medzi nimi, inak medzi všetkými.
  // .find() vráti prvú adresu, ktorá je privátna (typická domáca sieť).
  const pick = (physical.length ? physical : candidates).find((c) => isPrivate(c.address));

  // Vrátime nájdenú adresu; ak nič nesedí, aspoň prvú akúkoľvek;
  // a ak nie je žiadna sieť, 127.0.0.1 (vtedy bude fungovať iba konzola na PC).
  // `?.` = ak je hodnota vľavo undefined, nepokračuj a vráť undefined (namiesto chyby).
  return pick?.address ?? candidates[0]?.address ?? '127.0.0.1';
}

// Zistí, či IP adresa patrí do rozsahov vyhradených pre lokálne (privátne) siete:
//   10.x.x.x, 192.168.x.x a 172.16.x.x – 172.31.x.x
function isPrivate(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}
