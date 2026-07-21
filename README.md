# Bilder für die Website

Lege deine echten Fotos genau in diesen Ordner (`public/images/`) und benenne sie exakt so:

| Dateiname     | Wird verwendet für …                                      | Format-Tipp        |
|---------------|-------------------------------------------------------------|---------------------|
| image1.jpg    | Hintergrundfoto im Kopfbereich (Hero)                       | breit/querformat    |
| image2.jpg    | Foto im Abschnitt "Über uns"                                 | quer, ca. 3:2       |
| image3.jpg    | Foto im Abschnitt "Unser Häs"                                 | hochformat, ca. 3:4  |
| image4.jpg    | Galerie, Foto 1                                               | quer, ca. 4:3       |
| image5.jpg    | Galerie, Foto 2                                               | quer, ca. 4:3       |
| image6.jpg    | Galerie, Foto 3                                               | quer, ca. 4:3       |
| image7.jpg    | Galerie, Foto 4                                               | quer, ca. 4:3       |
| image8.jpg    | Galerie, Foto 5                                               | quer, ca. 4:3       |
| image9.jpg    | Galerie, Foto 6                                               | quer, ca. 4:3       |

**Wichtig:**
- Alle Dateien müssen als `.jpg` gespeichert sein (nicht `.png`, `.heic` etc. — beim Speichern/Exportieren einfach als JPG wählen).
- Die Namen müssen exakt `image1.jpg`, `image2.jpg` usw. lauten (klein geschrieben).
- Du musst nicht alle 9 auf einmal hochladen — jedes Bild, das fehlt, zeigt einfach weiterhin einen dezenten Platzhalter mit seinem Dateinamen, bis du es ergänzt.
- Zum Hochladen: In deinem GitHub-Repo in den Ordner `public/images/` gehen → „Add file" → „Upload files" → Bilder reinziehen → „Commit changes". Das löst automatisch einen neuen Deploy aus.

## Termin-Galerien (Pop-up bei Klick auf einen Termin)

Für jeden Termin gibt es im Pop-up einen Button „Bilder vergangener Jahre ansehen". Die Bilder dafür liegen in einem eigenen Unterordner `public/images/termine/` und folgen diesem Muster: `{termin}-1.jpg`, `{termin}-2.jpg`, `{termin}-3.jpg` (je 3 Bilder pro Termin, gleiches Prinzip wie oben — fehlende Bilder zeigen einen Platzhalter).

| Termin | Dateinamen |
|---|---|
| Schmutziger Dunschtig | `termine/schmutziger-dunschtig-1.jpg` bis `-3.jpg` |
| Fasnetsonntag | `termine/fasnetsonntag-1.jpg` bis `-3.jpg` |
| Fasnetmendig | `termine/fasnetmendig-1.jpg` bis `-3.jpg` |
| Fasnetzieschdig | `termine/fasnetzieschdig-1.jpg` bis `-3.jpg` |
| Fasnetverbrennung | `termine/fasnetverbrennung-1.jpg` bis `-3.jpg` |
