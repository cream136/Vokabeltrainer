# Vokabeltrainer

Eine einfache Node.js-Anwendung zum Lernen von Vokabeln.

## Installation

1. Stelle sicher, dass Node.js installiert ist.
2. Installiere die Abhängigkeiten:
   ```
   npm install
   ```

## Verwendung

1. Erstelle eine Excel-Datei namens `vocabulary.xlsx` im Projektordner mit den Spalten "English" und "German".
   - Beispiel: Öffne die bereitgestellte `vocabulary.csv` in Excel und speichere sie als `vocabulary.xlsx`.

2. Starte den Server:
   ```
   npm start
   ```

3. Öffne http://localhost:3000 in deinem Browser. ggf. muss der Prozess beendet werden oder der Port 3001 geändert werden und in der Server.js angepasst werden

4. Gib die deutsche Übersetzung für das englische Wort ein und klicke auf "Prüfen".
   - Richtig: Grün
   - Falsch: Rot, und das Wort wird später wiederholt.

## Struktur

- `server.js`: Express-Server
- `public/index.html`: HTML-Frontend
- `public/style.css`: CSS-Styling
- `public/script.js`: JavaScript-Logik
- `vocabulary.xlsx`: Excel-Datei mit Vokabeln# Vokabeltrainer
