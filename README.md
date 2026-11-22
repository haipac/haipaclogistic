# HAIPAC Logistics

Portail logistique en français : suivi public, espace client, rattachement de colis, opérations et administration, avec une API Firebase séparée.

## Architecture

- Frontend statique HTML/CSS/JavaScript : les sources sont dans `site/`, compilées dans `dist/` par `npm run build`.
- Hébergement actuel : Firebase Hosting dans le projet `haipac-7e19d`; `https://haipac-7e19d.web.app` et le domaine personnalisé servent le même site. Cible demandée pour la migration : GitHub Pages pour le frontend, avec Cloud Functions Firebase conservées comme backend. La publication Pages reste suspendue tant que l’admissibilité commerciale de GitHub Pages n’est pas résolue.
- Backend : l’API HTTP Firebase Functions est dans `functions/` et le scheduler e-mail est empaqueté séparément dans le codebase `email-functions/`; les deux tournent en `us-east4`. Hosting transmet `/api/**` à la fonction HTTP `api`. Le bêta peut publier l’API sans déployer le fournisseur e-mail.
- Firebase Auth gère les liens de connexion e-mail. Les règles Firestore/Storage du navigateur restent deny-by-default; seul le code serveur utilise Firebase Admin.
- GitHub héberge le dépôt et les workflows. Le frontend est en HTML/CSS/JavaScript; ni Next.js ni Vercel ne sont utilisés. Voir `.github/DEPLOYMENT_GUIDE.md` et `docs/IMPLEMENTATION_PLAN.md` pour l’état de la migration Pages.
- Le projet Firebase Smart Cut reste distinct. Son serveur de paiement appelle HAIPAC avec des requêtes HMAC signées.

## Règles métier

- HTG est la devise des frais de livraison.
- Chaque unité de commande correspond à un colis.
- Poids volumétrique : longueur × largeur × hauteur ÷ 6000.
- Le poids facturable est le maximum entre poids réel et volumétrique, avec un minimum de 1 kg, puis arrondi au kilo supérieur avant le choix de tranche.
- Aucun tarif réel n’est inclus dans le code. Les devis restent fermés tant que le barème complet, le point d’origine et les communes desservies n’ont pas été approuvés et activés.
- Les textes `/conditions/` et `/confidentialite/` restent des documents de travail tant qu’un administrateur n’a pas publié une version relue dans le dashboard. La publication crée une version historisée, mais ne valide pas à elle seule l’ouverture du service. Les indicateurs juridiques et opérationnels restent `false` par défaut.

## Développement local

```powershell
npm ci
npm ci --prefix functions
npm run build
npm --prefix functions run build
npm run firebase:emulators
```

Le build local génère une configuration de développement qui utilise l’émulateur Auth par défaut. Le build de production exige une URL API explicite : utilise `HAIPAC_API_BASE_URL=/api/` pour le site actuellement servi par Firebase Hosting, qui réécrit `/api/**` vers Cloud Functions. Un futur hébergeur statique sans réécriture devra utiliser l’URL HTTPS directe de la fonction `api`, après validation de CORS et des domaines Firebase Auth. Avant toute publication, relis `.github/DEPLOYMENT_GUIDE.md`; le workflow actuel fixe explicitement `/api/`.

## Routes API

### Client

- `POST /api/v1/account` crée un profil client idempotent et un numéro CASE côté serveur.
- `GET /api/v1/communes` fournit les communes actives pour les formulaires.
- `GET /api/v1/account` et `GET|POST /api/v1/account/addresses` servent le profil et les adresses du compte connecté.
- `POST /api/v1/claims` rattache un colis via un lien e-mail à usage unique et l’e-mail vérifié du destinataire.
- `GET /api/v1/tracking/{trackingNumber}` fournit seulement le statut et les événements publics sélectionnés; l’adresse et les coordonnées sont privées.

### Intégration Smart Cut

- `POST /api/v1/quotes` exige signature HMAC, nonce anti-rejeu, idempotence, couverture et barème actifs; il conserve un instantané du devis.
- `POST /api/v1/integrations/quotes/reserve` réserve un devis pour une commande Smart Cut avec une clé d’idempotence.
- `POST /api/v1/integrations/shipments` exige le statut de paiement vérifié côté serveur et crée un colis par unité, des numéros HPL, des jetons de réclamation et un e-mail chiffré en transaction.
- Les montants, poids, dimensions, destinations et paiements déclarés par le navigateur ne sont pas des preuves. Le serveur Smart Cut doit lire les valeurs autoritatives avant de signer.

### Opérations et administration

- Les routes opérations exigent le rôle Firebase `operations` ou `admin`.
- Les routes admin exigent le rôle `admin`; l’attribution initiale est limitée au compte propriétaire vérifié et au projet `haipac-7e19d` par `scripts/seed-admin.mjs`.
- Le dashboard permet de rédiger des brouillons puis de publier les pages Conditions et Confidentialité. Seules les versions publiées sont servies publiquement; les changements sont versionnés et audités.
- Le dashboard contient aussi des documents internes versionnés pour la conservation des données et les procédures opérationnelles. Ils ne déclenchent aucune purge automatique et ne suffisent pas à ouvrir le service.
- Les changements sont journalisés, les transitions de statut sont contraintes et les codes de livraison sont vérifiés côté serveur.

## Production

Les paramètres et secrets de Functions, les règles et domaines Auth, le barème, la couverture, les textes légaux, l’expéditeur Resend et l’intégration Smart Cut doivent être validés avant l’ouverture complète. Ne crée pas de données de production pour contourner ces prérequis. Les étapes exactes et critères de vérification sont dans `.github/DEPLOYMENT_GUIDE.md`.
