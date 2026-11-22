# HAIPAC publication and deployment guide

Read this file and the parent Smart Cut Services guide before publishing or changing an ecosystem integration:
`../smartcutservices-main-live/.github/DEPLOYMENT_GUIDE.md` (from the repository collection).

## Deployment target

- Repository: private GitHub repository `smartcutservices/haipac-logistics`, default branch `main`.
- Frontend: static HTML, CSS and JavaScript in `site/`; `npm run build` writes the deployable site to `dist/`.
- Hosting: Firebase Hosting in project `haipac-7e19d`. Its default beta URL is `https://haipac-7e19d.web.app`. GitHub stores the source and workflows; GitHub Pages is not the production host.
- API: Cloud Functions function `api` in codebase `haipac-api`; scheduled `processHaipacEmailOutbox` in codebase `haipac-email`. Both run in `us-east4`. Hosting rewrites `/api/**` to `api`.
- The public custom domain is `www.haipaclogistics.com`; `haipaclogistics.com` redirects to `www`. The read-only production preflight `44732513346` on 2026-11-20 reports both custom domains host/ownership active and both certificates active, with no DNS issues. The preflight confirms the `www` CNAME and apex Firebase A record; public checks have returned `200` for the website and `/api/v1/communes`, and `301` from the apex to `www`. Squarespace remains the registrar/DNS provider; Firebase Hosting serves the website. Set `HAIPAC_PUBLIC_URL` to `https://www.haipaclogistics.com` only after the custom-domain HTTPS checks pass (they currently do), and verify it again before a release.
- Never use Smart Cut’s Firebase project `smartcutservices-9ce54` for HAIPAC. The project file `.firebaserc` pins this repository to `haipac-7e19d`.

## Before any production deploy

