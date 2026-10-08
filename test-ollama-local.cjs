// Temporärer Test: Lokale Ollama-Instanz (localhost:11434) für die KI-Hilfe prüfen (selbstbeendend)
const MODELS = ['qwen3.5:4b', 'llama3.1:8b'];

async function testModel(model) {
  const t0 = Date.now();
  try {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: 'Du bist ein präziser Englisch-Deutsch-Lehrer. Antworte immer auf Deutsch, kurz.' },
          { role: 'user', content: 'Zu "serendipity": Wortart, Übersetzung, 1 Beispielsatz mit Übersetzung.' }
        ]
      })
    });
    if (!r.ok) {
      console.log(`${model}: HTTP ${r.status} – ${await r.text()}`);
      return;
    }
    const d = await r.json();
    console.log(`\n=== ${model} (${Date.now() - t0} ms) ===`);
    console.log((d.message?.content || '(leer)').slice(0, 400));
  } catch (e) {
    console.log(`${model}: FEHLER – ${e.message}`);
  }
}

(async () => {
  for (const m of MODELS) {
    await testModel(m);
  }
  process.exit(0);
})();
