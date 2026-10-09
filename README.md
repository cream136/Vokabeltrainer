# Vokabeltrainer

Eine Electron-Desktop-App zum Lernen von Vokabeln – mit integriertem KI-Assistenten.

## Funktionen

- 📚 **Vokabel-Quiz** – Deutsch ↔ Englisch, zufällig gemischt
- ✨ **KI-Hilfe** – Fragt zu jedem Wort Wortart, Verbkonjugation (3 Formen), Beispielsätze und Synonyme ab
- 🗂️ **Dataset-Verwaltung** – CSV/XLSX-Dateien erstellen, umbenennen, löschen
- 📊 **Statistiken** – Richtig / Falsch / Gesamtzahl
- 📱 **Maui-kompatibel** – Die Express-API lässt sich später von einer .NET MAUI-App aufrufen

## Voraussetzungen

- **Node.js** ≥ 18
- Für die KI-Funktion: **Ollama** (empfohlen) *oder* ein **OpenAI-API-Key**

## Installation

```bash
npm install
```

### KI-Assistent einrichten (einmalig)

**Option A – Ollama (lokal, kostenlos, empfohlen):**
```bash
# Ollama installieren: https://ollama.com
ollama serve            # im Hintergrund starten
ollama pull llama3.1    # Modell laden
```

**Option B – OpenAI (Cloud):**
```bash
# API-Key von https://platform.openai.com/api-keys beziehen
```

Danach die Datei `.env` erstellen:
```bash
cp .env.example .env
```
und die passenden Werte eintragen.

## Starten

### Als Web-App (Browser)
```bash
npm start
# → http://localhost:3000
```

### Als Electron-Desktop-App
```bash
npm run electron
```

### Als installierbare App bauen (Windows)
```bash
npm run build:win
# → dist/  (NSIS-Installer)
```

## Android & iOS (Capacitor)

Die App läuft auf dem Handy **ohne Server**: Prüf-Logik ([public/core.js](public/core.js)) und Daten liegen auf dem Gerät
(Capacitor Preferences). Nur die KI-Hilfe geht über den Vokabeltrainer-Server als Proxy – die Adresse
trägst du in der App unter *Einstellungen → KI-Server* ein (z. B. `http://192.168.1.10:3000`).

```bash
npm run cap:sync          # public/ in android/ und ios/ kopieren (nach jeder Änderung am Frontend)
npm run cap:android       # Android Studio öffnen → Run auf Gerät/Emulator
npm run cap:ios           # Xcode öffnen (nur macOS) → Run auf Gerät/Simulator
```

- Voraussetzungen: Android Studio (Android), Xcode + CocoaPods auf einem Mac (iOS).
- Beim ersten Start werden die CSV-Listen aus `public/data/` ins Gerät übernommen; danach lassen sich
  Listen in der App anlegen, per **CSV importieren** einlesen und per **CSV exportieren** teilen.
- Zum Testen des Geräte-Modus im Browser: `http://localhost:3000/?local=1` (nutzt `localStorage`).

## Datenverzeichnis

- `npm start` / `npm run electron`: Datasets, `verb-data.json`, `.env` und der Lernstand (`session-state.json`) liegen im Projektordner.
- Installierte App (gebaut mit `npm run build:win`): alles liegt in `%APPDATA%\Vokabeltrainer\data` (macOS: `~/Library/Application Support/Vokabeltrainer/data`). Beim ersten Start werden die mitgelieferten CSVs und die Verbliste dorthin kopiert; die `.env` mit API-Keys dort ablegen.
- Umgebungsvariablen: `VOKABEL_DATA_DIR` setzt das Verzeichnis explizit, `HOST=127.0.0.1` schränkt den Server auf den eigenen Rechner ein (Standard `0.0.0.0` für die Handy-PWA im WLAN). „Beenden“ ist nur vom lokalen Rechner aus möglich.

## Datenformat

Jede CSV-Datei im Datenverzeichnis mit den Spalten `English` und `German`:
```csv
English,German
hello,hallo
world,Welt
```

## Projektstruktur

```
├── main.js              # Electron-Hauptprozess
├── server.js            # Express-Server + API (inkl. /api/ai-helper)
├── .env.example         # Umgebungsvariablen-Vorlage
├── package.json
├── public/
│   ├── index.html       # Frontend
│   ├── script.js        # Frontend-Logik
│   ├── style.css        # Styling
│   └── sw.js            # Service Worker (PWA)
├── verb-data.json       # Unregelmäßige Verben (Lernmodus Zeitformen)
└── *.csv                # Vokabel-Datensätze
```

## API-Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/datasets` | Datensätze auflisten |
| `POST` | `/api/datasets` | Neues Dataset anlegen |
| `POST` | `/api/datasets/rename` | Dataset umbenennen |
| `POST` | `/api/datasets/delete` | Dataset löschen |
| `GET` | `/api/vocabulary` | Vokabeln laden |
| `POST` | `/api/check` | Antwort prüfen |
| `POST` | `/api/add-word` | Neues Wort hinzufügen |
| `POST` | `/api/ai-helper` | **KI-Hilfe** (Konjugation, Beispielsätze, Synonyme) |

## MAUI-Mobil-App (Plan)

Die Express-API ist von einer .NET MAUI-App über HTTP aufrufbar.
Die Quiz-Logik und die Vokabeln lassen sich 1:1 portieren.

