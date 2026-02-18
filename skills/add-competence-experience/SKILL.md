---
name: add-competence-experience
description: Use when the user describes a new experience, tool, or skill to add to the career repository competency files.
---

# Ajouter une expérience ou compétence

## Overview

Intégrer une nouvelle entrée dans les fichiers de compétences ou d'expérience du projet `~/Projects/career/`, en conservant la cohérence de format existant.

## Fichiers cibles

| Fichier | Contenu |
|---------|---------|
| `cv/cv-fr.md` | Expériences pro, formation, projets (FR) |
| `cv/cv-en.md` | Idem en anglais |
| `competences/technique.md` | Skills techniques (langages, frameworks, outils) |
| `competences/soft.md` | Soft skills, méthodes, langues |

## Processus

### 1. Lire le fichier cible

**Toujours lire avant d'éditer.**

```
Lire : competences/technique.md
Lire : competences/soft.md
Lire : cv/cv-fr.md  (si expérience pro ou projet)
```

Identifier la section où l'entrée s'insère logiquement.

### 2. Extraire les informations de la description utilisateur

À partir de ce que l'utilisateur décrit, extraire :

| Champ | Exemple |
|-------|---------|
| Nom de l'outil/techno/expérience | "LangGraph", "MLflow", "mission freelance chez XYZ" |
| Catégorie | MLOps, NLP, Computer Vision, Web/API, etc. |
| Contexte d'utilisation | projet, CDI, freelance, formation |
| Niveau/durée si pertinent | "utilisé en prod 6 mois", "notion", "expert" |
| Stack associée | outils utilisés en parallèle |

Si une information est manquante et nécessaire pour le bon formatage, **demander** avant d'écrire.

### 3. Identifier la section dans le fichier

**Pour `competences/technique.md`** — sections existantes :
- Langages
- ML / Deep Learning
- Computer Vision
- NLP / LLMs
- MLOps
- Data
- Web / API
- Outils
- Bases de données

Insérer dans la section la plus proche. Si aucune section ne convient, proposer d'en créer une nouvelle.

**Pour `cv/cv-fr.md`** — hiérarchie :
```
## Expériences Professionnelles
  ### Titre — Entreprise (période · type)
    - bullet point de responsabilité
      **Stack :** outil1, outil2

## Projets Notables
  - **Nom projet** — description courte (Stack1, Stack2)
```

### 4. Formater l'entrée

Respecter le style existant :

**Compétence technique** (dans `competences/technique.md`) :
```markdown
- **NomOutil** — description courte en français, usage principal
```

**Sous-expérience dans un poste existant** (dans `cv/cv-fr.md`) :
```markdown
- Nouvelle responsabilité ou mission effectuée
  **Stack :** Outil1, Outil2
```

**Nouveau projet notable** :
```markdown
- **Nom Projet** — Description en une ligne (Techno1, Techno2)
```

Pas d'emoji, pas de fioriture. Style télégraphique, cohérent avec le reste.

### 5. Editer le fichier

Utiliser l'outil `Edit` pour insérer sans toucher le reste du contenu.

- Insérer dans la bonne section, à la bonne position (chronologique pour les expériences, thématique pour les compétences)
- Ne pas reformater les sections existantes
- Ne pas changer la langue du fichier

### 6. Vérifier

Relire le bloc modifié. S'assurer :
- Indentation cohérente
- Aucune section existante modifiée accidentellement
- Même style que les entrées voisines

### 7. Committer (si demandé)

```bash
committer competences/technique.md
# message : docs: add [nom_outil] to technical competencies
```

ou

```bash
committer cv/cv-fr.md cv/cv-en.md
# message : docs: add [expérience] to professional experience
```

## Règles

- Lire avant d'écrire, toujours
- Demander si l'info est insuffisante pour le placement ou le formatage
- Ne modifier que la section concernée
- Mettre à jour les deux langues (fr + en) si l'entrée concerne le CV
- Pas de reformatage global, pas de réorganisation non demandée

## Exemple

**Utilisateur dit :** "j'ai utilisé MLflow pour le tracking d'expériences dans mon poste chez Groupama"

**Résultat attendu dans `competences/technique.md`** :
```markdown
### MLOps
- ...entrées existantes...
- **MLflow** — tracking d'expériences ML, versioning de modèles
```

**Et dans `cv/cv-fr.md`**, sous le poste Groupama :
```markdown
- Mise en place du tracking d'expériences ML et versioning de modèles
  **Stack :** MLflow
```
