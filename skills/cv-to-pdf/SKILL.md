---
name: cv-to-pdf
description: Use when converting a CV markdown file to a printable PDF via HTML/CSS, to prepare a job application document.
---

# CV to PDF

## Overview

Pipeline : CV Markdown → HTML/CSS → PDF prêt à candidater.
Projet source : `~/Projects/career/`.

## Fichiers CV

| Langue | Source | Sortie HTML | Sortie PDF |
|--------|--------|-------------|------------|
| Français | `cv/cv-fr.md` | `cv/cv-fr.html` | `cv/cv-fr.pdf` |
| Anglais | `cv/cv-en.md` | `cv/cv-en.html` | `cv/cv-en.pdf` |

## Processus

### 1. Lire le CV source

Toujours lire le fichier markdown avant de générer.
Identifier la langue (fr/en) et adapter les labels si besoin.

### 2. Générer le HTML

Produire un fichier HTML autonome (CSS inline ou `<style>` embarqué — **pas de dépendance externe**).

**Template minimal :**
```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>CV — Bastian Chuttarsing</title>
  <style>
    /* === MISE EN FORME À DÉFINIR === */
    /* Placeholder : style sera spécifié dans une session dédiée */
    body { font-family: sans-serif; max-width: 800px; margin: auto; padding: 2rem; }
    h1 { font-size: 1.8rem; }
    h2 { border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { font-size: 1rem; margin-bottom: 0.25rem; }
    p, li { font-size: 0.9rem; line-height: 1.5; }
  </style>
</head>
<body>
  <!-- contenu HTML généré depuis le markdown -->
</body>
</html>
```

> **Note :** La mise en forme finale (typographie, couleurs, layout) sera définie séparément.
> Ce template est fonctionnel mais volontairement neutre.

### 3. Exporter en PDF

Ordre de préférence selon les outils disponibles :

```bash
# Option A — Chromium headless (recommandé)
chromium-browser --headless --disable-gpu \
  --print-to-pdf=cv/cv-fr.pdf \
  --print-to-pdf-no-header cv/cv-fr.html

# Option B — wkhtmltopdf
wkhtmltopdf --page-size A4 --margin-top 15mm --margin-bottom 15mm \
  --margin-left 15mm --margin-right 15mm \
  cv/cv-fr.html cv/cv-fr.pdf

# Option C — pandoc (si wkhtmltopdf installé en backend)
pandoc cv/cv-fr.md -o cv/cv-fr.pdf \
  --pdf-engine=wkhtmltopdf \
  -V geometry:margin=1.5cm
```

Vérifier l'outil disponible :
```bash
which chromium-browser || which chromium || which wkhtmltopdf || which pandoc
```

### 4. Vérifier le résultat

- Ouvrir le PDF : `xdg-open cv/cv-fr.pdf`
- Contrôler : une seule page A4, pas de coupure entre sections, texte lisible
- Si multi-page : réduire `font-size` ou `padding` dans le CSS

### 5. Committer (si demandé)

```bash
committer cv/cv-fr.html cv/cv-fr.pdf
# message : docs: generate HTML/PDF export cv-fr
```

## Règles

- HTML autoportant : **zéro dépendance externe** (polices Google, CDN, etc.)
- Ne jamais écraser le fichier `.md` source
- PDF = A4, marges ≥ 10 mm
- Mise en forme neutre jusqu'à validation du design final

## Erreurs courantes

| Symptôme | Cause | Fix |
|----------|-------|-----|
| PDF blanc | Chemin HTML relatif incorrect | Utiliser chemin absolu |
| Texte coupé | Font trop grande ou padding excessif | Réduire dans le CSS |
| Polices manquantes | Dépendance externe | CSS inline uniquement |
| Multi-pages non voulues | Contenu trop long | Compresser ou font-size 0.85rem |
