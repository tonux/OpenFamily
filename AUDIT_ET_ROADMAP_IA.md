# OpenFamily — Audit technique & Roadmap IA

> Document de travail interne — Mai 2026
> Périmètre : audit complet du code existant + proposition de fonctionnalités IA (API cloud) et non-IA pour usage personnel optimisé et différenciation produit.

---

## 0. TL;DR

**Verdict global :** codebase d'un dev solo méticuleux, fonctionnellement riche, mais sans filet (zéro test, zéro lint), avec quelques features-fantômes (WebSocket, push notifications, multi-membres), une faille d'import critique et une stack front sous-équipée (pas de React Query, PWA cosmétique).

**Trois urgences avant toute nouvelle feature :**

1. Corriger l'INSERT dynamique de `dataTransfer.ts` (SQLi structurelle).
2. Sécuriser ou supprimer le WebSocket (auth bypass).
3. Migrer le token JWT hors de `localStorage` (XSS surface).

**Trois axes stratégiques pour la suite :**

- **Couche IA** : assistant familial conversationnel + auto-catégorisation + génération de planning repas + parsing tickets de caisse.
- **Multi-membres réel** : passer de "1 user = 1 famille" à "N membres avec comptes individuels qui partagent un foyer", c'est la fondation des features collaboratives.
- **Infra qualité** : React Query + zod + ESLint + Vitest + helmet. 1 sprint = ROI permanent.

---

## 1. Cartographie réelle (ce qui existe vs ce qui est annoncé)

### Ce qui marche vraiment

- **API CRUD complète** : Auth, Shopping, Tasks, Appointments, Family, Recipes, Budget, MealPlans, Planning, Dashboard, Data export/import.
- **Pages client** : toutes implémentées (Login, Dashboard, ShoppingList, Tasks, Calendar, Planning, Recipes, MealPlanning, Budget, Family, Settings) — pas de stubs.
- **Bons fondamentaux** : requêtes paramétrées partout (hors import), scoping `user_id` systématique, rate-limit sur l'auth, logger structuré (avec redaction), transactions PG correctement utilisées, mobile-first sincère, CI Docker avec smoke test, validation forte du `JWT_SECRET`.

### Features-fantômes (annoncées dans le README, code mort)

| Feature                  | Réalité                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Notifications push       | `web-push` installé, table `push_subscriptions` créée, variables VAPID injectées dans Docker — **mais aucune route ni envoi nulle part**.  |
| WebSocket temps réel     | Serveur expose `/ws`, **aucun client ne s'y connecte**. Pire : auth WS basée sur un `userId` envoyé en clair par le client (bypass total). |
| Mode offline / PWA       | Service worker `NetworkFirst` 5 min, sans IndexedDB ni queue de mutations. **PWA cosmétique**, pas un vrai offline.                        |
| Types partagés `/shared` | Dossier existe, redéfini inline partout côté client et serveur. ROI = 0.                                                                   |
| Multi-membres familiaux  | Le schéma a `family_members`, mais **un seul `users.id` possède toute la donnée**. Deux conjoints doivent partager le même compte.         |

### Top 10 quick wins (faible effort, gros impact)

1. `server/src/routes/dataTransfer.ts:68-85` — whitelister les colonnes autorisées par table dans l'import. **Critique sécu.**
2. `server/src/index.ts:18-44` — vérifier le JWT sur la connexion WS (ou supprimer le WS tant qu'il n'est branché nulle part).
3. `server/src/routes/*.ts` — remplacer les 54 `console.error` par `logger.error(…)`. Le logger existe, redact les secrets. 30 min.
4. `server/src/app.ts:42` — ajouter `helmet()` + rate-limit global modéré (300 req/min/IP). 5 lignes.
5. Ajouter un middleware `validateUUID(paramName)` sur toutes les routes `/:id` — évite les 500 PG sur input mal formé.
6. Réduire la durée JWT à 1h + refresh token httpOnly cookie. Atténue le XSS via localStorage.
7. Migrer le token de `localStorage` vers cookie httpOnly. Gros impact XSS.
8. Introduire **React Query** côté client (un seul provider, ~20 `useEffect+useState+api.get` → `useQuery`). Cache, dédup, refetch, optimistic updates gratuits.
9. Brancher **zod côté serveur** (déjà installé côté client) avec middleware `validate(schema)`. Supprime 80% du parsing manuel.
10. `package.json` racine — ESLint + Prettier + Husky + Vitest minimal (au moins auth + 1 CRUD). Sans tests, toute refactor est aveugle.

