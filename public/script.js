let vocabulary = [];
let wordQueue = [];
let currentWord = null;
let correctCount = 0;
let incorrectCount = 0;
let totalCount = 0;
let answeredWords = { correct: [], incorrect: [] };
let selectedDataset = '';
let learningDirection = 'de-en';
let quizFinished = false;

const directionConfig = {
  'de-en': {
    questionKey: 'english',
    answerKey: 'german',
    answerPlaceholder: 'Deutsche Übersetzung'
  },
  'en-de': {
    questionKey: 'german',
    answerKey: 'english',
    answerPlaceholder: 'Englische Übersetzung'
  }
};

function getDirectionConfig() {
  return directionConfig[learningDirection] || directionConfig['de-en'];
}

function updateAnswerInput() {
  const answerInput = document.getElementById('german-input');
  const config = getDirectionConfig();
  answerInput.placeholder = config.answerPlaceholder;
  updateQuizLabels();
}

function updateQuizLabels() {
  const config = getDirectionConfig();
  const directionBanner = document.getElementById('direction-banner');
  const questionLabel = document.getElementById('question-label');
  const answerLabel = document.getElementById('answer-label');

  directionBanner.textContent = config.questionKey === 'english'
    ? 'Deutsch → Englisch'
    : 'Englisch → Deutsch';

  questionLabel.textContent = config.questionKey === 'english' ? 'Deutsch' : 'Englisch';
  answerLabel.textContent = config.questionKey === 'english' ? 'Englisch' : 'Deutsch';
}

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
    return data;
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

    const datasets = await loadDatasets();
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

    const datasets = await loadDatasets();
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

async function deleteDataset() {
  const resultDiv = document.getElementById('result');

  if (!selectedDataset) {
    resultDiv.textContent = 'Bitte wähle zuerst ein Dataset aus.';
    resultDiv.className = 'hint';
    return;
  }

  const confirmed = confirm(`Möchtest du das Dataset "${selectedDataset}" wirklich löschen?`);
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch('/api/datasets/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedDataset })
    });

    const data = await response.json();
    if (!response.ok) {
      resultDiv.textContent = data.message || 'Fehler beim Löschen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    const datasets = await loadDatasets();
    selectedDataset = (datasets && datasets.defaultDataset) || (datasets && datasets.datasets && datasets.datasets[0] && datasets.datasets[0].name) || '';
    document.getElementById('dataset-select').value = selectedDataset;

    if (selectedDataset) {
      await loadVocabulary(selectedDataset);
    } else {
      vocabulary = [];
      wordQueue = [];
      renderUpcomingWords();
      document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
      document.getElementById('check-btn').disabled = true;
    }

    resultDiv.textContent = `Dataset gelöscht: ${data.dataset}`;
    resultDiv.className = 'correct';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Löschen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Delete dataset failed', error);
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
  const config = getDirectionConfig();
  list.innerHTML = '';

  const seen = new Set();
  const nextWords = [];
  const pushUnique = item => {
    const key = `${item.english}|${item.german}`;
    if (seen.has(key)) return;
    seen.add(key);
    nextWords.push(item);
  };
  for (const item of wordQueue) {
    if (nextWords.length >= 3) break;
    pushUnique(item);
  }

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
    row.textContent = `${index + 1}. ${item[config.questionKey]}`;
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

  quizFinished = false;
  wordQueue = [];
  currentWord = null;
  correctCount = 0;
  incorrectCount = 0;
  totalCount = 0;
  answeredWords = { correct: [], incorrect: [] };
  updateStats();
  document.getElementById('german-input').disabled = false;
  document.getElementById('result').textContent = 'Quiz zurückgesetzt. Lade neue Vokabel...';
  document.getElementById('result').className = 'hint';
  document.getElementById('next-btn').classList.add('hidden');
  resetAiPanel();
  loadVocabulary(selectedDataset);
}

