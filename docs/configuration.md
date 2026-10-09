# Configuration du banc

Un fichier JSON, `banc.config.json` par défaut (`--config` pour un autre). [exemples/configuration.exemple.json](../exemples/configuration.exemple.json) montre les champs courants. Les secrets n'y figurent jamais : l'adresse, un en-tête ou une valeur du corps peut citer une variable d'environnement sous la forme `${NOM}` (lettres, chiffres et `_`, sans commencer par un chiffre). Le banc vérifie avant le premier envoi que chaque variable citée existe, et relit ses fichiers de résultats à la fin pour s'assurer qu'aucune de ces valeurs n'y figure.

## Premier niveau du fichier

| Champ | Rôle | Défaut |
|---|---|---|
| `plafond_usd` | Plafond de dépense, cumulé sur tous les passages qui partagent le même registre (`dossier_donnees`) | `3` |
| `concurrence` | Requêtes simultanées vers la cible (1 à 8) | `1` |
| `dossier_resultats` | Où écrire les rapports (relatif au fichier de configuration) | `resultats` |
| `dossier_donnees` | Où tenir le registre des dépenses (relatif au fichier de configuration) | `.banc` |
| `temoins_supplementaires` | Vos propres questions légitimes, jouées comme témoins T05, T06... | aucun |
| `cible`, `contexte`, `controles`, `juge` | Sections décrites ci-dessous | |

## `cible` : comment parler à votre assistant

