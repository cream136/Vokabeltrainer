# Vokabeltrainer

Eine einfache Node.js-Anwendung zum Lernen von Vokabeln.

## Installation

1. Stelle sicher, dass Node.js installiert ist.
2. Installiere die Abhängigkeiten:
   ```
   npm install
   ```

## Verwendung

1. Lege im Projektordner eine oder mehrere Excel-/CSV-Dateien ab.
   - Unterstützte Formate: `*.csv`, `*.xlsx`
   - Der Server listet automatisch alle verfügbaren Datensätze.
   - Jede Datei sollte zwei Spalten haben: `English` und `German`.

2. Starte den Server:
   ```
   npm start
   ```

3. Öffne http://localhost:3000 in deinem Browser.

4. Wähle oben auf der Seite den gewünschten Datensatz aus.
   - Neue Wörter werden in die aktuell ausgewählte Datei eingetragen.
   - Das Quiz lädt die Vokabeln aus der gewählten Datei.
5. Alternativ kannst du unter dem Dataset-Menü einen neuen Namen eingeben und ein neues Dataset erstellen.
   - Gib den Namen ohne Dateiendung ein.
   - Das neue Dataset wird als `*.csv` angelegt.
6. Wähle ein bestehendes Dataset und nutze die Umbenennen-Funktion, um den Dateinamen zu ändern.
   - Der alte Name wird durch den neuen Namen ersetzt.
   - Die Dateiendung bleibt erhalten, wenn du keinen neuen Typ angibst.
7. Du kannst ein ausgewähltes Dataset löschen, indem du auf `Löschen` klickst.
   - Nach dem Löschen wird das nächste verfügbare Dataset geladen.
   - Wenn keine Datensätze mehr vorhanden sind, ist das Quiz leer.

## Struktur

- `server.js`: Express-Server und Dataset-Verwaltung
- `public/index.html`: HTML-Frontend
- `public/style.css`: CSS-Styling
- `public/script.js`: JavaScript-Logik
- `vocabulary.csv` / `*.xlsx`: Datensätze mit Vokabeln

