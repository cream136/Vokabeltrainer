let vocabulary = [];
let incorrectWords = [];
let correctCount = 0;
let incorrectCount = 0;
let totalCount = 0;

async function loadVocabulary() {
  try {
    const response = await fetch('/api/vocabulary');
    vocabulary = await response.json();
    document.getElementById('total-words').textContent = vocabulary.length;
    updateStats();

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

function showNextWord() {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = 'Gib die Übersetzung ein und klicke auf Prüfen.';
  resultDiv.className = 'hint';

  let word;
  if (incorrectWords.length > 0) {
    word = incorrectWords.shift();
  } else if (vocabulary.length > 0) {
    const randomIndex = Math.floor(Math.random() * vocabulary.length);
    word = vocabulary[randomIndex];
  } else {
    document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
    document.getElementById('german-input').value = '';
    document.getElementById('check-btn').disabled = true;
    return;
  }

  document.getElementById('english-word').textContent = word.english;
  document.getElementById('german-input').value = '';
  document.getElementById('german-input').focus();
  document.getElementById('check-btn').disabled = false;
  document.getElementById('next-btn').classList.add('hidden');
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
      const currentWord = vocabulary.find(v => v.english === english);
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

  document.getElementById('german-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      checkAnswer(true);
    }
  });
});