---

## 2. Dette technique à adresser avant de scaler

### Sécurité (par ordre de gravité)

- **CRITIQUE — Import data dynamique** : l'INSERT prend les `keys` du JSON utilisateur tel quel. Permet collision de colonnes (écraser un `user_id`) et casse silencieuse. → whitelist par table.
- **HAUTE — WS sans auth** : `userId` accepté en clair. Aucun broadcast n'est émis aujourd'hui, donc dégât potentiel limité, mais c'est une bombe à retardement le jour où on s'en servira.
- **HAUTE — JWT 7 jours dans localStorage** : surface XSS. Refresh court + cookie httpOnly.
- **MOYENNE — Pas d'helmet, pas de CSP** : headers sécu manquants en prod.
- **MOYENNE — Pas de rate-limit sur les CRUD** : un user authentifié peut hammerer.
- **BASSE — User enumeration login** : messages d'erreur distincts entre user inconnu et mauvais mot de passe. Atténué par rate-limit.

### Qualité de code

- **Zéro test.** Le seul "test" est un curl health-check en CI.
- **Zéro lint/formatter.** Pas d'ESLint, pas de Prettier.
- **Duplication massive** : le pattern `ensureMembersBelongToUser + enrich + INSERT/UPDATE COALESCE + pushUpdate` est copié-collé 7 fois. Un repository/service layer économise ~30% du code.
- **Logger inutilisé** : `console.error` 54 fois dans 11 fichiers de routes alors que `lib/logger.ts` est propre. Incohérence flagrante.
- **Migrations sauvages** : exécutées au démarrage via une liste d'`ALTER TABLE IF NOT EXISTS` en dur, pas de table `migrations`, pas d'historique. → adopter `node-pg-migrate` ou `drizzle-kit`.
- **Schéma redondant** : `family_members` a 3 paires de colonnes doubles (`emergency_contact_name`/`phone` + `emergency_contact` JSON ; `medications`/`vaccines` ; `notes`/`medical_notes`). Écrites en double à chaque insert. → migration de nettoyage.
- **Types partagés non utilisés** : redéfinis inline partout. → imposer l'import depuis `/shared` via lint rule.

### UX / Front

- **Pas de gestion de cache** côté front. Chaque page refetch tout à chaque visite. → React Query.
- **Pas de loading skeletons** cohérents, pas d'optimistic updates.
- **i18n** : 100% français hardcodé. Bloquant pour un projet open-source à vocation internationale. → `react-i18next` avec FR par défaut.
- **A11y** : niveau correct (aria-label sur icônes, formulaires `required`) mais pas de focus trap dans les Dialog, pas de skip link, pas de `role` sur la bottom-nav.

---

## 3. Roadmap IA (API cloud — OpenAI / Anthropic / Mistral)

### Principe architectural

**Provider abstraction** côté serveur : une seule interface `AIProvider` avec implémentations interchangeables. L'utilisateur fournit sa clé API dans les settings (chiffrée au repos via une clé maître), ou le self-hoster fournit une clé partagée pour le foyer.

```
server/src/ai/
├── providers/
│   ├── openai.ts
│   ├── anthropic.ts
│   └── mistral.ts
├── prompts/
│   ├── classifyShopping.ts
│   ├── parseReceipt.ts
│   ├── mealPlan.ts
│   └── ...
├── tools/                  ← function-calling (l'IA peut créer des tâches, etc.)
├── AIService.ts            ← façade
└── tokenCounter.ts         ← garde-fou coûts
```

**Décisions clés :**

- **Streaming SSE** pour les réponses conversationnelles (Express supporte nativement).
- **Function calling** pour permettre à l'IA de créer/modifier des entités (créer un rendez-vous depuis un message, ajouter un item à la liste de courses, etc.). Toutes les fonctions passent par les mêmes validations que les routes REST.
- **Garde-fous coûts** : compteur de tokens par user et par jour, plafond configurable, retour 429 propre côté UI.
- **Pas de stockage des prompts utilisateurs côté provider** : opt-out OpenAI training, Anthropic ne stocke pas par défaut.
- **Logs IA séparés** : table `ai_interactions` (user_id, feature, tokens_in/out, cost_estimate, latency_ms) pour audit et facturation future.

### Features IA priorisées

#### Niveau 1 — High value, low complexity (4-6 semaines)

