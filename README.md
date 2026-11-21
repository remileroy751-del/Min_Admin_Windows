# Harrwama Mind Admin — version Windows

Logiciel d'administration installable sur ordinateur (Windows 10/11, 64 bits), équivalent de l'application mobile :

- **Tableau de bord** : commandes, messages, produits et services en un coup d'œil
- **Accueil du site** : modification du titre/texte et du **téléphone principal** (mise en ligne immédiate)
- **Produits** (10 max) et **Services** : ajouter, modifier (texte + photo), supprimer
- **Commandes** : Nouvelles / En cours / Livrées, détail complet avec photo du produit, bouton WhatsApp du client avec message de confirmation prêt à envoyer
- **Messagerie** : messages « Nous écrire » signés du nom du visiteur, réponse directe sur WhatsApp
- **Alertes Windows** : notification à chaque nouvelle commande ou nouveau message (vérification toutes les 30 secondes), l'application reste active dans la zone de notification
- **Réglages** : connexion (adresse du site + jeton Netlify, chiffré par Windows), démarrage avec Windows

## Compiler sur GitHub (automatique)

1. Créez un dépôt GitHub (vide) puis déposez-y **tout le contenu** de ce dossier (le dossier `.github` compris).
2. La compilation démarre toute seule : onglet **Actions** > « Compiler Harrwama Mind Admin (Windows) » (≈ 5 à 8 minutes).
3. Récupérez l'installateur `HarrwamaMindAdmin-Setup-1.0.0.exe` :
   - dans **Releases** (à droite sur la page du dépôt) > « Harrwama Mind Admin pour Windows », ou
   - dans l'exécution du workflow > **Artifacts**.
4. Double-cliquez sur l'installateur : raccourci Bureau + menu Démarrer créés.

> Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » car l'installateur n'est pas signé numériquement : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Première utilisation

Réglages > adresse du site (ex. `harrwama-mind.netlify.app`) + jeton Netlify (User settings > Applications > Personal access tokens) > **Tester et enregistrer**.
Ce sont les mêmes informations que dans l'application mobile. Les deux applications peuvent être utilisées en même temps : le logiciel relit toujours les données du site avant de modifier, pour ne jamais écraser un changement fait depuis le téléphone.

## Développement

```
npm install
npm start     # lance le logiciel
npm test      # teste la logique avec un faux serveur Netlify
npm run dist  # construit l'installateur (dossier dist/)
```
