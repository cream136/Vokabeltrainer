/**
 * Vokabeltrainer – Electron-Hauptprozess
 * Startet den Express-Server und öffnet ein BrowserWindow.
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let serverProcess = null;
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

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
function startServer() {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, 'server.js');

    serverProcess = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(PORT) },
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
      if (code !== null && code !== 0) {
        console.error(`Server-Prozess beendet mit Code ${code}`);
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
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  await startServer();
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
