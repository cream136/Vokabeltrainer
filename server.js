const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(__dirname);
const DEFAULT_DATA_FILE = 'vocabulary.csv';

let vocabulary = [];
let currentDataset = DEFAULT_DATA_FILE;

app.use(express.json());
app.use(express.static('public'));

function escapeCsv(value) {
  const text = value.toString().trim();
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function getDatasetFiles() {
  const files = fs.readdirSync(DATA_DIR);
  return files
    .filter(file => /\.(csv|xlsx)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function normalizeDatasetName(name, defaultExtension = '.csv') {
  const safeName = path.basename(name || '').trim();
  if (!safeName) {
    return null;
  }

  const normalized = safeName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const ext = path.extname(normalized).toLowerCase();

  if (ext === '.csv' || ext === '.xlsx') {
    return normalized;
  }

  return `${normalized}${defaultExtension}`;
}

function resolveDatasetPath(dataset) {
  const safeName = path.basename(dataset || '');
  if (!/\.(csv|xlsx)$/i.test(safeName)) {
    return null;
  }

  const filePath = path.join(DATA_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return filePath;
}

function normalizeCell(value) {
  return value === undefined || value === null ? '' : value.toString().trim();
}

function loadDataset(dataset) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheet ? XLSX.utils.sheet_to_json(worksheet, { defval: '' }) : [];

  const englishKeys = ['English', 'english', 'Englisch', 'englisch'];
  const germanKeys = ['German', 'german', 'Deutsch', 'deutsch'];

  const findKey = (row, keys) => keys.find(key => Object.prototype.hasOwnProperty.call(row, key));

  return rows
    .map(row => {
      const rowKeys = Object.keys(row);
      const englishKey = findKey(row, englishKeys);
      const germanKey = findKey(row, germanKeys);

      const english = normalizeCell(englishKey ? row[englishKey] : rowKeys[0] ? row[rowKeys[0]] : '');
      const german = normalizeCell(germanKey ? row[germanKey] : rowKeys[1] ? row[rowKeys[1]] : '');

      return { english, german };
    })
    .filter(item => item.english && item.german);
}

const datasetCache = new Map();

function getVocabularyFor(dataset) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }
  const stat = fs.statSync(filePath);
  const cached = datasetCache.get(dataset);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.words;
  }
  const words = loadDataset(dataset);
  datasetCache.set(dataset, { mtimeMs: stat.mtimeMs, words });
  return words;
}

function invalidateDatasetCache(dataset) {
  if (dataset) {
    datasetCache.delete(dataset);
  } else {
    datasetCache.clear();
  }
}

function saveWordToDataset(dataset, word) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }

  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv') {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, 'English,German\n', 'utf8');
    }
    const line = `\n${escapeCsv(word.english)},${escapeCsv(word.german)}`;
    fs.appendFileSync(filePath, line, 'utf8');
    return;
  }

  const workbook = fs.existsSync(filePath) ? XLSX.readFile(filePath, { cellDates: true, raw: false }) : XLSX.utils.book_new();
  const sheetName = workbook.SheetNames[0] || 'Sheet1';
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheet ? XLSX.utils.sheet_to_json(worksheet, { defval: '' }) : [];

  rows.push({ English: word.english, German: word.german });
  const newWorksheet = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  workbook.Sheets[sheetName] = newWorksheet;
  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }

  XLSX.writeFile(workbook, filePath);
}

function getDatasetList() {
  return getDatasetFiles().map(name => ({
    name,
    label: name.replace(/\.(csv|xlsx)$/i, '')
  }));
}

function loadVocabulary(dataset = DEFAULT_DATA_FILE) {
  const availableDatasets = getDatasetFiles();

  if (availableDatasets.length === 0) {
    const defaultPath = path.join(DATA_DIR, DEFAULT_DATA_FILE);
    fs.writeFileSync(defaultPath, 'English,German\n', 'utf8');
    availableDatasets.push(DEFAULT_DATA_FILE);
  }

  const requestedDataset = resolveDatasetPath(dataset) ? dataset : null;
  const fallbackDataset = resolveDatasetPath(DEFAULT_DATA_FILE) ? DEFAULT_DATA_FILE : availableDatasets[0];
  const selectedDataset = requestedDataset || fallbackDataset;

  if (!selectedDataset) {
    throw new Error('Kein Dataset gefunden');
  }

  currentDataset = selectedDataset;
  vocabulary = getVocabularyFor(currentDataset);
  console.log(`Loaded ${vocabulary.length} words from dataset ${currentDataset}`);
}

app.get('/api/datasets', (req, res) => {
  const datasets = getDatasetList();
  res.json({ datasets, defaultDataset: currentDataset || (datasets[0] && datasets[0].name) || '' });
});

app.post('/api/datasets', (req, res) => {
  const nameRaw = (req.body.name || '').toString().trim();
  const name = normalizeDatasetName(nameRaw);

  if (!name) {
    return res.status(400).json({ success: false, message: 'Ungültiger Dateiname.' });
  }

  const filePath = path.join(DATA_DIR, name);
  if (fs.existsSync(filePath)) {
    return res.status(409).json({ success: false, message: 'Dataset existiert bereits.', dataset: name });
  }

  try {
    if (path.extname(name).toLowerCase() === '.csv') {
      fs.writeFileSync(filePath, 'English,German\n', 'utf8');
    } else {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([['English', 'German']]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, filePath);
    }

    res.status(201).json({ success: true, dataset: name });
  } catch (error) {
    console.error('Error creating dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Erstellen des Datasets.' });
  }
});

