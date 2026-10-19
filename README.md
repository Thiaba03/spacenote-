# SpaceNotes

Application React/Vite connectée à Supabase pour l'authentification et la sauvegarde des notes.

## Installation

1. Installer les dépendances :

   ```bash
   npm install
   ```

2. Copier `.env.example` vers `.env.local` et remplacer les deux valeurs par celles du projet Supabase :

   ```env
   VITE_SUPABASE_URL=https://votre-projet.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=votre_cle_publiable
   ```

   Ces valeurs se trouvent dans Supabase : **Project Settings > API**. Ne jamais placer la clé `service_role` dans cette application.

3. Dans le **SQL Editor** de Supabase, exécuter le fichier `supabase/notes.sql` une seule fois.

4. Démarrer l'application :

   ```bash
   npm run dev
   ```

## Fonctionnalités Supabase intégrées

- inscription et connexion par e-mail/mot de passe ;
- session conservée après le rechargement de la page ;
- chargement des notes appartenant à l'utilisateur connecté ;
- création et modification avec enregistrement automatique ;
- suppression d'une note ;
- protection des données par Row Level Security (RLS).

Le fichier `.env.local` est volontairement ignoré par Git et n'est pas inclus dans les archives de livraison.




# Spacenote

Spacenote est une application web pour **créer, organiser, modifier et partager des notes**. L'interface permet de retrouver ses notes, de les classer dans des dossiers et de les modifier dans un éditeur. Le projet gère aussi le partage de notes et la réception de notes partagées.

