/**
 * Vokabeltrainer – Electron-Hauptprozess
 * Startet den Express-Server und öffnet ein BrowserWindow.
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

let serverProcess = null;
let shuttingDown = false;
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// ── Datenverzeichnis ─────────────────────────────────────────────────────────
// In der gepackten App ist app.asar schreibgeschützt, deshalb liegen Datasets,
// Lernstand und .env dann im userData-Ordner (Windows: %APPDATA%\Vokabeltrainer\data).
// Beim ersten Start werden die mitgelieferten CSVs und die Verbliste dorthin kopiert.
// In der Entwicklung (npm run electron) bleibt alles im Projektordner wie bei npm start.
function prepareDataDir() {
  if (!app.isPackaged) {
    return __dirname;
  }
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Verbliste liegt in public/ und wird vom Server von dort gelesen – muss nicht kopiert werden.
  const seedFiles = fs.readdirSync(__dirname)
    .filter(file => /\.(csv|xlsx)$/i.test(file) || file === '.env');

  for (const file of seedFiles) {
    const target = path.join(dataDir, file);
    if (!fs.existsSync(target)) {
      try {
        fs.copyFileSync(path.join(__dirname, file), target);
      } catch (err) {
        console.error(`Konnte ${file} nicht ins Datenverzeichnis kopieren:`, err.message);
      }
    }
  }

  return dataDir;
}

// ── HTTP-Helper ──────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(1000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await httpGet(url);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  return false;
}

// ── Server-Start ─────────────────────────────────────────────────────────────
function startServer(dataDir) {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, 'server.js');

    // ELECTRON_RUN_AS_NODE: process.execPath ist in der gepackten App die
    // Vokabeltrainer.exe selbst – ohne dieses Flag würde sie als zweite
    // Electron-Instanz starten (und wieder einen Server spawnen, endlos).
    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: __dirname,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(PORT),
        VOKABEL_DATA_DIR: dataDir
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout?.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[Server] ${msg}`);
    });

    serverProcess.stderr?.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[Server Error] ${msg}`);
    });

    serverProcess.on('error', (err) => {
      console.error('Fehler beim Starten des Servers:', err.message);
      resolve();
    });

    serverProcess.on('exit', (code) => {
      serverProcess = null;
      if (code !== null && code !== 0) {
        console.error(`Server-Prozess beendet mit Code ${code}`);
      }
      // „Beenden“ in der App fährt den Server herunter → App mit schließen.
      if (!shuttingDown) {
        shuttingDown = true;
        app.quit();
      }
    });

    // Warten, bis der Server erreichbar ist
    (async () => {
      const ok = await waitForServer(SERVER_URL, 10000);
      console.log(
        ok
          ? '✅ Vokabeltrainer-Server ist bereit.'
          : '⚠️  Server startete nicht rechtzeitig – Fenster wird trotzdem geöffnet.'
      );
      resolve();
    })();
  });
}

// ── BrowserWindow ────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'Vokabeltrainer',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(SERVER_URL);

  // Externe Links im Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // DevTools mit F12 (nur in Entwicklung)
  win.webContents.on('before-input-event', (event, input) => {
    if (process.env.NODE_ENV !== 'production') {
      if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    const tags = ['debug', 'log', 'warn', 'error'];
    console.log(`[Renderer ${tags[level] || 'log'}] ${message}`);
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
function cleanup() {
  shuttingDown = true;
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  const dataDir = prepareDataDir();
  console.log(`Datenverzeichnis: ${dataDir}`);
  await startServer(dataDir);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);
app.on('quit', cleanup);
