# Jazz Legacy

Le code de production est publié depuis `main` sur Cloudflare Workers. Le catalogue maître et les médias sont conservés sur le PC dans le dossier Jazz Legacy, à côté de ce dépôt. Cloudflare R2 héberge uniquement les fichiers nécessaires au site. Supabase synchronise la bibliothèque personnelle des comptes facultatifs.

## Code et déploiement

Les commandes de vérification sont `npm ci` puis `npm run check`. `npm run dev -- --port 3000` ouvre le lecteur avec un catalogue fictif. Un push sur `main` lance Workers Builds, avec `npm run check` comme commande de build et `npx wrangler deploy --keep-vars` comme commande de déploiement. La configuration Wrangler utilise le bucket existant `heads-audio`. Un `git revert` sur `main` permet de remettre en ligne le code précédent.

Les MP3 de l’édition active sont accessibles à tous depuis le lecteur audio. Lorsqu’une version est disponible uniquement sur YouTube, le lecteur peut afficher un lien vers la page de la vidéo. Configurer `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` dans les variables du Worker pour les comptes facultatifs et les paroles personnelles. `JAZZ_OWNER_ID` désigne l’UUID du compte autorisé à consulter les diagnostics et les mesures de volume. Ajouter l’adresse du site dans les URL de retour autorisées de Supabase. La connexion Google et l’envoi des liens par e-mail sont configurés dans Supabase.

Pour utiliser l’adresse neutre, créer le projet Cloudflare Pages `jazz-legacy` depuis le même dépôt et la branche `main`, avec `pages` comme racine, `public` comme dossier de sortie et une commande de build vide. La configuration dans `pages/` relie directement Pages au Worker `jazz-legacy`. Après validation de la nouvelle adresse et de la connexion Supabase sur cette adresse, définir `JAZZ_PUBLIC_ORIGIN` dans les variables de production du Worker avec l’origine Pages pour rediriger les anciens liens `workers.dev`.

## Catalogue Windows

Depuis le dossier de ce dépôt, `catalogue.bat preparer` ajoute un standard ou une version au fichier maître du dossier voisin `catalogue-local`. `catalogue.bat verifier` vérifie les correspondances locales. `catalogue.bat publier` présente les changements puis demande de confirmer l’envoi. `catalogue.bat retablir` repointe le site vers l’édition précédente.

Les dossiers Windows `audio` et `jaquettes` restent en place. Pour télécharger les MP3 liés au catalogue, le script historique `scripts/telecharger_audio.bat`, situé à la racine du dossier Jazz Legacy, accepte `-CataloguePath .\catalogue-local\catalogue-data.json` depuis cette racine. L’analyse historique `scripts/analyse_loudness.bat` régénère `audio/loudness.json`. Vérifier les correspondances avant de publier. La connexion rclone reste enregistrée dans la configuration Windows existante.

L’envoi réutilise les fichiers R2 dont l’empreinte correspond. Il vérifie les nouveaux objets et le catalogue avant de modifier `jazz-legacy/current.json`. Un rafraîchissement en ligne relit ce pointeur. Les médias restent disponibles par leurs anciennes URL relatives dans le lecteur et l’ensemble du catalogue peut être rétabli indépendamment du code.

## Changement d’adresse

Les bibliothèques déjà synchronisées restent dans le projet Supabase existant. Pour récupérer les favoris et playlists du mode invité, exécuter `scripts/export-sites-library.js` dans la console du navigateur sur l’ancien site, à partir du profil concerné. Importer le JSON dans Mon compte sur la nouvelle adresse, avant de se connecter.

Pour les paroles personnelles, exécuter `scripts/export-sites-lyrics.js` sur l’ancien site, connecté au compte qui les contient, puis importer le fichier depuis le nouveau site une fois connecté. Les textes déjà présents sont conservés. Conserver Sites et son dépôt source jusqu’à la vérification de la nouvelle adresse.
