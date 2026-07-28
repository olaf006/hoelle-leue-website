# Website pflegen — ganz ohne Programmierkenntnisse

Diese Anleitung ist für alle im Vorstand gedacht, die Inhalte auf der Website ändern möchten.
**Alles Wichtige geht direkt im Browser — GitHub oder Programmieren ist dafür nicht nötig.**

---

## Was ihr selbst ändern könnt (ohne Technikkenntnisse)

Meldet euch dazu im **Mitgliederbereich** an (`/mitglieder.html`) mit einem Konto, das Admin-Rechte hat.

### 🖼️ Galerie-Bilder (Reiter „Galerie-Verwaltung")

Der wichtigste Bereich für die laufende Pflege:

1. **Kategorien anlegen** — z. B. „Umzüge 2026", „Häs & Larven", „Vereinsfeste".
   Kategorien sind optional; ohne Kategorie landen Bilder unter „Sonstige".
2. **Bilder hochladen** — mehrere gleichzeitig möglich. Optional einen Titel vergeben
   (bei mehreren Bildern wird automatisch durchnummeriert) und eine Kategorie wählen.
3. **Bilder verwalten** — Titel und Kategorie jederzeit ändern, mit ↑ / ↓ die Reihenfolge
   festlegen, oder Bilder wieder löschen.

Alles erscheint **sofort** auf der öffentlichen Galerie-Seite (`/galerie.html`) und in der
Galerie-Vorschau auf der Startseite. Kein Deploy, kein Warten.

> **Bildgröße:** max. 4 MB pro Bild. Handyfotos vorher ggf. verkleinern
> (z. B. beim Versenden „mittlere Größe" wählen oder ein kostenloses Tool nutzen).

### 📁 Dokumente (Reiter „Dokumente")
Satzung, Protokolle, Formulare hochladen — sichtbar für alle angemeldeten Mitglieder.

### 👥 Mitglieder verwalten (Reiter „Admin")
- Neue Registrierungen freischalten oder ablehnen
- Ämter zuweisen (Zunftvogt, Schriftführer …) und Admin-Rechte vergeben
- „Mitglied seit"-Jahr eintragen (wichtig für die Abzeichen)
- Ehrenabzeichen vergeben (Gründungsmitglied, Ehrenmitglied …)
- Moderations-Log einsehen
- **Backup herunterladen** — bitte ab und zu machen und gut aufbewahren!

### 📅 Termine (Reiter „Forum")
Neues Thema erstellen → „Als Termin markieren" ankreuzen → Datum wählen.
Der Termin erscheint dann automatisch im Kalender, in der Seitenleiste und im Countdown.

---

## Was aktuell noch über GitHub geändert werden muss

Diese Dinge stehen fest im Seitentext und werden selten geändert:

| Was | Wo |
|---|---|
| Texte auf der Startseite (Über uns, Häs, Geschichte) | `public/index.html` |
| Die Sage | `public/sage.html` |
| Impressum / Datenschutz | `public/impressum.html`, `public/datenschutz.html` |
| Hero-Hintergrundbild, Über-uns-Foto, Häs-Foto | `public/images/image1.jpg`, `image2.jpg`, `image3.jpg` |
| Vorstandsfotos | `public/images/team/` |
| Video verlinken | in `public/index.html` die Zeile `const GUILD_VIDEO_ID = '';` ausfüllen |
| Spendendaten | in `public/index.html` die Zeilen `DONATE_BANK`, `DONATE_IBAN`, `DONATE_PAYPAL_URL` ausfüllen |

---

## Wenn etwas nicht klappt

**Eine Seite lässt sich nicht öffnen / zeigt die falsche Seite an**
→ Prüfen, ob die Datei im GitHub-Repo unter `public/` wirklich existiert und richtig heißt
   (alles klein geschrieben, z. B. `sage.html`).
→ Danach einmal mit **Strg + Umschalt + R** (Mac: **Cmd + Umschalt + R**) neu laden,
   um den Zwischenspeicher des Browsers zu leeren.

**Ein hochgeladenes Bild erscheint nicht**
→ Ist es wirklich ein Bild (JPG/PNG) und kleiner als 4 MB?

**Niemand kommt mehr in den Admin-Bereich**
→ Es muss immer mindestens eine Person mit Admin-Häkchen geben. Falls das schiefgeht,
   hilft nur noch der Zugriff über das Cloudflare-Dashboard — also vorsichtig sein
   beim Entziehen von Admin-Rechten.