- **Dépôt** : https://github.com/Poeple2/Spacenote
- **Branche principale** : `main`

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Utilisation courante](#utilisation-courante)
3. [Partager une note](#partager-une-note)
4. [Fonctionnement technique](#fonctionnement-technique)
5. [Lancer le projet en local](#lancer-le-projet-en-local)
6. [Publication et déploiement](#publication-et-déploiement)
7. [Dépannage](#dépannage)
8. [Checklist de mise en production](#checklist-de-mise-en-production)

---

## Fonctionnalités

| Partie | Rôle |
|---|---|
| **Connexion / compte** | Écran d'authentification pour accéder à l'espace utilisateur. Les fonctions nécessitant un compte dépendent de la configuration de l'authentification Supabase. |
| **Barre latérale** | Navigation dans l'espace de notes : choix d'une vue ou d'un dossier. |
| **Liste des notes** | Affiche les notes de la vue sélectionnée. Cliquer sur une note l'ouvre dans l'éditeur. |
| **Éditeur de note** | Consultation et modification du contenu. Le modèle de contenu accepte plusieurs blocs : texte, liens, images et tableaux. |
| **Dossiers** | Regroupement des notes pour mieux les retrouver. |
| **Notes partagées** | Zone de réception des notes partagées. Les actions disponibles dépendent des droits et de l'état du partage. |
| **Barre d'état** | Affiche des informations d'état et des indications utiles. |

---

## Utilisation courante

1. Ouvrir l'adresse de l'application.
2. Se connecter ou créer un compte si l'écran d'authentification le propose.
3. Dans la barre latérale, choisir la vue générale ou le dossier souhaité.
4. Dans la liste, sélectionner une note pour l'ouvrir dans l'éditeur.
5. Créer une note (si la commande est disponible), lui donner un titre et ajouter son contenu.
6. Modifier le texte ou les blocs proposés ; ajouter des liens, des images ou des tableaux selon les commandes disponibles.
7. Vérifier que les changements sont enregistrés avant de quitter la note (attendre la confirmation de sauvegarde si l'interface en affiche une).
8. Pour retrouver une note plus tard, revenir à la liste ou au dossier dans lequel elle est rangée.

---

## Partager une note

Le projet inclut des fonctionnalités de partage et une boîte de réception dédiée aux notes partagées.

Pour partager : ouvrir la note, utiliser la commande de partage de l'interface, renseigner le destinataire ou les informations demandées, puis vérifier le résultat affiché.

### Envoi par e-mail

L'envoi de courriel passe par une **Supabase Edge Function** nommée `send-note-email`. Pour qu'il fonctionne, cette fonction doit être **déployée et correctement configurée** dans le projet Supabase. En cas d'échec, vérifier :

- le déploiement de la fonction ;
- ses paramètres ;
- les journaux Supabase.

> ⚠️ Une interface qui s'affiche ne garantit pas que le partage par e-mail fonctionne. Faire un test réel avec un compte de test avant toute mise en production.

---

## Fonctionnement technique

### Interface web

Application basée sur **React** et **Vite** : React construit les écrans et composants, Vite lance le serveur de développement et génère les fichiers de production.

### Données et services Supabase

Supabase fournit les services côté serveur : authentification et accès aux données. Le dossier `supabase/` contient des ressources SQL. La structure exacte des tables, les politiques de sécurité (RLS) et les fonctions déployées doivent être vérifiées dans le **projet Supabase réellement rattaché** à l'application.

Les images de notes utilisent le **stockage Supabase** : un bucket `note-images` et des **URL signées** pour l'affichage. Une URL signée étant temporaire, si une image ne s'affiche plus, vérifier le fichier dans le stockage et la façon dont l'application renouvelle ou génère l'URL.

### Schéma simplifié

```
Utilisateur → Interface React → Services Supabase
                                  ├─ Authentification
                                  ├─ Données des notes et partages
                                  ├─ Stockage des images
                                  └─ Fonction d'envoi de courriel (si déployée)
```

---

## Lancer le projet en local

### Prérequis

- Git
- Node.js avec npm
- Accès au dépôt GitHub
- Accès au projet Supabase utilisé

### Installation

```bash
git clone https://github.com/Poeple2/Spacenote.git
cd Spacenote
npm install
```

### Configuration

Créer un fichier `.env.local` à la racine du projet avec les variables suivantes :

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Les valeurs se trouvent dans les paramètres du projet Supabase autorisé. Le fichier `.env.example` sert de modèle, mais ne contient pas les vraies valeurs.

> 🔒 Ne jamais écrire de secret ou de clé privée dans le dépôt Git.

### Démarrage

```bash
npm run dev
```

Vite affiche l'adresse locale dans le terminal, généralement http://localhost:5173 (accessible uniquement depuis l'environnement de développement).

---

## Publication et déploiement

Un dépôt GitHub contient le code, mais ne suffit pas à rendre l'application accessible au public. Pour mettre en ligne :

1. Choisir ou retrouver l'hébergeur associé au projet (par exemple Vercel).
2. Configurer `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans l'environnement de déploiement.
3. Vérifier que l'URL de production est autorisée dans la configuration d'authentification Supabase.
4. Déployer les fonctions Edge nécessaires, dont `send-note-email` si l'envoi de courriel est utilisé.
5. Tester la connexion, la création/modification des notes, le stockage des images et les partages sur l'environnement publié.

---

## Dépannage

| Problème | À vérifier |
|---|---|
| La connexion ne fonctionne pas | Variables Supabase, existence du projet Supabase, URL autorisées, journaux d'authentification. |
| Les notes ne se chargent pas ou ne s'enregistrent pas | Connexion réseau, configuration Supabase, tables utilisées par le code, politiques d'accès (RLS). |
| Les images ne s'affichent pas | Bucket `note-images`, droits d'accès, génération et expiration des URL signées. |
| Le partage ou l'e-mail échoue | Droits du compte, logique de partage, déploiement de `send-note-email` et ses paramètres. |
| Le projet ne démarre pas en local | Version de Node.js, `npm install`, présence de `.env.local`, message d'erreur de `npm run dev`. |

---

## Checklist de mise en production

- [ ] Accès au dépôt GitHub avec le bon niveau de droits
- [ ] Projet Supabase utilisé par l'application identifié et accessible
- [ ] Tables, règles de sécurité, bucket d'images et fonctions Edge présents dans le bon projet
- [ ] Application publiée configurée avec les bonnes variables d'environnement
- [ ] Test complet effectué : connexion, création d'une note, modification, image, partage et réception

---

## Notes importantes

- Les données Supabase et les fichiers stockés sont gérés **séparément** du dépôt GitHub.
- Transmettre les accès Supabase et hébergeur de façon sécurisée. Ne jamais envoyer de clé secrète, de mot de passe ou de fichier `.env.local` par e-mail non sécurisé, ni les committer.
- Avant toute modification importante, vérifier l'état du déploiement et effectuer un test de bout en bout.
- Ce document décrit les fonctionnalités et éléments techniques connus du dépôt. Les noms exacts des boutons, l'état réel du déploiement et la configuration active de Supabase doivent être confirmés dans l'interface et les comptes concernés.
