# Taux FCFA — site de revenus 100 % automatique

Site de conversion de devises vers le FCFA (533 pages : « 1000 EUR en FCFA », « 50 000 FCFA en USD », etc.).
Chaque jour, **sans toi**, GitHub :
1. récupère les taux du jour (2 sources gratuites + cache de secours),
2. régénère tout le site,
3. le republie.

Coût : **0 FCFA** (GitHub Pages est gratuit). Aucun serveur à surveiller.

## Activation (une seule fois, ~20 min)

### 1. Mettre le site en ligne
1. Crée un compte sur https://github.com (gratuit).
2. Crée un dépôt **public** nommé `fcfa-taux` (bouton « New »).
3. Dans ce dossier, ouvre un terminal et tape :
   ```
   git init
   git add .
   git commit -m "Premier envoi"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/fcfa-taux.git
   git push -u origin main
   ```
4. Sur GitHub : **Settings → Pages → Source : GitHub Actions**.
5. Onglet **Actions** → « Mise à jour quotidienne » → **Run workflow**.
6. Ton site est en ligne : `https://TON-PSEUDO.github.io/fcfa-taux/`

Ensuite plus rien à faire : la mise à jour tourne chaque jour à 06h30 (UTC).

### 2. Être trouvé sur Google (gratuit, 5 min)
- https://search.google.com/search-console → ajoute ton site → envoie `…/sitemap.xml`.

### 3. Activer l'argent (choisis une ou les deux voies)
**A. Publicité Google AdSense** — inscris-toi sur https://adsense.google.com, puis mets ton identifiant
(`ca-pub-XXXXXXXXXXXXXXXX`) dans `config.json` → `adsenseClient`. Le site ajoute tout seul les pubs
automatiques et le fichier `ads.txt`.
⚠ AdSense refuse en général les adresses en `github.io` : il faut **un nom de domaine à toi**
(~1 à 10 €/an, ex. `tauxfcfa.com`). Dans GitHub : Settings → Pages → Custom domain, puis
Settings → Secrets and variables → Actions → Variables → crée `SITE_URL` = `https://tauxfcfa.com`.

**B. Liens d'affiliation** (transfert d'argent, etc.) — dans `config.json`, remplis `affiliates` :
```json
"affiliates": [
  { "title": "Envoyer de l'argent", "text": "Frais réduits vers l'Afrique.", "url": "TON-LIEN-AFFILIE", "cta": "Essayer" }
]
```
(Les liens viennent de programmes d'affiliation auxquels tu t'inscris : Wise, Remitly, WorldRemit, etc.)

### 4. Compléter les pages légales
Dans `config.json` : `ownerName` et `contactEmail` (exigés par AdSense).

## À quoi t'attendre (honnêtement)
- **Les premiers mois : 0 ou presque.** Google met 2 à 6 mois à indexer 500 pages et à les classer.
- Ensuite, les revenus sont **petits mais réguliers** (les requêtes « euro en FCFA », « dollar en FCFA » sont très recherchées en Afrique francophone, mais les pubs y paient peu par clic).
- Le site ne demande **aucune intervention**, mais les revenus dépendent du trafic : il n'existe pas de revenu garanti.

## Fichiers
- `build.mjs` — le générateur (taux → pages)
- `config.json` — nom, devises, pubs, affiliation
- `.github/workflows/daily.yml` — la mise à jour automatique
- `data/` — historique des taux (sauvegardé automatiquement)
- Test local : `node build.mjs` puis `node serve.mjs` → http://localhost:4173
