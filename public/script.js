let vocabulary = [];
let wordQueue = [];
let incorrectWords = [];
let currentWord = null;
let correctCount = 0;
let incorrectCount = 0;
let totalCount = 0;
let answeredWords = { correct: [], incorrect: [] };
let selectedDataset = '';

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function rebuildQueue() {
  wordQueue = shuffle(vocabulary.map(item => ({ ...item })));
}

async function loadDatasets() {
  try {
    const response = await fetch('/api/datasets');
    const data = await response.json();
    const select = document.getElementById('dataset-select');
    select.innerHTML = '';

    if (!data.datasets || data.datasets.length === 0) {
      select.innerHTML = '<option value="">Keine Datensätze gefunden</option>';
      selectedDataset = '';
      return;
    }

    data.datasets.forEach(dataset => {
      const option = document.createElement('option');
      option.value = dataset.name;
      option.textContent = dataset.label;
      if (dataset.name === data.defaultDataset) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    selectedDataset = data.defaultDataset || data.datasets[0].name;
  } catch (error) {
    console.error('Fehler beim Laden der Datensätze:', error);
  }
}

async function createDataset() {
  const input = document.getElementById('dataset-name');
  const resultDiv = document.getElementById('result');
  const name = input.value.trim();

  if (!name) {
    resultDiv.textContent = 'Bitte vergib einen Namen für das neue Dataset.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const response = await fetch('/api/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const data = await response.json();
    if (!response.ok && response.status !== 409) {
      resultDiv.textContent = data.message || 'Fehler beim Erstellen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    await loadDatasets();
    selectedDataset = data.dataset || name;
    document.getElementById('dataset-select').value = selectedDataset;
    await loadVocabulary(selectedDataset);

    resultDiv.textContent = response.status === 409 ?
      `Dataset existiert bereits: ${selectedDataset}` :
      `Dataset erstellt: ${selectedDataset}`;
    resultDiv.className = 'correct';
    input.value = '';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Erstellen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Create dataset failed', error);
  }
}

async function renameDataset() {
  const input = document.getElementById('dataset-rename');
  const resultDiv = document.getElementById('result');
  const name = input.value.trim();

  if (!selectedDataset) {
    resultDiv.textContent = 'Bitte wähle zuerst ein Dataset aus.';
    resultDiv.className = 'hint';
    return;
  }

  if (!name) {
    resultDiv.textContent = 'Bitte gib einen neuen Namen ein.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const response = await fetch('/api/datasets/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName: selectedDataset, newName: name })
    });

    const data = await response.json();
    if (!response.ok) {
      resultDiv.textContent = data.message || 'Fehler beim Umbenennen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    await loadDatasets();
    selectedDataset = data.dataset;
    document.getElementById('dataset-select').value = selectedDataset;
    await loadVocabulary(selectedDataset);

    resultDiv.textContent = `Dataset umbenannt in ${selectedDataset}`;
    resultDiv.className = 'correct';
    input.value = '';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Umbenennen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Rename dataset failed', error);
  }
}

async function loadVocabulary(dataset = selectedDataset) {
  if (!dataset) {
    await loadDatasets();
    dataset = selectedDataset;
  }

  try {
    const response = await fetch(`/api/vocabulary?dataset=${encodeURIComponent(dataset)}`);
    if (!response.ok) {
      throw new Error('Dataset konnte nicht geladen werden.');
    }

    vocabulary = await response.json();
    document.getElementById('total-words').textContent = vocabulary.length;
    updateStats();
    rebuildQueue();
    renderUpcomingWords();

    if (vocabulary.length === 0) {
      const label = document.querySelector('#dataset-select option:checked')?.textContent || 'Ausgewählter Datensatz';
      alert(`Keine Vokabeln im Datensatz ${label} gefunden.`);
      document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
      document.getElementById('check-btn').disabled = true;
      return;
    }
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Laden der Vokabeln:', error);
    document.getElementById('result').textContent = 'Fehler beim Laden des Datensatzes.';
    document.getElementById('result').className = 'incorrect';
  }
}

function updateStats() {
  document.getElementById('correct-count').textContent = correctCount;
  document.getElementById('incorrect-count').textContent = incorrectCount;
  document.getElementById('total-count').textContent = totalCount;

  updateWordLists();
}

function updateWordLists() {
  const correctList = document.getElementById('correct-words');
  const incorrectList = document.getElementById('incorrect-words');

  correctList.innerHTML = '';
  incorrectList.innerHTML = '';

  answeredWords.correct.forEach(word => {
    const item = document.createElement('div');
    item.className = 'word-list-item';
    item.textContent = `${word.english} → ${word.german}`;
    correctList.appendChild(item);
  });

  answeredWords.incorrect.forEach(word => {
    const item = document.createElement('div');
    item.className = 'word-list-item';
    item.textContent = `${word.english} → ${word.german}`;
    incorrectList.appendChild(item);
  });
}