**1. Ajout de courses en langage naturel**
"Ajoute du lait, 6 yaourts à la fraise et du pain complet" → 3 items créés, catégories devinées (Crémerie / Crémerie / Boulangerie), quantités/unités extraites. Bouton micro dans la page ShoppingList.
_Prompt court, output JSON strict, ~500 tokens/appel, ~0,001 €._

**2. Auto-catégorisation des items et dépenses**
Quand l'utilisateur tape "panais", l'IA suggère "Légumes". Idem pour les dépenses budget. Avec cache : "panais" → "Légumes" est mémorisé en base, on n'appelle l'IA que la première fois. **Coût quasi nul à terme.**

**3. Parsing de ticket de caisse (OCR + IA)**
L'utilisateur prend en photo le ticket → API Vision (GPT-4 Vision ou Claude 4.6 Sonnet) → JSON des items + total + magasin + date → pré-rempli dans Budget et/ou Shopping (mode "consommé"). **Différenciant fort.**

**4. Conversion recette → liste de courses**
Sur la page Recettes, bouton "Ajouter à ma liste". L'IA convertit chaque ingrédient en item de course (avec dédup intelligente : "2 œufs" + "3 œufs" déjà sur la liste = "5 œufs"), respecte les unités, ignore les ingrédients "de base" déjà au placard (sel, poivre, huile — configurable).

**5. Générateur de planning repas hebdo**
Bouton "Générer la semaine" → prompt : recettes du foyer + contraintes (budget, allergies des membres, équilibre nutritionnel demandé, temps de prépa max les jours d'école) → planning 7×3 ou 7×2 cohérent + liste de courses associée. Possibilité de regénérer un seul repas.

#### Niveau 2 — High value, medium complexity (6-10 semaines)

**6. Assistant familial conversationnel (chat persistant)**
Une page "Assistant" avec chat. L'IA a accès via function calling à : créer un RDV, créer une tâche, ajouter une course, créer une dépense, chercher dans les recettes, lire le planning. Exemples :

- "On a un repas de famille dimanche midi, prévois un menu de 4 plats pour 8"
- "Quelle est la prochaine échéance de la cantine ?"
- "Crée une tâche récurrente pour sortir les poubelles le mardi soir, assigne-la à Sam"

Toutes les actions de l'IA passent par un **diff de confirmation** : l'UI montre "Je vais créer 3 entrées, valide ?" avant d'exécuter.

**7. Génération de recettes contextuelles**
"Qu'est-ce que je peux faire avec ce que j'ai au frigo : courgettes, riz, œufs, parmesan ?" → 3 propositions de recettes, sauvegardables en un clic dans la bibliothèque familiale. Bonus : importer une recette depuis une URL (scraping + IA pour structurer).

**8. Analyse budget en langage naturel**
"Pourquoi j'ai dépassé en mars ?" → l'IA reçoit les `budget_entries` du mois et du mois précédent, sort un résumé : "Tu as dépensé +180€ en Loisirs (+62%), principalement 2 sorties restaurant le week-end du 12. Le poste Alimentation est stable." Avec graphique généré côté front.

**9. Résumé hebdomadaire familial**
Email/push tous les dimanches soir : "Cette semaine : 3 RDV à venir (cantine lundi, dentiste mercredi…), 4 tâches en retard, budget alimentation à 78% du plafond, planning repas complet sauf vendredi soir." Briefing en 5 lignes, généré par IA depuis les données agrégées.

#### Niveau 3 — Différenciants stratégiques (10+ semaines)

**10. Détection automatique de conflits d'agenda**
À la création d'un RDV, l'IA croise avec les `schedule_entries` (école/travail) et les `appointments` existants des membres impliqués, alerte si un conflit existe ou suggère un créneau optimal.

**11. Mode "vacances" intelligent**
Sélection d'une période → l'IA bascule les tâches récurrentes en pause, génère un planning repas adapté (recettes plus simples, ingrédients qui se conservent), suggère une liste de courses pré-départ, et un budget vacances.

**12. Coach nutritionnel familial (opt-in)**
À partir des recettes consommées sur 4 semaines, alerte douce : "Vous avez mangé peu de poisson ce mois-ci, voici 3 recettes adaptées à votre famille." **Attention : positionnement non-médical, pas de prétention santé, sortie informative uniquement.**

**13. Voice mode (PWA + Web Speech API)**
Bouton micro global, l'utilisateur parle ("on a plus de café, et rappelle-moi de payer la cantine vendredi"), Whisper → texte → assistant → exécution. Killer feature pour usage mobile au quotidien.

### Estimation de coûts d'usage (foyer type)

| Feature                  | Appels/mois      | Tokens/appel | Coût/mois (Claude Haiku 4.5) |
| ------------------------ | ---------------- | ------------ | ---------------------------- |
| Ajout courses NL         | 80               | 600          | < 0,10 €                     |
| Auto-catégorisation      | 30 (après cache) | 200          | < 0,02 €                     |
| Parsing tickets (Vision) | 20               | 3 000        | ~ 0,40 €                     |
| Planning repas hebdo     | 4                | 8 000        | ~ 0,15 €                     |
| Assistant chat           | 100              | 3 500        | ~ 1,20 €                     |
| **Total**                | ~234             | —            | **< 2 € / mois / foyer**     |

Coûts négligeables à l'échelle d'un foyer. Pour un self-host familial, l'utilisateur peut très bien fournir sa propre clé API sans s'inquiéter.

### Choix de providers recommandés

- **Par défaut** : Claude Haiku 4.5 (rapide, bon marché, excellent en français, function calling solide). Pour la Vision : Claude Sonnet 4.6.
- **Alternative économique** : Mistral Small (fr-natif, prix bas, hébergé EU — RGPD-friendly).
- **Alternative perf** : GPT-5 / Claude Opus 4.6 pour le chat assistant si l'utilisateur en a besoin.

Laisser l'utilisateur choisir via les settings : provider + modèle + clé API.

---

## 4. Fonctionnalités non-IA différenciantes (à mixer avec la roadmap IA)

### Doit avoir — fondation collaborative

- **Multi-comptes par foyer** (refonte du modèle de données) : table `households`, `household_members` avec rôles (admin/membre/enfant). Toute la donnée scope par `household_id`. C'est la condition pour que la moitié des features IA prennent vraiment du sens (planning partagé, conflits d'agenda…).
- **Notifications push fonctionnelles** : implémenter ce qui est déjà annoncé. Web Push (déjà installé) + email fallback (`nodemailer`). Triggers : tâche assignée, RDV J-1, budget dépassé, courses ajoutées par un autre membre.
- **WebSocket réel pour la sync temps réel** : un membre ajoute un item → tous les téléphones connectés voient la liste se mettre à jour. (Combiné à la refonte household.)
- **Vrai mode offline** : IndexedDB + queue de mutations + sync au retour réseau. La PWA actuelle est cosmétique.

