// Temporärer Test: Fallback-Kette der KI-Hilfe prüfen (selbstbeendend)
process.env.PORT = '3463';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('./server.js');

setTimeout(() => {
  fetch('http://localhost:3463/api/ai-helper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: 'mnemonic' })
  })
    .then(r => r.json())
    .then(d => {
      console.log('TEST-RESULT success:', d.success);
      console.log('TEST-RESULT provider:', d.provider || '(kein Provider erfolgreich)');
      console.log(d.info ? d.info.slice(0, 300) : d.message);
    })
    .catch(e => console.log('TEST-RESULT ERROR', e.message))
    .finally(() => process.exit(0));
}, 3000);