1. Read `AGENTS.md`, this guide, `git status --short --branch`, and the exact staged diff. Preserve existing changes and stage only reviewed paths.
2. Confirm the active Firebase CLI or Google Cloud identity is the HAIPAC owner and the selected project is exactly `haipac-7e19d`. Never deploy HAIPAC through the Smart Cut account or project.
3. For the GitHub release workflow, configure the `production` environment with GitHub secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`. The Google Workload Identity provider must restrict trust to `smartcutservices/haipac-logistics` on `refs/heads/main`; grant only the roles needed for Hosting and Functions deployment. The workflow runs manually from `main` and uses OIDC, not a JSON key.
4. Confirm project billing, Firebase Hosting site, Firestore database/region, Auth email-link provider and authorized domains, Functions region, runtime service identity, Storage and deny-by-default rules/indexes.
5. Use Cloud Functions’ runtime identity with least privilege. Do not create or store a service-account JSON key. Firebase client configuration is public browser configuration; privileged operations and secrets stay server-side.
6. Set the GitHub `production` environment variable `EMAIL_FROM` to a bare sender address under the Resend-verified `haipaclogistics.com` domain. The release workflow writes it into the ignored project-specific Functions parameter file and fails closed when it is missing or outside that domain. Do not use a personal Gmail sender. Keep `LEGAL_CONTENT_APPROVED`, `OPERATIONS_READY` and `HAIPAC_INDEXING_ENABLED` absent or `false` until the owner signs off. The release workflow accepts only the exact values `true` or `false` and defaults missing values to `false`. Set the first two to `true` only after both public legal documents and all three versioned operational policies (retention, operations, payment decisions) are published and the owner has approved the final legal and operational readiness. Set `HAIPAC_PUBLIC_URL` to `https://www.haipaclogistics.com` only after the custom-domain cutover and Firebase SSL verification; otherwise it defaults to `https://haipac-7e19d.web.app`. The workflow checks that a selected `www` URL serves the HAIPAC page and API before building and verifies the same URL after deploy. Search indexing can be enabled only when both approvals are `true` and the public URL is the verified `www` domain. In that case the build emits a canonical URL, sitemap and permissive robots file for the public homepage; private pages retain `noindex`. The API verifies the five published documents at runtime; the email worker sends nothing unless provider configuration and both approvals are enabled.
7. Configure these Firebase Secret Manager names before deploying Functions: API codebase `SMARTCUT_HMAC_SECRET`, `CLAIM_TOKEN_ENCRYPTION_KEY`, `DELIVERY_CODE_SECRET`, `TRACKING_RATE_LIMIT_SECRET`, `CRON_SECRET`; email codebase `CLAIM_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `CRON_SECRET`. Do not put their values in Git, workflow output or the browser bundle. The HMAC value must match the separately configured Smart Cut server secret.
8. Verify the email-link flow and add the active Hosting URL (`haipac-7e19d.web.app`) and final custom domain to Firebase Auth authorized domains. Verify Resend sender ownership and SPF/DKIM/DMARC before enabling emails.
9. Enter only owner-approved communes, dispatch origin and complete versioned tariffs. Confirm upward kilogram rounding and select the tariff tier after rounding. Do not activate a draft until approved; no real prices are hardcoded in this repository.
10. Review `/conditions/` and `/confidentialite/`, retention, support, incident, delivery and payment procedures. An administrator can save drafts and publish reviewed, versioned content from the dashboard. Keep `LEGAL_CONTENT_APPROVED` and `OPERATIONS_READY` false until the owner approves the final texts and procedures; publishing documents alone does not open the service.
11. Inspect existing Squarespace content, domain verification, MX/TXT records and rollback plan before the owner changes DNS. Preserve mail records. Do not make a DNS cutover implicitly.

## Beta deployment

Run `.github/workflows/deploy-firebase-beta.yml` manually from `main` after reviewing the commit and confirming the GitHub `production` environment has its OIDC service-account and workload-identity-provider values. This workflow deploys only static Hosting and the `haipac-api` codebase to project `haipac-7e19d`.

It verifies metadata for the five API codebase Secret Manager names without reading their values. The `RESEND_API_KEY` parameter exists only in the separate `haipac-email` codebase, so the beta API can be deployed without a placeholder or an email provider. The beta does not deploy the scheduled email-outbox function, sets `EMAIL_PROVIDER_CONFIGURED=false`, and writes `LEGAL_CONTENT_APPROVED=false` and `OPERATIONS_READY=false`. Quotes, reservations and shipments therefore remain unavailable, and transactional email is disabled. The beta URL is `https://haipac-7e19d.web.app`, but it and the custom domains are the same Firebase Hosting site. A beta Hosting deploy updates the website at `https://www.haipaclogistics.com` and the apex redirect as well; the word “beta” does not isolate the custom domain. Squarespace remains the registrar/DNS provider, and all mail-related DNS records must be preserved. Do not make DNS changes as part of an ordinary code deployment.

Before the first Functions deployment, the HAIPAC project owner must configure the `gcf-artifacts` repository in `us-east4` with a cleanup policy or an explicit cleanup opt-out. The recommended Firebase default deletes deployment images older than one day; use `firebase functions:artifacts:setpolicy --project haipac-7e19d --location us-east4 --days 1 --force` to apply it. If the owner elects to retain every image, use `firebase functions:artifacts:setpolicy --project haipac-7e19d --location us-east4 --none --force` and review the resulting storage cost. The GitHub OIDC deploy identity deliberately has no repository-policy write permission. Both release workflows verify this prerequisite before changing Hosting or Functions.

For a frontend-only update, run `.github/workflows/deploy-firebase-hosting-only.yml` manually from `main` after reviewing the merged commit. It builds and publishes only the static site to Hosting in `haipac-7e19d`, using the GitHub OIDC identity; it does not deploy Functions, Firestore rules/indexes or Storage rules. The build keeps legal/operational approvals and search indexing disabled. This still updates the public custom domain because `www.haipaclogistics.com` and the apex redirect share the same Hosting site. Verify the workflow commit and both the beta and `www` homepage markers before reporting publication.

Use synthetic accounts and data only. Do not describe the beta as operationally ready or enter real customer information. The standard production workflow remains separate and requires all six production secrets plus a verified HAIPAC sender address.