### Devrait avoir — qualité de vie

- **Templates récurrents intelligents** : "Courses du dimanche", "Repas type semaine d'école". Réutilisables et combinables.
- **Mode lecture seule pour enfants** : un membre marqué `role: 'child'` ne voit que ses propres tâches/RDV, pas le budget. PIN parental pour switcher.
- **Géolocalisation des courses** : associer un magasin à un item ("acheter ce produit chez Biocoop"). Notification quand on s'approche du magasin (opt-in, 100% local — geofencing navigateur).
- **Calendrier ICS export/import** : exposer un flux ICS des `appointments` (lecture seule, token URL). Branchable dans Apple Calendar/Google Cal côté chaque membre.
- **Import recettes depuis URL** (Marmiton, 750g, Cookidoo public…) : scraping + IA pour structurer.
- **Codes-barres** : scan d'un produit pour l'ajouter à la liste (API Open Food Facts gratuite, base FR très complète).
- **Photos sur recettes et items** : upload côté serveur avec resize automatique (sharp), stockage local volume Docker.

### Pourrait avoir — différenciation forte

- **Module "Santé famille"** : historique vaccins par membre (rappels automatiques de l'OMS/HAS), suivi croissance enfants (courbes), carnet médical exportable PDF. **Le schéma existe déjà à 70%** (allergies, vaccines, blood_type, medical_notes), il faut juste l'exploiter dans l'UI.
- **Module "Documents"** : stockage chiffré (KMS local) des PDF importants (carte vitale, ordonnances, factures…). Tags par membre. Sortable PDF zippé chiffré à la demande.
- **Module "Maison"** : inventaire des biens (garantie, date d'achat, facture liée → relais module Documents), planning d'entretien (filtre VMC tous les 3 mois, vidange…).
- **Mode "Voisinage / co-parentalité"** : partager un sous-ensemble de planning avec un autre foyer (grands-parents, ex-conjoint). Permissions fines par module.
- **Marketplace de templates** : les utilisateurs partagent (opt-in) leurs templates de listes / planning / recettes sur un hub public NexaFlow. Croissance organique.

### Bonus tech (open source quality)

- **i18n complet** (FR + EN + ES + DE minimum) avec `react-i18next`. **Indispensable pour adoption open source.**
- **Thèmes utilisateur** (les color presets existent déjà, exposer un picker complet + import/export).
- **Backups automatiques** : `pg_dump` quotidien chiffré dans un dossier configurable (S3/Backblaze optionnel), rotation 30 jours.
- **CLI d'administration** : `openfamily-cli reset-password`, `create-admin`, `import`, `backup`, `migrate`. Aide énorme pour le self-host.
- **Dashboard d'administration** (pour le owner du serveur) : nombre de users, espace disque, état des backups, logs récents.

---

## 5. Roadmap proposée (3 sprints de 2 semaines)

### Sprint 1 — Stabiliser le terrain (semaines 1-2)

**Objectif :** plus aucune nouvelle feature avant que la base soit saine.

- [ ] Fix `dataTransfer.ts` (whitelist colonnes).
- [ ] Auth WebSocket via JWT (ou suppression du WS si pas branché à court terme).
- [ ] `helmet()` + rate-limit global + middleware `validateUUID`.
- [ ] Migration token → cookie httpOnly (refresh court).
- [ ] ESLint + Prettier + Husky + Vitest (auth + 1 CRUD comme exemple).
- [ ] React Query côté front (un module pilote : Shopping).
- [ ] `react-i18next` + extraction des strings FR.

### Sprint 2 — Multi-membres + premières features IA (semaines 3-4)

**Objectif :** débloquer la dimension "famille" et livrer les premiers wins IA.

- [ ] Refonte modèle de données : `households`, `household_members`, scoping de **toutes** les tables.
- [ ] Page Settings → "Inviter un membre" (token email court).
- [ ] AIService + provider Claude (clé API utilisateur dans Settings, chiffrée).
- [ ] Feature IA #1 — Ajout courses en langage naturel.
- [ ] Feature IA #2 — Auto-catégorisation (avec cache DB).
- [ ] Feature IA #4 — Recette → liste de courses.

### Sprint 3 — Sync temps réel + assistant (semaines 5-6)

**Objectif :** transformer l'app en outil quotidien partagé.

- [ ] WebSocket sécurisé + sync temps réel (Shopping + Tasks d'abord).
- [ ] Web Push réel (au moins : nouvelle tâche assignée + nouveau item courses).
- [ ] Feature IA #3 — Parsing ticket de caisse (Claude Sonnet Vision).
- [ ] Feature IA #5 — Planning repas hebdo généré.
- [ ] Feature IA #6 — Assistant chat avec function calling (MVP : create_task, add_shopping_item, create_appointment).

À l'issue de ces 3 sprints, OpenFamily est passé de "app perso bien faite mais isolée" à "**plateforme familiale collaborative avec IA**" — positionnement difficilement copiable par Bring!, Cozi ou Tody dans l'année.

---

## 6. Métriques pour mesurer l'impact

Si tu veux suivre les progrès au-delà du ressenti :

- **Time-to-value** : temps moyen entre l'ouverture de l'app et la première action utile (clic sur item de courses, validation d'une tâche…). Vise < 5s.
- **Rétention 7j / 30j** par membre, pas par foyer.
- **Actions IA / membre / semaine** : indicateur d'adoption réelle des features IA.
- **% d'actions IA confirmées sans modification** : qualité du prompt engineering. < 70% = à retravailler.
- **Coût IA moyen / foyer / mois** : garder l'œil dessus pour ajuster les prompts.

---

## 7. Ce qu'il faut décider maintenant

1. **Confirmer le scope du Sprint 1** (sécurisation + qualité) — _non négociable à mon avis_.
2. **Choisir le provider IA par défaut** : Claude Haiku 4.5 recommandé pour ratio qualité/prix/français. Mistral Small si position RGPD-EU prioritaire.
3. **Décider du modèle de monétisation futur** (impacte la roadmap) : 100% gratuit/self-host ? Ou freemium avec offre hébergée à terme (clé IA partagée) ?
4. **Position open source** : si l'objectif inclut la croissance OSS, **i18n est bloquant** et doit remonter en priorité.
5. **Niveau de risque acceptable sur l'IA** : tolère-t-on des hallucinations occasionnelles (ex. l'IA crée un RDV mal placé) ? La stratégie "diff de confirmation avant exécution" est ma reco.

---

_Document généré en mode "tech-lead + product" — n'hésite pas à demander un focus sur n'importe quelle section (spec technique d'une feature IA, design détaillé du modèle households, plan de migration DB, etc.)._
