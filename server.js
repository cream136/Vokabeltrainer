const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = 'vocabulary.json';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Load vocabulary from Excel and keep a local cache for startup sync
let vocabulary = [];

function saveVocabularyFile(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving vocabulary cache:', error);
  }
}

function loadVocabulary() {
  try {
    const workbook = XLSX.readFile('vocabulary.csv');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    const csvVocabulary = data.map(row => ({
      english: (row.English || row.english || '').toString().trim(),
      german: (row.German || row.german || '').toString().trim()
    })).filter(item => item.english || item.german);

    let storedVocabulary = [];
    if (fs.existsSync(DATA_FILE)) {
      try {
        storedVocabulary = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || [];
      } catch (error) {
        console.warn('Could not parse saved vocabulary cache. Recreating from CSV.');
        storedVocabulary = [];
      }
    }

    let changed = false;
    csvVocabulary.forEach(csvItem => {
      const match = storedVocabulary.find(item =>
        (item.english && csvItem.english && item.english.toLowerCase() === csvItem.english.toLowerCase()) ||
        (item.german && csvItem.german && item.german.toLowerCase() === csvItem.german.toLowerCase())
      );

      if (match) {
        if (!match.english && csvItem.english) {
          match.english = csvItem.english;
          changed = true;
        }
        if (!match.german && csvItem.german) {
          match.german = csvItem.german;
          changed = true;
        }
      } else if (csvItem.english && csvItem.german) {
        storedVocabulary.push(csvItem);
        changed = true;
      }
    });

    if (!fs.existsSync(DATA_FILE) || changed) {
      saveVocabularyFile(storedVocabulary);
    }

    vocabulary = storedVocabulary.filter(item => item.english && item.german);
    console.log(`Loaded ${vocabulary.length} vocabulary pairs from CSV and cache (${csvVocabulary.length} entries scanned)`);
  } catch (error) {
    console.error('Error loading vocabulary:', error);
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