async function finishQuiz() {
  if (!confirm('Möchtest du die Anwendung wirklich beenden? Dein Lernstand wird gespeichert und beim nächsten Start wieder geladen.')) {
    return;
  }

  const resultDiv = document.getElementById('result');
  resultDiv.textContent = 'Speichere Lernstand und beende die Anwendung...';
  resultDiv.className = 'hint';
  document.getElementById('finish-btn').disabled = true;

  const state = {
    dataset: selectedDataset,
    direction: learningDirection,
    correctCount,
    incorrectCount,
    totalCount,
    answeredWords,
    wordQueue
  };

  let saved = false;
  let serverMessage = '';
  try {
    const response = await fetch('/api/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // z.B. 404-HTML-Seite statt JSON
    }
    saved = response.ok && !!data && data.success === true;
    if (response.status === 404) {
      serverMessage = 'Der Server kennt die Enden-Funktion nicht. Bitte Anwendung neu starten (npm start bzw. node server.js), damit die neue Server-Version läuft.';
    } else if (data && data.message) {
      serverMessage = data.message;
    }
    if (!saved && !serverMessage) {
      serverMessage = `Server-Antwort: HTTP ${response.status}`;
    }
  } catch (error) {
    console.error('Fehler beim Beenden der Anwendung:', error);
    serverMessage = 'Der Server ist nicht erreichbar. Läuft die Anwendung (npm start bzw. node server.js)?';
  }

  if (!saved) {
    resultDiv.textContent = `Fehler: Der Lernstand konnte nicht gespeichert werden. ${serverMessage}`;
    resultDiv.className = 'incorrect';
    document.getElementById('finish-btn').disabled = false;
    return;
  }

  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  // Fenster schließen (wirkt nur, wenn die Seite per Skript geöffnet wurde).
  window.close();
  // Fallback: saubere „Beendet"-Anzeige, damit klar ist, dass die App sich geschlossen hat.
  showShutdownScreen(accuracy);
}

function showShutdownScreen(accuracy) {
  const container = document.querySelector('.container');
  if (!container) {
    return;
  }

  let summary = '';
  if (totalCount > 0) {
    summary = `<p>📊 Letzter Stand: ${correctCount} richtig, ${incorrectCount} falsch von ${totalCount} Versuchen (${accuracy} %).</p>`;
  }

  container.innerHTML = `
    <h1>🏁 Vokabeltrainer wurde beendet</h1>
    <p>Dein Lernstand wurde gespeichert und wird beim nächsten Start automatisch geladen.</p>
    ${summary}
    <p class="hint" style="margin-top:1.5rem;">Du kannst dieses Fenster jetzt schließen.</p>`;
}

async function restoreLastState() {
  try {
    const response = await fetch('/api/state');
    const data = await response.json();
    if (!data || !data.hasState || !data.state) {
      return;
    }

    const saved = data.state;
    const select = document.getElementById('dataset-select');
    const datasetExists = Array.from(select.options).some(option => option.value === saved.dataset);
    if (!datasetExists) {
      return;
    }

    selectedDataset = saved.dataset;
    select.value = saved.dataset;
    learningDirection = (saved.direction === 'en-de' || saved.direction === 'de-en') ? saved.direction : 'de-en';
    document.getElementById('direction-select').value = learningDirection;
    updateAnswerInput();

    correctCount = Number(saved.correctCount) || 0;
    incorrectCount = Number(saved.incorrectCount) || 0;
    totalCount = Number(saved.totalCount) || 0;
    answeredWords = {
      correct: saved.answeredWords && Array.isArray(saved.answeredWords.correct) ? saved.answeredWords.correct : [],
      incorrect: saved.answeredWords && Array.isArray(saved.answeredWords.incorrect) ? saved.answeredWords.incorrect : []
    };
    if (Array.isArray(saved.wordQueue) && saved.wordQueue.length > 0) {
      wordQueue = saved.wordQueue;
    }
    // Altes Standformat: fehlbeantwortete Wörter an das Ende der Queue anhängen.
    if (Array.isArray(saved.incorrectWords)) {
      for (const item of saved.incorrectWords) {
        if (item && !wordQueue.some(v => v.english === item.english && v.german === item.german)) {
          wordQueue.push(item);
        }
      }
    }
    currentWord = null;

    updateStats();
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = '🔄 Letzter Lernstand wiederhergestellt – die Runde kann fortgesetzt werden.';
    resultDiv.className = 'hint';
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Wiederherstellen des letzten Standes:', error);
  }
}

function getNextWordFromQueue() {
  if (wordQueue.length === 0) {
    rebuildQueue();
  }

  return wordQueue.shift();
}

function showNextWord() {
  const resultDiv = document.getElementById('result');
  const config = getDirectionConfig();
  resultDiv.textContent = 'Gib die Übersetzung ein und klicke auf Prüfen.';
  resultDiv.className = 'hint';

  currentWord = getNextWordFromQueue();
  if (!currentWord) {
    document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
    document.getElementById('german-input').value = '';
    updateAnswerInput();
    document.getElementById('check-btn').disabled = true;
    renderUpcomingWords();
    return;
  }

  document.getElementById('english-word').textContent = currentWord[config.questionKey];
  document.getElementById('german-input').value = '';
  updateAnswerInput();
  document.getElementById('german-input').focus();
  document.getElementById('check-btn').disabled = false;
  document.getElementById('next-btn').classList.add('hidden');
  renderUpcomingWords();
  resetAiPanel();
}

