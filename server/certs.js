// =============================================================================
// certs.js – vytvorí (alebo načíta uložený) HTTPS certifikát.
//
// Prečo: prehliadač v telefóne sprístupní pohybové senzory iba na HTTPS stránke.
// HTTPS potrebuje certifikát. Keďže nechceme internet ani registráciu, vyrobíme si
// vlastný „self-signed“ certifikát. Telefón ho pri prvom otvorení označí ako
// nedôveryhodný – stačí raz potvrdiť „Pokračovať“.
// =============================================================================

// Práca so súbormi – verzia s `promises`, aby sa dalo používať `await`.
import fs from 'node:fs/promises';
// Skladanie ciest k súborom tak, aby fungovali na Linuxe, macOS aj Windows.
import path from 'node:path';
// Knižnica, ktorá vygeneruje kľúč a certifikát (nainštalovaná cez npm).
import { generate } from 'selfsigned';

// Vráti { key, cert } pre HTTPS server.
// certDir    – priečinok, kam sa certifikát ukladá (z config.js)
// lanAddress – IP adresa počítača; musí byť v certifikáte, inak ho prehliadač odmietne
// `async` znamená, že funkcia môže vo vnútri čakať (`await`) na pomalé operácie (disk).
export async function getCertificate(certDir, lanAddress) {
  // Cesty k trom súborom, ktoré ukladáme:
  const metaPath = path.join(certDir, 'meta.json'); // pre akú IP a do kedy certifikát platí
  const keyPath = path.join(certDir, 'key.pem');    // súkromný kľúč (tajný)
  const certPath = path.join(certDir, 'cert.pem');  // samotný certifikát (verejný)

  // 1) Skúsime použiť už uložený certifikát.
  try {
    // Prečítame meta.json a prevedieme text na objekt.
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    // Použijeme ho iba ak bol vytvorený pre rovnakú IP (napr. si neprešiel na inú Wi-Fi)
    // a zároveň ešte neexpiroval.
    if (meta.lanAddress === lanAddress && new Date(meta.expires) > new Date()) {
      return {
        key: await fs.readFile(keyPath, 'utf8'),
        cert: await fs.readFile(certPath, 'utf8'),
      };
    }
  } catch {
    // Súbory neexistujú alebo sú poškodené (napr. prvé spustenie) – nevadí,
    // pokračujeme nižšie a vygenerujeme nový certifikát.
  }

  // 2) Vygenerujeme nový certifikát.

  // Dátum expirácie = dnes + 1 rok. (Zmeň číslo, ak chceš inú platnosť.)
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);

  const pems = await generate(
    // „Subject“ certifikátu – meno, ktoré sa zobrazí v detailoch certifikátu v prehliadači.
    [{ name: 'commonName', value: 'WagglePlay' }],
    {
      keySize: 2048,          // dĺžka RSA kľúča v bitoch (2048 = štandardná bezpečnosť)
      algorithm: 'sha256',    // hašovací algoritmus podpisu (sha1 by prehliadače odmietli)
      notAfterDate: expires,  // do kedy certifikát platí
      extensions: [
        {
          // subjectAltName = zoznam adries, pre ktoré certifikát platí.
          // Prehliadač porovná adresu v adresnom riadku s týmto zoznamom.
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' }, // type 2 = doménové meno
            { type: 7, ip: '127.0.0.1' },    // type 7 = IP adresa (tento počítač)
            { type: 7, ip: lanAddress },     // IP adresa v sieti – na tú sa pripája telefón
          ],
        },
      ],
    },
  );

  // 3) Uložíme certifikát na disk pre ďalšie spustenia.
  await fs.mkdir(certDir, { recursive: true });                       // vytvor priečinok (ak neexistuje)
  await fs.writeFile(keyPath, pems.private, { mode: 0o600 });         // kľúč čitateľný iba pre teba
  await fs.writeFile(certPath, pems.cert);                            // certifikát
  await fs.writeFile(metaPath, JSON.stringify({ lanAddress, expires })); // info pre kontrolu v kroku 1

  // Vrátime kľúč a certifikát serveru.
  return { key: pems.private, cert: pems.cert };
}
