let vocabulary = [];
let wordQueue = [];
let incorrectWords = [];
let currentWord = null;
let correctCount = 0;
let incorrectCount = 0;
let totalCount = 0;

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

async function loadVocabulary() {
  try {
    const response = await fetch('/api/vocabulary');
    vocabulary = await response.json();
    document.getElementById('total-words').textContent = vocabulary.length;
    updateStats();
    rebuildQueue();
    renderUpcomingWords();

    if (vocabulary.length === 0) {
      alert('Keine Vokabeln gefunden. Bitte stellen Sie sicher, dass vocabulary.csv im Projektordner vorhanden ist.');
      document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
      document.getElementById('check-btn').disabled = true;
      return;
    }
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Laden der Vokabeln:', error);
  }
}

function updateStats() {
  document.getElementById('correct-count').textContent = correctCount;
  document.getElementById('incorrect-count').textContent = incorrectCount;
  document.getElementById('total-count').textContent = totalCount;
}

function renderUpcomingWords() {
  const list = document.getElementById('upcoming-list');
  list.innerHTML = '';

  const nextItem = incorrectWords.length > 0 ? incorrectWords[0] : wordQueue[0];
  if (!nextItem) {
    const empty = document.createElement('div');
    empty.className = 'upcoming-item';
    empty.textContent = 'Keine bevorstehenden Wörter verfügbar.';
    list.appendChild(empty);
    return;
  }

  const row = document.createElement('div');
  row.className = 'upcoming-item';
  row.textContent = nextItem.english;
  list.appendChild(row);
}

function addNewWord() {
  const englishInput = document.getElementById('new-english');
  const germanInput = document.getElementById('new-german');
  const english = englishInput.value.trim();
  const german = germanInput.value.trim();

  if (!english || !german) {
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = 'Bitte beide Felder ausfüllen.';
    resultDiv.className = 'hint';
    return;
  }

  const exists = vocabulary.some(v => v.english.toLowerCase() === english.toLowerCase());
  if (exists) {
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = 'Dieses englische Wort existiert bereits.';
    resultDiv.className = 'incorrect';
    return;
  }

  vocabulary.push({ english, german });
  document.getElementById('total-words').textContent = vocabulary.length;
  renderUpcomingWords();
  englishInput.value = '';
  germanInput.value = '';
  englishInput.focus();

  const resultDiv = document.getElementById('result');
  resultDiv.textContent = `Wort hinzugefügt: ${english} → ${german}`;
  resultDiv.className = 'correct';
}

function resetQuiz() {
  incorrectWords = [];
  correctCount = 0;
  incorrectCount = 0;
  totalCount = 0;
  updateStats();
  document.getElementById('result').textContent = 'Quiz zurückgesetzt. Lade neue Vokabel...';
  document.getElementById('result').className = 'hint';
  document.getElementById('next-btn').classList.add('hidden');
  loadVocabulary();
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
    } else {
      incorrectCount++;
      resultDiv.textContent = `❌ Falsch! Richtige Antwort: ${data.correctAnswer}`;
      resultDiv.className = 'incorrect';
      if (currentWord && !incorrectWords.some(v => v.english === currentWord.english)) {
        incorrectWords.push(currentWord);
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

document.addEventListener('DOMContentLoaded', () => {
  loadVocabulary();

  document.getElementById('check-btn').addEventListener('click', () => checkAnswer(false));
  document.getElementById('next-btn').addEventListener('click', showNextWord);
  document.getElementById('restart-btn').addEventListener('click', resetQuiz);
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