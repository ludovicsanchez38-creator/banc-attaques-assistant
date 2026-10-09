# Signaler une faille

Une faille du banc lui-même (une clé qui finirait dans un fichier de résultats, un plafond de dépense contournable, une réponse de la cible capable d'agir sur la machine qui lance le banc) se signale en privé. Utilisez le signalement privé du dépôt (onglet **Security and quality**, bouton **Report a vulnerability**), en décrivant la version, le scénario et ses conséquences. Si ce bouton n'apparaît pas, ouvrez un ticket qui demande un contact privé, sans aucun détail technique.

Une attaque qui passe à travers **votre** assistant se corrige chez vous : le banc est fait pour la débusquer, inutile de la signaler ici. Une technique publiée qui manque au corpus est en revanche bienvenue, en ticket public, écrite avec vos mots et avec sa source.

Rappels d'usage :

- ne lancez le banc que contre un assistant que vous exploitez, ou avec l'accord écrit de son exploitant ;
- `resultats/` contient les réponses de votre assistant et `.banc/` le registre de vos dépenses : ne les publiez pas (le `.gitignore` les exclut déjà) ;
- la clé du juge se lit dans l'environnement ; le banc relit ses fichiers de résultats avant de rendre la main et échoue (code 5) s'il y trouve une clé ou un secret cité par la configuration ; après une fin anormale (Ctrl+C, arrêt, terminal fermé, erreur), il fait le même contrôle et prévient, à l'écran et dans un fichier `ALERTE-SECRET.txt` du dossier. Un arrêt brutal du processus (`kill -9`, coupure de courant) ne laisse pas ce temps : relisez alors le dossier vous-même.
