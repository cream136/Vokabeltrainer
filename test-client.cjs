// Temporärer Test: KI-Hilfe-Endpunkt des laufenden Servers prüfen (selbstbeendend)
fetch('http://localhost:3000/api/ai-helper', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ word: 'serendipity' })
})
  .then(r => r.json())
  .then(d => {
    console.log('success:', d.success);
    console.log('provider:', d.provider || '(kein Provider erfolgreich)');
    console.log(d.info ? d.info.slice(0, 300) : d.message);
  })
  .catch(e => console.log('ERROR', e.message))
  .finally(() => process.exit(0));