## Build and publish

### Read-only production readiness preflight

Run `.github/workflows/haipac-production-preflight.yml` manually from `main` before considering a production release. It uses the production GitHub environment and HAIPAC OIDC identity to inspect required Secret Manager resource/version metadata, the Functions artifact cleanup setting, redacted production-variable status, public sender/website DNS, and Firebase Hosting custom-domain host, ownership and certificate states. The domain check reports issue counts and DNS record types/actions only; it hides ACME challenge values. The workflow never reads secret values and does not deploy or modify Firebase, GitHub settings or DNS. Review the step logs and run summary for each blocker. A successful preflight means only that the checks ran; the release workflow still requires every documented owner approval and verified production setting.

The default frontend build uses the Auth emulator configuration so a local build cannot silently send production sign-in links:

```powershell
npm ci
npm ci --prefix functions
npm run build
npm --prefix functions run build
```

Every production build must specify `HAIPAC_API_BASE_URL`. The Firebase Hosting workflows set it to `/api/`, which relies on the Hosting rewrite to the `api` Cloud Function. An external static host must use the verified direct Functions URL instead, and must not be published until the API CORS allowlist and Firebase Auth return domains have been reviewed for that host.

The production release path is GitHub Actions after the PR has merged to protected `main`, validation is green, WIF is configured and required Firebase secrets exist. Before creating the Hosting site, the workflow checks all six required Secret Manager resources and enabled versions using metadata only; it never reads or prints their values. The deploy identity needs `Secret Manager Viewer` for this preflight, not `Secret Accessor`. Run `Deploy HAIPAC production to Firebase` from the Actions tab. It builds the static frontend in production mode and deploys Hosting plus the `haipac-api` and `haipac-email` codebases. It deliberately does not deploy Firestore or Storage rules.

For a supervised local release instead, review this guide and set the explicit runtime mode:

```powershell
$env:HAIPAC_MODE = 'production'
$env:HAIPAC_API_BASE_URL = '/api/'
npm run build
npm exec -- firebase deploy --project haipac-7e19d --only hosting
Remove-Item Env:HAIPAC_MODE
Remove-Item Env:HAIPAC_API_BASE_URL
```

Before deploying Functions, confirm all parameters and secrets in the HAIPAC project, then deploy only the reviewed functions:

```powershell
npm exec -- firebase deploy --project haipac-7e19d --only functions:haipac-api,functions:haipac-email
```

Deploy Firestore rules, indexes or Storage rules only when their reviewed files changed. Never deploy them as an incidental part of a frontend-only release.

## Verification and completion criteria

A successful Git push is not proof of publication. For a GitHub Actions release, verify its run and deployed commit. For a CLI release, record the Firebase release/version and Functions revision. Then:

- Load the deployed default or custom Hosting domain over HTTPS and verify each static route and asset.
- Confirm Hosting `/api/v1/...` reaches the `api` function in `us-east4`, without caching API responses.
- Confirm Firebase Auth email-link sign-in, claim links, account authorization and admin/operations role checks.
- Verify public tracking reveals no contact details, and rate limits work.
- Verify signed quotes, idempotent payment replay, email outbox encryption/retries, delivery-code expiry/single use, and production fail-closed behavior using emulator or approved beta records only.
- Confirm the `processHaipacEmailOutbox` scheduler exists and runs once per minute in `America/Port-au-Prince`.
- Record the Firebase project, deployed commit, Hosting version, Functions revision, domain and verification time without copying secrets, email tokens, delivery codes or PII into notes.
- Check `https://www.haipaclogistics.com` and the apex redirect after every release because the custom domain is attached to the same Hosting site. Keep the previous Squarespace deployment and DNS values available for rollback; do not edit DNS during a code release.

## Smart Cut integration boundary

