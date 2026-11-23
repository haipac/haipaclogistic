# Correction de la page d’accueil HAIPAC

## Cause

Le 23 novembre 2026, GitHub Pages était configuré en mode classique sur la branche `haipac-project-import`, à la racine (`/`). Cette racine contient le `README.md` du dépôt mais pas le site. GitHub affichait donc la documentation comme page d’accueil. Le véritable frontend est la source HTML/CSS/JavaScript dans `site/`, compilée vers `dist/` par `npm run build`.

## Publication prévue

- Utiliser le workflow `.github/workflows/pages.yml` avec la source GitHub Pages réglée sur **GitHub Actions**.
- Le workflow compile le site avec la base `/`, l’URL HTTPS de l’API Cloud Functions HAIPAC et les approbations légales/opérationnelles désactivées.
- Seul `dist/` est envoyé à Pages. Le `README.md` à la racine reste de la documentation du dépôt et ne devient pas le site.
- `site/CNAME` conserve le domaine personnalisé `haipaclogistics.com` dans l’artefact.
- Firebase reste le backend des fonctions HAIPAC. Ce workflow ne déploie ni Firebase Hosting, ni fonctions, ni règles, ni données.
- Aucun enregistrement DNS Squarespace n’est modifié par ce workflow. Les enregistrements d’e-mail restent intacts.

## Vérification après publication

1. Vérifier que GitHub Pages indique une source **GitHub Actions** et que le workflow `Publish HAIPAC to GitHub Pages` a réussi sur le commit attendu.
2. Ouvrir `https://haipaclogistics.com/` et confirmer que le titre et la page HAIPAC apparaissent, pas le README.
3. Confirmer que les routes `/services/`, `/suivi/` et `/connexion/` chargent aussi depuis le domaine.
4. Confirmer HTTPS et l’état du domaine dans Settings → Pages. Ne pas déclarer la correction terminée si le certificat ou la résolution DNS échoue.

Si GitHub Pages est encore sur **Deploy from a branch**, passer sa source à **GitHub Actions** après avoir ajouté ce workflow. Cette option est le point de bascule requis : le mode classique ne sait publier que la racine ou `/docs`, pas le dossier compilé `dist/`.
