Guide d’installation sur un autre poste (version online)
-------------------------------------------------------

1) Télécharger l’installateur en ligne
   - Ouvrez: https://jts-services.shop/stock/ressources/stock_payload_latest.zip
   - Enregistrez le fichier sur votre ordinateur.

2) Extraire l’archive (protégée par mot de passe)
   - Logiciel recommandé: 7‑Zip (https://www.7-zip.org/)
   - Mot de passe du ZIP: (fourni par l’administrateur)
     Exemple utilisé lors des tests: Gilles29060183
   - Si l’extraction échoue, vérifiez que vous utilisez bien le MOT DE PASSE DU ZIP (et non le mot de passe d’installation).

3) Lancer l’installation
   - Dans le dossier extrait, ouvrez scripts\install-client.ps1 par clic droit → “Exécuter avec PowerShell”.
   - Mot de passe d’installation: (fourni par l’administrateur)
     Exemple utilisé lors des tests: Gilles296183@
   - L’installateur installe Node.js/pm2 si nécessaire, configure le port 80 (URLACL + pare-feu), puis crée 3 raccourcis sur le Bureau:
     • JTS Stock (Local)
     • JTS Stock (En ligne)
     • JTS Stock (Mise à jour)

4) Conseils / dépannage
   - Si 7‑Zip n’est pas installé, l’installateur tentera de l’installer automatiquement.
   - Si l’extraction échoue pour un fichier: resaisissez le MOT DE PASSE DU ZIP.
   - Si le serveur local ne démarre pas, relancez “JTS Stock (Local)” ; vérifiez que le port 80 est libre ou contactez l’administrateur.

Nota:
 - La version “en ligne” (Hostinger) est la source officielle pour l’installation sur d’autres postes. Le dépôt Git reste réservé aux mises à jour/maintenance.
 - Les deux mots de passe sont distincts:
     (1) Mot de passe ZIP: pour déchiffrer l’archive téléchargée
     (2) Mot de passe d’installation: pour autoriser l’exécution du script d’installation

Support: jts-services.shop