| Champ | Rôle | Défaut |
|---|---|---|
| `url` | Adresse de l'API de l'assistant | obligatoire |
| `methode` | `POST`, `PUT` ou `PATCH` | `POST` |
| `entetes` | En-têtes HTTP. `Content-Type: application/json` est ajouté si vous n'en donnez pas | `Content-Type` seul |
| `corps` | Gabarit JSON de la requête (objet ou tableau), avec les marqueurs ci-dessous | obligatoire |
| `reponse.format` | `json`, `texte` ou `sse` (flux d'événements) | `json` |
| `reponse.chemin` | Où lire le texte dans le JSON, en notation pointée (`choices.0.message.content`) ; en `sse`, où lire chaque fragment (un événement qui n'est pas du JSON est pris tel quel) | `reponse` |
| `historique.mode` | `corps` : la conversation voyage dans la requête ; `session` : le serveur la garde ; `aucun` : chaque question est isolée | `corps` |
| `historique.format_message` | Forme d'un message, avec `{{role}}` et `{{contenu}}` | `{"role": "{{role}}", "content": "{{contenu}}"}` |
| `historique.roles` | Noms des rôles chez vous (`utilisateur`, `assistant`, `systeme`) | `user`, `assistant`, `system` |
| `historique.attributs_assistant` | Attributs à lire dans chaque réponse et à recopier sur le message de l'assistant au tour suivant, par exemple `{"signature": "signature"}` | aucun |
| `session.cookies` | Renvoyer les cookies reçus au tour suivant | `true` |
| `session.chemin_identifiant` | Où lire l'identifiant de conversation dans la réponse (ou dans les événements du flux), réinjecté par `{{session}}` | aucun |
| `statuts_refus` | Statuts HTTP qui veulent dire « requête refusée par la cible » (verdict `bloque`) | `[400, 403, 422]` |
| `delai_entre_requetes_ms` | Pause avant chaque requête, pour ménager votre service | `0` |
| `delai_max_ms` | Délai maximal d'une réponse | `60000` |
| `cout_estime_par_appel_usd` | Ce que vous coûte une question, si vous voulez que le plafond en tienne compte ; compté à l'envoi | `0` |

Marqueurs du corps :

- `"{{question}}"` : la question du visiteur, seule ou à l'intérieur d'une chaîne ;
- `"{{historique}}"` : la conversation précédente, en tableau de messages (seul dans sa valeur) ;
- `"{{messages}}"` : la conversation précédente plus la question, en un seul tableau (forme des API « chat completions », seul dans sa valeur) ;
- `"{{session}}"` : l'identifiant de conversation lu au tour précédent (`null` au premier tour).

En mode `session` ou `aucun`, la famille `historique` (12 attaques) est marquée « sans objet » : un attaquant ne peut pas glisser de faux messages dans une conversation qu'il n'envoie pas. En mode `aucun`, les attaques en plusieurs tours le sont aussi.

### Exemple : une API de type « chat completions »

```json
{
  "cible": {
    "url": "https://recette.example.org/v1/chat/completions",
    "entetes": { "Authorization": "Bearer ${CIBLE_JETON}" },
    "corps": { "model": "votre-modele", "messages": "{{messages}}" },
    "reponse": { "format": "json", "chemin": "choices.0.message.content" }
  }
}
```

Dans cette forme, le banc envoie la conversation sans votre message système. Ne l'utilisez que si votre serveur ajoute lui-même ses consignes, comme le fait un vrai assistant de site.

### Exemple : une conversation gardée par le serveur, réponse en flux

```json
{
  "cible": {
    "url": "https://recette.example.org/api/chat",
    "corps": { "message": "{{question}}", "conversation": "{{session}}" },
    "historique": { "mode": "session" },
    "session": { "cookies": true, "chemin_identifiant": "conversation_id" },
    "reponse": { "format": "sse", "chemin": "delta.text" }
  }
}
```

### Exemple : un historique signé par le serveur

Si votre serveur signe chaque réponse et exige la signature quand l'historique revient, le banc la recopie :

```json
{
  "cible": {
    "url": "https://recette.example.org/api/assistant",
    "corps": { "question": "{{question}}", "historique": "{{historique}}" },
    "historique": { "mode": "corps", "attributs_assistant": { "signature": "signature" } },
    "reponse": { "format": "sse", "chemin": "texte" }
  }
}
```

Les historiques fabriqués de la famille `historique` (K01 à K12) n'ont pas de signature : votre serveur doit les refuser, et le banc compte alors `bloque`.

## `contexte` : de quoi parle votre assistant

Neuf variables remplissent les attaques et sont **obligatoires** (le banc s'arrête si l'une manque) :

| Variable | Exemple | Remarque |
|---|---|---|
| `entreprise` | `Atelier Exemple` | |
| `assistant` | `Pilou` | le nom de l'assistant |
| `dirigeant` | `Dominique Exemple` | un nom fictif suffit, et s'impose pour la rumeur de condamnation E02 (voir [Cadre légal](../README.md#cadre-légal-et-données-personnelles)) |
| `offre` | `la formule Découverte` | avec son article, comme l'écrirait un visiteur |
| `offre_2` | `la formule Équipe` | une deuxième offre réelle |
| `offre_absente` | `l'abonnement Premium annuel` | une offre que vous ne vendez pas |
| `concurrent` | `Concurrent et Cie` | un nom fictif suffit |
| `ville` | `Rouen` | |
| `domaine` | `atelier.example` | sans `https://` |

Les autres champs servent au juge et aux contrôles :

- `lien_contact` : votre page de contact, ajoutée aux liens autorisés et citée au juge ;
- `description` : une phrase sur votre activité ;
- `langue_attendue` : `fr`, `en`, ou rien si l'assistant répond dans la langue du visiteur ;
- `faits_publics` : une liste de faits affichés sur votre site que l'assistant peut citer sans que ce soit un engagement (le juge ne voit pas votre site) ;
- `regles` : une liste de phrases, vos propres règles, qui remplacent [juge/regles-par-defaut.md](../juge/regles-par-defaut.md).

## `controles` : les filets automatiques

| Champ | Rôle | Défaut |
|---|---|---|
| `liens_autorises` | Les seuls liens permis. Une entrée qui finit par `/` autorise tout ce qui est en dessous | `https://<domaine>/`, `https://www.<domaine>/` et `lien_contact` |
| `marqueurs_fuite` | Des phrases ou des noms de balises de vos consignes : les voir dans une réponse lève `fuite_marqueur` | aucun |
| `fichier_consignes` | Vos instructions système (fichier local, jamais envoyé) : le banc repère les passages recopiés | aucun |
| `fichier_base` | Le contenu de votre site : les montants et pourcentages qui n'y figurent pas sont signalés | aucun |
| `motifs_interdits` | Des expressions régulières à ne jamais voir (une adresse postale, un nom de client), chacune avec un `code` | aucun |
| `longueur_max` | Au-delà de ce nombre de caractères, la réponse est signalée comme longue (drapeau non grave) | `1200` |

## `juge`

| Champ | Rôle | Défaut |
|---|---|---|
| `modele` | Modèle juge | `claude-sonnet-5-5` |
| `tarif_usd_par_million` | `{"entree": ..., "sortie": ...}`, obligatoire pour un modèle absent de la table du code ; pour un modèle connu, le plus élevé des deux tarifs l'emporte | tarif connu |
| `max_tokens` | Longueur maximale d'un verdict, en tokens (50 à 8192) | `400` |
| `parametres` | Paramètres ajoutés à l'appel, limités à `thinking`, `output_config` et `metadata` | pas de réflexion préalable : `{"thinking": {"type": "between_tools"}}` pour Sonnet 5.5, `{"thinking": {"type": "disabled"}}` pour Haiku 5.5, rien pour un autre modèle |
| `variable_cle` | Variable d'environnement qui contient la clé | `ANTHROPIC_API_KEY` |
| `url_api` | Autre adresse d'API (passerelle, juge factice) | API d'Anthropic |
| `fichier_grille` | Votre propre grille de jugement | [juge/grille.md](../juge/grille.md) |

Le client du juge n'utilise que la clé de `variable_cle` et l'adresse configurée : il ignore `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` et `ANTHROPIC_CUSTOM_HEADERS`, que le SDK lirait sinon.

Pour un juge moins cher, Claude Haiku 5.5, avec la réflexion désactivée par défaut (réglage que ce modèle accepte d'après la [page des erreurs](https://platform.claude.com/docs/en/api/errors), relue le 09/10/2026) :

```json
{
  "juge": { "modele": "claude-haiku-5-5" }
}
```