function renderUpcomingWords() {
  const list = document.getElementById('upcoming-list');
  list.innerHTML = '';

  const nextWords = incorrectWords.length > 0 ? incorrectWords.slice(0, 3) : wordQueue.slice(0, 3);
  if (nextWords.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'upcoming-item';
    empty.textContent = 'Keine bevorstehenden Wörter verfügbar.';
    list.appendChild(empty);
    return;
  }

  nextWords.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'upcoming-item';
    row.textContent = `${index + 1}. ${item.english}`;
    list.appendChild(row);
  });
}

async function addNewWord() {
  const englishInput = document.getElementById('new-english');
  const germanInput = document.getElementById('new-german');
  const english = englishInput.value.trim();
  const german = germanInput.value.trim();
  const resultDiv = document.getElementById('result');

  if (!english || !german) {
    resultDiv.textContent = 'Bitte beide Felder ausfüllen.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const response = await fetch('/api/add-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ english, german, dataset: selectedDataset })
    });

    const data = await response.json();
    if (!response.ok) {
      resultDiv.textContent = data.message || 'Fehler beim Hinzufügen.';
      resultDiv.className = 'incorrect';
      return;
    }

    vocabulary.push(data.word);
    wordQueue.push(data.word);
    document.getElementById('total-words').textContent = vocabulary.length;
    renderUpcomingWords();
    englishInput.value = '';
    germanInput.value = '';
    englishInput.focus();

    resultDiv.textContent = `Wort hinzugefügt: ${english} → ${german}`;
    resultDiv.className = 'correct';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Hinzufügen. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Add word failed', error);
  }
}

function resetQuiz(dataset = selectedDataset) {
  if (dataset) {
    selectedDataset = dataset;
  }

  incorrectWords = [];
  wordQueue = [];
  currentWord = null;
  correctCount = 0;
  incorrectCount = 0;
  totalCount = 0;
  answeredWords = { correct: [], incorrect: [] };
  updateStats();
  document.getElementById('result').textContent = 'Quiz zurückgesetzt. Lade neue Vokabel...';
  document.getElementById('result').className = 'hint';
  document.getElementById('next-btn').classList.add('hidden');
  loadVocabulary(selectedDataset);
}

function getNextWordFromQueue() {
  if (incorrectWords.length > 0) {
    return incorrectWords.shift();
  }

  if (wordQueue.length === 0) {
    rebuildQueue();
  }

  return wordQueue.shift();
}

function showNextWord() {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = 'Gib die Übersetzung ein und klicke auf Prüfen.';
  resultDiv.className = 'hint';

  currentWord = getNextWordFromQueue();
  if (!currentWord) {
    document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
    document.getElementById('german-input').value = '';
    document.getElementById('check-btn').disabled = true;
    renderUpcomingWords();
    return;
  }

  document.getElementById('english-word').textContent = currentWord.english;
  document.getElementById('german-input').value = '';
  document.getElementById('german-input').focus();
  document.getElementById('check-btn').disabled = false;
  document.getElementById('next-btn').classList.add('hidden');
  renderUpcomingWords();
}

async function checkAnswer(autoNext = false) {
  const english = document.getElementById('english-word').textContent;
  const german = document.getElementById('german-input').value.trim();
  const resultDiv = document.getElementById('result');

  if (!german) {
    resultDiv.textContent = 'Bitte gib eine Antwort ein.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ english, german }),
    });

    const data = await response.json();
    totalCount++;

    if (data.correct) {
      correctCount++;
      resultDiv.textContent = '✅ Richtig!';
      resultDiv.className = 'correct';
      answeredWords.correct.push(currentWord);
    } else {
      incorrectCount++;
      resultDiv.textContent = `❌ Falsch! Richtige Antwort: ${data.correctAnswer}`;
      resultDiv.className = 'incorrect';
      if (currentWord && !incorrectWords.some(v => v.english === currentWord.english)) {
        incorrectWords.push(currentWord);
      }
      answeredWords.incorrect.push(currentWord);
    }

    updateStats();
    document.getElementById('check-btn').disabled = true;
    document.getElementById('next-btn').classList.remove('hidden');

    if (autoNext) {
      setTimeout(() => {
        showNextWord();
      }, 2000);
    }
  } catch (error) {
    console.error('Fehler beim Prüfen der Antwort:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadDatasets();
  await loadVocabulary();

  document.getElementById('dataset-select').addEventListener('change', async (event) => {
    selectedDataset = event.target.value;
    resetQuiz(selectedDataset);
  });

  document.getElementById('create-dataset-btn').addEventListener('click', createDataset);
  document.getElementById('rename-dataset-btn').addEventListener('click', renameDataset);

  document.getElementById('check-btn').addEventListener('click', () => checkAnswer(false));
  document.getElementById('next-btn').addEventListener('click', showNextWord);
  document.getElementById('restart-btn').addEventListener('click', () => resetQuiz(selectedDataset));
  document.getElementById('add-word-btn').addEventListener('click', addNewWord);

  document.getElementById('german-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      checkAnswer(true);
    }
  });

  document.getElementById('new-german').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewWord();
    }
  });
});