app.post('/api/datasets/rename', (req, res) => {
  const oldName = (req.body.oldName || '').toString().trim();
  const newNameRaw = (req.body.newName || '').toString().trim();
  const oldPath = resolveDatasetPath(oldName);

  if (!oldPath) {
    return res.status(404).json({ success: false, message: 'Das ausgewählte Dataset wurde nicht gefunden.' });
  }

  if (!newNameRaw) {
    return res.status(400).json({ success: false, message: 'Bitte gib einen neuen Namen ein.' });
  }

  const defaultExtension = path.extname(oldName).toLowerCase() || '.csv';
  const newName = normalizeDatasetName(newNameRaw, defaultExtension);
  const newPath = path.join(DATA_DIR, newName);

  if (oldName === newName) {
    return res.json({ success: true, dataset: oldName, unchanged: true });
  }

  if (fs.existsSync(newPath)) {
    return res.status(409).json({ success: false, message: 'Ein Dataset mit diesem Namen existiert bereits.' });
  }

  try {
    fs.renameSync(oldPath, newPath);
    const cached = datasetCache.get(oldName);
    invalidateDatasetCache(oldName);
    if (cached) {
      datasetCache.set(newName, cached);
    }
    if (currentDataset === oldName) {
      currentDataset = newName;
    }
    res.json({ success: true, dataset: newName });
  } catch (error) {
    console.error('Error renaming dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Umbenennen des Datasets.' });
  }
});

app.post('/api/datasets/delete', (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const filePath = resolveDatasetPath(name);

  if (!filePath) {
    return res.status(404).json({ success: false, message: 'Dataset nicht gefunden.' });
  }

  try {
    fs.unlinkSync(filePath);
    invalidateDatasetCache(name);
    if (currentDataset === name) {
      const datasets = getDatasetFiles();
      currentDataset = datasets[0] || '';
      vocabulary = currentDataset ? getVocabularyFor(currentDataset) : [];
    }
    res.json({ success: true, dataset: name });
  } catch (error) {
    console.error('Error deleting dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Löschen des Datasets.' });
  }
});

app.get('/api/vocabulary', (req, res) => {
  const dataset = req.query.dataset || currentDataset;
  try {
    loadVocabulary(dataset);
    res.json(vocabulary);
  } catch (error) {
    console.error('Error loading dataset:', error);
    res.status(500).json({ error: 'Dataset konnte nicht geladen werden.' });
  }
});

app.post('/api/check', (req, res) => {
  const { question, answer, direction = 'de-en', dataset } = req.body;
  const normalizedQuestion = (question || '').toString().trim().toLowerCase();
  const normalizedAnswer = (answer || '').toString().trim().toLowerCase();

  if (!normalizedQuestion || !normalizedAnswer) {
    return res.status(400).json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const targetDataset = dataset || currentDataset;
  let words;
  try {
    words = getVocabularyFor(targetDataset);
  } catch (error) {
    return res.status(404).json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const correctWord = direction === 'en-de'
    ? words.find(v => v.german.toLowerCase() === normalizedQuestion)
    : words.find(v => v.english.toLowerCase() === normalizedQuestion);

  if (!correctWord) {
    return res.json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const expectedAnswer = direction === 'en-de' ? correctWord.english : correctWord.german;
  const isCorrect = expectedAnswer.toLowerCase() === normalizedAnswer;

  res.json({ correct: isCorrect, correctAnswer: expectedAnswer });
});

app.post('/api/add-word', (req, res) => {
  const english = (req.body.english || '').toString().trim();
  const german = (req.body.german || '').toString().trim();
  const dataset = req.body.dataset || currentDataset;

  if (!english || !german) {
    return res.status(400).json({ success: false, message: 'Beide Felder müssen ausgefüllt sein.' });
  }

  if (!resolveDatasetPath(dataset)) {
    return res.status(404).json({ success: false, message: 'Dataset wurde nicht gefunden.' });
  }

  let targetWords;
  try {
    targetWords = getVocabularyFor(dataset);
  } catch (error) {
    return res.status(404).json({ success: false, message: 'Dataset wurde nicht gefunden.' });
  }

  const exists = targetWords.some(v => v.english.toLowerCase() === english.toLowerCase());
  if (exists) {
    return res.status(409).json({ success: false, message: 'Dieses Wort existiert bereits.' });
  }

  const newWord = { english, german };

  try {
    saveWordToDataset(dataset, newWord);
    invalidateDatasetCache(dataset);
    if (dataset === currentDataset) {
      vocabulary = getVocabularyFor(currentDataset);
    }
    res.json({ success: true, word: newWord, dataset });
  } catch (error) {
    console.error('Error saving word to dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Speichern des Wortes.' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  loadVocabulary(DEFAULT_DATA_FILE);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server also accessible at http://0.0.0.0:${PORT} (for network access)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist bereits belegt. Versuche einen anderen Port mit PORT=3000 node server.js`);
  } else {
    console.error('Serverfehler:', err);
  }
});