HAIPAC’s quote and shipment API is separate from the Smart Cut payment backend. The Smart Cut server must load authoritative product dimensions, destination and verified payment state, sign requests with the matching HMAC secret, and retry with stable idempotency keys. Review and deploy any Smart Cut-side change in the appropriate Smart Cut repository; do not infer that integration is live because HAIPAC Functions deployed. HAIPAC does not use Smart Cut Health as its frontend or backend.

## Demande de migration d’hébergement — 21 novembre 2026

Le propriétaire demande que le code source et les workflows restent sur GitHub, que le frontend quitte Firebase Hosting et que Firebase Cloud Functions reste le backend HAIPAC dans `haipac-7e19d`. GitHub Pages est la cible frontend souhaitée. Le fonctionnement actuel reste toutefois Firebase Hosting jusqu’à validation d’un nouveau déploiement et d’une bascule DNS réversible.

**Admissibilité à confirmer :** la documentation officielle GitHub indique que Pages n’est pas destiné ni autorisé comme hébergement gratuit pour faire fonctionner une entreprise en ligne ou un service commercial/SaaS. Elle précise également que Pages est inclus dans GitHub Pro pour les dépôts privés, mais ne dit pas clairement si le plan payant constitue une exception à la restriction commerciale. HAIPAC étant une plateforme logistique commerciale, obtenir une réponse écrite de GitHub Support sur ce cas avant la publication; ne pas interpréter l’accès technique via Pro comme une autorisation d’usage. Voir [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [GitHub Pages terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#pages) et le plan dans `docs/IMPLEMENTATION_PLAN.md`.

Option documentée, non sélectionnée : Netlify indique permettre le déploiement de projets commerciaux sur son plan Free, avec domaine personnalisé et SSL; son quota mensuel peut suspendre le site lorsqu’il est dépassé. L’intégration Git du Free tier ne prend pas en charge les dépôts privés appartenant à une organisation; une publication depuis GitHub Actions avec Netlify CLI et un secret de déploiement serait une solution possible si le propriétaire la choisit. Cette option garderait le dépôt et Firebase Functions en place, mais remplace GitHub Pages comme hébergeur et nécessite un compte/secret supplémentaire. Sources officielles et limites dans `docs/IMPLEMENTATION_PLAN.md`.

Si le frontend migre vers un hébergeur distinct, conserver les Cloud Functions, Auth, Firestore, Storage, Secret Manager et le projet `haipac-7e19d`. Remplacer la réécriture Hosting `/api/**` par l’URL HTTPS vérifiée de la fonction `api`, configurer CORS uniquement pour les origines HAIPAC nécessaires et valider les domaines de retour Firebase Auth. Garder les secrets côté serveur. Préparer le workflow de préproduction et vérifier les routes, les liens profonds, les formulaires et l’API avant toute bascule.

La préparation locale confirme que `https://www.haipaclogistics.com` est déjà dans l’allowlist CORS de l’API; l’utiliser comme domaine Pages de production ne demande donc pas d’élargir CORS. Ne pas autoriser `https://smartcutservices.github.io` par défaut : cette origine est partagée par les dépôts Pages de l’organisation. Le flux Firebase email-link construit le retour depuis l’URL de base; valider le retour vers `www.haipaclogistics.com/connexion/terminer/` avant la bascule.

Après la validation de conformité et des en-têtes, séparer la publication Pages du déploiement Firebase : un workflow Actions publiera uniquement `dist/` sur Pages, un workflow backend continuera à déployer les deux codebases Functions dans `haipac-7e19d`, sans Hosting. Après la fenêtre de rollback, retirer uniquement le bloc `hosting` de `firebase.json` et les étapes/workflows qui déploient Hosting. Garder les configurations Functions/Firestore/Storage, Firebase Auth et les données HAIPAC. Aucun workflow Pages, changement DNS ou retrait de Hosting n’est autorisé par cette note de préparation.

Inventaire local du 21 novembre 2026 : `.gitignore` exclut déjà les fichiers `.env*` (sauf `.env.example`) et `dist/`; aucun `.env` réel ou `CNAME` n’est suivi et aucun workflow Pages n’existe. Les workflows actuels publient Firebase Hosting. Le build local accepte maintenant, uniquement en mode production, `/api/` (hébergement actuel) ou l’URL HAIPAC `https://us-east4-haipac-7e19d.cloudfunctions.net/api/`. Les requêtes actuelles ont donné GET public `/api/v1/communes` HTTP 200; OPTIONS depuis `https://www.haipaclogistics.com` HTTP 204 avec CORS, et OPTIONS depuis `https://smartcutservices.github.io` HTTP 403 sans CORS. La prévisualisation Pages partagée aurait besoin de cette origine, qui élargirait CORS à tous les dépôts Pages du compte. Ces vérifications ne valident pas les opérations métier ni ne garantissent la disponibilité future.

**Clarification GitHub Pro :** la documentation actuelle confirme que Pro permet d’activer Pages pour les dépôts privés, et la politique commerciale continue de qualifier Pages d’hébergement « gratuit » sans énoncer d’exception pour les comptes payants. L’interprétation applicable à HAIPAC n’est donc pas établie par la documentation seule. Obtenir un avis écrit du support GitHub avant le workflow de préproduction ou de production. Le propriétaire n’a pas encore fourni cette confirmation.

Question prête à envoyer au support GitHub (ne pas l’envoyer sans autorisation du propriétaire) : « Nous exploitons HAIPAC, une plateforme logistique commerciale en Haïti. Le dépôt `smartcutservices/haipac-logistics` est privé et notre compte dispose de GitHub Pro. Nous souhaitons publier le frontend statique HTML/CSS/JavaScript par GitHub Pages sur `www.haipaclogistics.com`, avec Firebase Cloud Functions/Auth comme backend séparé. Le site permettrait le suivi de colis et demanderait l’adresse e-mail pour envoyer un lien de connexion; il ne recueillerait ni mot de passe ni carte bancaire. L’interdiction Pages relative à l’hébergement gratuit d’une entreprise commerciale s’applique-t-elle à cette utilisation sur GitHub Pro? Existe-t-il une offre ou une autorisation contractuelle qui la permet? »

Un audit HTML a également repéré des liens internes `href="/..."` incompatibles avec l’URL de projet Pages sous-chemin. Ils ont été remplacés par des chemins relatifs à la balise `<base>` existante, y compris les retours à l’accueil avec ancre. Le générateur réécrit aussi les fragments de page courante afin que les liens d’accès au contenu restent sur la route visitée malgré la balise `<base>`, et ajoute `.nojekyll` à l’artefact statique. Le validateur exige maintenant que les pages avec `main#main-content` aient un lien d’accès clavier pointant vers le document courant. Les builds de production avec l’API Functions directe et indexation désactivée, ainsi que le validateur, passent pour 23 routes, 30 documents et tous les liens/assets locaux à la racine et sous `/haipac-logistics/`. La navigation exhaustive, les assets visuels et les parcours API/Auth restent à vérifier dès qu’un hébergeur de préproduction approprié est retenu.

Firebase Hosting applique actuellement des en-têtes HTTP de sécurité globaux, notamment CSP avec `frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy` et `Referrer-Policy`. Une balise CSP meta dans le HTML ne remplace pas tous ces en-têtes (notamment `frame-ancestors`); Pages ne fournit pas de configuration d’en-têtes personnalisés. Avant une publication Pages, choisir une couche compatible pour ces en-têtes ou documenter l’acceptation du risque résiduel. Aucun workflow Pages ni DNS ne doit être activé tant que ce point et le blocage d’admissibilité commerciale ne sont pas résolus.

Ne pas changer le DNS Squarespace tant que le nouvel hébergement, le domaine personnalisé, le certificat HTTPS, les appels API et l’authentification ne sont pas validés. Préserver tous les enregistrements MX/SPF/DKIM/DMARC et ceux utilisés par Resend. Garder Firebase Hosting disponible comme rollback jusqu’à validation publique du nouveau site; retirer uniquement Hosting après la fenêtre de vérification convenue. Ne pas supprimer Firebase Functions ni les données du projet.
