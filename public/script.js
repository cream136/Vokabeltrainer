let vocabulary = [];
let currentIndex = 0;
let incorrectWords = [];

async function loadVocabulary() {
  try {
    const response = await fetch('/api/vocabulary');
    vocabulary = await response.json();
    if (vocabulary.length === 0) {
      alert('Keine Vokabeln gefunden. Bitte stellen Sie sicher, dass vocabulary.xlsx im Projektordner vorhanden ist.');
      return;
    }
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Laden der Vokabeln:', error);
  }
}

function showNextWord() {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = '';
  resultDiv.className = '';

  let word;
  if (incorrectWords.length > 0) {
    word = incorrectWords.shift();
  } else if (vocabulary.length > 0) {
    word = vocabulary[currentIndex % vocabulary.length];
    currentIndex++;
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

async function checkAnswer() {
  const english = document.getElementById('english-word').textContent;
  const german = document.getElementById('german-input').value.trim();
  const resultDiv = document.getElementById('result');

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ english, german }),
    });

    const data = await response.json();

    if (data.correct) {
      resultDiv.textContent = 'Richtig!';
      resultDiv.className = 'correct';
    } else {
      resultDiv.textContent = `Falsch! Richtige Antwort: ${data.correctAnswer}`;
      resultDiv.className = 'incorrect';
      // Add to incorrect words for repetition
      const currentWord = vocabulary.find(v => v.english === english);
      if (currentWord) {
        incorrectWords.push(currentWord);
      }
    }

    document.getElementById('check-btn').disabled = true;
    document.getElementById('next-btn').classList.remove('hidden');
  } catch (error) {
    console.error('Fehler beim Prüfen der Antwort:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadVocabulary();

  document.getElementById('check-btn').addEventListener('click', checkAnswer);
  document.getElementById('next-btn').addEventListener('click', showNextWord);

  document.getElementById('german-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      checkAnswer();
    }
  });
});