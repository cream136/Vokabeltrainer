# Einmaliger Parser: Verbliste aus dem PDF-Text nach verb-data.json (selbstbeendend)
import json, re

lines = open(r'c:\Users\sku\Documents\Projekte\Vokabeltrainer\pdf-text.tmp.txt', encoding='utf-8').read().splitlines()
skip = re.compile(r'^(Unregelm|Seite \d|Infinitive|Simple Past|Past Participle|Deutsch|In den Listen|---SEITE---|Hinweise|Quelle|Doppelte|.*englisch-hilfen)')
content = [l.strip() for l in lines if l.strip() and not skip.match(l.strip())]

verbs, i = [], 0
classes_re = re.compile(r'^\d[\d\-\s\.\u00b7]*$')
while i + 5 <= len(content):
    block = content[i:i+5]
    if not classes_re.match(block[4]):
        i += 1
        continue
    infinitive = re.sub(r'\*+$', '', block[0]).strip()
    verbs.append({
        'infinitive': infinitive,
        'past': block[1].strip(),
        'participle': block[2].strip(),
        'german': block[3].strip(),
        'classes': block[4].replace('\u00b7', ' ').strip()
    })
    i += 5

out = r'c:\Users\sku\Documents\Projekte\Vokabeltrainer\verb-data.json'
with open(out, 'w', encoding='utf-8') as f:
    json.dump(verbs, f, ensure_ascii=False, indent=2)
print('Anzahl Verben:', len(verbs))
print('Probe:', json.dumps(verbs[:3], ensure_ascii=False))
dups = len(verbs) - len({v['infinitive'] for v in verbs})
print('Duplikate:', dups)
missing = [v for v in verbs if not (v['infinitive'] and v['past'] and v['participle'] and v['german'])]
print('Unvollstaendig:', len(missing))
