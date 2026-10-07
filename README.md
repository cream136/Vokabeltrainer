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

## Datenformat

Jede CSV-Datei im Projektordner mit den Spalten `English` und `German`:
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
│   └── style.css        # Styling
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

