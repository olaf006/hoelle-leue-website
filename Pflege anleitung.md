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

> **Tipp — Titel lohnen sich:** Besucher:innen können die Galerie nach Titeln durchsuchen.
> Wer seine Bilder betitelt („Hemdglunkerumzug 2026", „Narrenbaumstellen"), macht sie
> auffindbar. Bilder ohne Titel erscheinen zwar in der Galerie, sind aber nicht suchbar.

> **Einzelne Bilder teilen:** In der Großansicht gibt es einen 🔗-Button. Damit lässt sich
> ein Link direkt zu genau diesem Bild kopieren bzw. teilen — praktisch für die
> Vereins-WhatsApp-Gruppe.

> **Bildgröße:** max. 4 MB pro Bild. Handyfotos vorher ggf. verkleinern
> (z. B. beim Versenden „mittlere Größe" wählen oder ein kostenloses Tool nutzen).

### 📋 Mitgliedsanträge (Reiter „Admin")

Über die Startseite können Interessierte den Antrag online ausfüllen („Mitglied werden").
Jeder Antrag landet **immer** hier im Admin-Bereich — auch wenn der E-Mail-Versand
(noch) nicht eingerichtet ist. So geht garantiert nichts verloren.

Pro Antrag seht ihr alle Angaben und könnt den Status auf „neu", „in Bearbeitung" oder
„erledigt" setzen. Die Zahl neben der Überschrift zeigt die offenen Anträge.

> **Bewusst nicht online erhoben:** Bankdaten. Das SEPA-Mandat muss weiterhin
> unterschrieben auf Papier eingeholt werden — so wie bisher.

#### E-Mail-Weiterleitung einrichten (optional, einmalig)

Damit Anträge zusätzlich per E-Mail an `hoelle-leue@web.de` gehen:

1. Kostenloses Konto bei **[resend.com](https://resend.com)** anlegen (3.000 Mails/Monat gratis).
2. Dort unter „API Keys" einen Schlüssel erstellen und kopieren.
3. Im Cloudflare-Dashboard: euer Projekt → **Settings** → **Variables and Secrets** →
   **Add** → Typ **Secret**, Name `RESEND_API_KEY`, Wert = der kopierte Schlüssel → speichern.
4. Optional ebenso `APPLICATION_TO_EMAIL` (Empfängeradresse, Standard ist `hoelle-leue@web.de`)
   und `APPLICATION_FROM_EMAIL` (Absender).

> **Wichtig:** Für einen eigenen Absender (z. B. `info@hoelle-leue.de`) muss die Domain bei
> Resend verifiziert werden. Ohne Verifizierung funktioniert nur die Testadresse von Resend.
> Solange nichts eingerichtet ist, erscheinen die Anträge einfach nur hier im Admin-Bereich —
> das funktioniert vollständig, ihr müsst nur selbst reinschauen.

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