async function checkAnswer(autoNext = false) {
  const question = document.getElementById('english-word').textContent;
  const answer = document.getElementById('german-input').value.trim();
  const resultDiv = document.getElementById('result');

  if (quizFinished) {
    resultDiv.textContent = 'Das Quiz wurde beendet. Klicke auf „Neu starten", um zu lernen.';
    resultDiv.className = 'hint';
    return;
  }

  if (!answer) {
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
      body: JSON.stringify({ question, answer, direction: learningDirection, dataset: selectedDataset }),
    });

    const data = await response.json();
    totalCount++;

    if (data.correct) {
      correctCount++;
      resultDiv.textContent = '✅ Richtig!';
      resultDiv.className = 'correct';
      if (currentWord && !answeredWords.correct.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        answeredWords.correct.push(currentWord);
      }
    } else {
      incorrectCount++;
      resultDiv.textContent = `❌ Falsch! Richtige Antwort: ${data.correctAnswer}`;
      resultDiv.className = 'incorrect';
      // Wort kommt am Ende der Runde noch einmal dran, blockiert aber nicht die nächsten Wörter.
      if (currentWord && !wordQueue.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        wordQueue.push(currentWord);
      }
      if (currentWord && !answeredWords.incorrect.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        answeredWords.incorrect.push(currentWord);
      }
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

// ── KI-Hilfe ──────────────────────────────────────────────────────────────────
async function fetchAiHelper() {
  const word = document.getElementById('english-word').textContent.trim();
  const btnLabel = document.getElementById('ai-btn-label');
  const spinner = document.getElementById('ai-spinner');
  const resultDiv = document.getElementById('ai-result');
  const aiBtn = document.getElementById('ai-btn');

  if (!word || word === 'Lädt...' || word === 'Keine Wörter verfügbar') {
    resultDiv.textContent = 'Bitte warte, bis ein Wort geladen ist.';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('ai-error');
    return;
  }

  aiBtn.disabled = true;
  btnLabel.classList.add('hidden');
  spinner.classList.remove('hidden');
  resultDiv.classList.add('hidden');
  resultDiv.classList.remove('ai-error');

  try {
    const response = await fetch('/api/ai-helper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    });

    const data = await response.json();

    if (data.success) {
      resultDiv.textContent = data.info;
      resultDiv.classList.remove('hidden');
    } else {
      resultDiv.textContent = data.message || 'Fehler bei der KI-Anfrage.';
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('ai-error');
    }
  } catch (error) {
    console.error('AI Helper Fehler:', error);
    resultDiv.textContent = 'Fehler: Alle KI-Provider fehlgeschlagen. Bitte API-Keys in der .env-Datei prüfen (OPENAI_API_KEY, GROQ_API_KEY oder GEMINI_API_KEY).';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('ai-error');
  } finally {
    aiBtn.disabled = false;
    btnLabel.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

function resetAiPanel() {
  const resultDiv = document.getElementById('ai-result');
  if (resultDiv) {
    resultDiv.textContent = '';
    resultDiv.classList.add('hidden');
    resultDiv.classList.remove('ai-error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadDatasets();
  updateAnswerInput();
  await loadVocabulary();
  await restoreLastState();

  document.getElementById('dataset-select').addEventListener('change', async (event) => {
    selectedDataset = event.target.value;
    resetQuiz(selectedDataset);
  });

  document.getElementById('direction-select').addEventListener('change', (event) => {
    learningDirection = event.target.value;
    updateAnswerInput();
    resetQuiz(selectedDataset);
  });

  document.getElementById('create-dataset-btn').addEventListener('click', createDataset);
  document.getElementById('rename-dataset-btn').addEventListener('click', renameDataset);
  document.getElementById('delete-dataset-btn').addEventListener('click', deleteDataset);
  document.getElementById('ai-btn').addEventListener('click', fetchAiHelper);

  document.getElementById('check-btn').addEventListener('click', () => checkAnswer(false));
  document.getElementById('next-btn').addEventListener('click', showNextWord);
  document.getElementById('restart-btn').addEventListener('click', () => resetQuiz(selectedDataset));
  document.getElementById('next-question-btn').addEventListener('click', showNextWord);
  document.getElementById('finish-btn').addEventListener('click', finishQuiz);
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