const express = require('express');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Load vocabulary from Excel
let vocabulary = [];
function loadVocabulary() {
  try {
    const workbook = XLSX.readFile('vocabulary.csv');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    vocabulary = data.map(row => ({
      english: row.English || row.english,
      german: row.German || row.german
    })).filter(item => item.english && item.german);
    console.log(`Loaded ${vocabulary.length} vocabulary pairs`);
  } catch (error) {
    console.error('Error loading vocabulary:', error);
    // Fallback vocabulary
    vocabulary = [
      { english: 'hello', german: 'hallo' },
      { english: 'world', german: 'welt' },
      { english: 'cat', german: 'katze' },
      { english: 'dog', german: 'hund' }
    ];
  }
}

// API endpoints
app.get('/api/vocabulary', (req, res) => {
  res.json(vocabulary);
});

app.post('/api/check', (req, res) => {
  const { english, german } = req.body;
  const correct = vocabulary.find(v => v.english.toLowerCase() === english.toLowerCase());
  if (correct) {
    const isCorrect = correct.german.toLowerCase() === german.toLowerCase().trim();
    res.json({ correct: isCorrect, correctAnswer: correct.german });
  } else {
    res.json({ correct: false, correctAnswer: 'Unknown word' });
  }
});

// Start server
app.listen(PORT, () => {
  loadVocabulary();
  console.log(`Server running at http://localhost:${PORT}`);
});