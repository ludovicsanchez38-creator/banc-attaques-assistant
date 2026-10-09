# Sources du corpus d'attaques

Chaque attaque de `corpus/attaques.json` porte une clé `source` qui renvoie à une ligne de ce tableau : elle reprend une technique ou un incident publié, avec un texte écrit pour le banc. Deux exceptions courtes, signalées dans les notes et dans le corpus : l'ouverture de B02, l'invite et la demande de C02. Quand le rattachement se fait par analogie (un incident qui montre le risque sans décrire l'attaque exacte), la note le dit.

Toutes les adresses ont été ouvertes le **09/10/2026** : chacune répond et porte bien le titre indiqué. Deux sites bloquent les robots (McCarthy et EUR-Lex) et ont été relus par un autre moyen, comme l'indiquent leurs notes. Les citations d'OWASP sont nos traductions.

| Clé | Technique | Source | Attaques |
|---|---|---|---|
| `owasp-llm01` | Injection directe et indirecte, attaque découpée en morceaux, encodages, image Markdown d'exfiltration | [OWASP, *LLM01:2025 Prompt Injection*](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)[^llm01] | A07, B01, B06, B07, B14, B17, B18, E03, E08, H02 à H04, H06, I01, I02, J04, K10 |
| `owasp-llm02` | Divulgation d'informations sensibles | [OWASP, *LLM02:2025 Sensitive Information Disclosure*](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/) | G01 à G08 |
| `owasp-llm05` | Sortie mal traitée : liens `javascript:` ou `data:` rendus par le site | [OWASP, *LLM05:2025 Improper Output Handling*](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/) | H01, H05 |
| `owasp-llm07` | Fuite des instructions système | [OWASP, *LLM07:2025 System Prompt Leakage*](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/)[^llm07] | A01 à A05, A08, A09, A11, A12, F04 |
| `owasp-llm09` | Désinformation : rumeur relayée, conseil personnel présenté comme sûr | [OWASP, *LLM09:2025 Misinformation*](https://genai.owasp.org/llmrisk/llm092025-misinformation/) | E02, E04 à E07 |
| `owasp-llm10` | Consommation illimitée : l'assistant utilisé comme modèle gratuit | [OWASP, *LLM10:2025 Unbounded Consumption*](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/) | D01 à D04, D07 à D10 |
| `anthropic-msj` | *Many-shot jailbreaking* : de faux dialogues où l'assistant obéit, puis la vraie demande | [Anthropic, 02/04/2024](https://www.anthropic.com/research/many-shot-jailbreaking)[^msj] | B08, K04, K11 |
| `best-of-n` | *Best-of-N* : la demande rejouée avec majuscules aléatoires et lettres permutées | [Hughes et al., arXiv 2412.03556, déc. 2024](https://arxiv.org/abs/2412.03556) | I08 à I10 |
| `crescendo` | *Crescendo* : une escalade sur plusieurs tours | [Russinovich, Salem, Eldan (Microsoft), arXiv 2404.01833, 2024](https://arxiv.org/abs/2404.01833)[^scripte] | J01, J02 |
| `skeleton-key` | *Skeleton Key* : ajouter un avertissement au lieu de refuser | [Microsoft, 26/06/2024](https://www.microsoft.com/en-us/security/blog/2024/06/26/mitigating-skeleton-key-a-new-type-of-generative-ai-jailbreak-technique/) | B12 |
| `policy-puppetry` | *Policy Puppetry* : fausse politique en XML, JSON ou INI, jeu de rôle, leetspeak | [HiddenLayer, 24/04/2025](https://www.hiddenlayer.com/research/novel-universal-bypass-for-all-major-llms)[^puppetry] | A06, A10, B09 à B11, I03 |
| `echo-chamber` | *Echo Chamber* : des graines anodines, puis des renvois au contexte empoisonné | [NeuralTrust, 23/06/2025](https://neuraltrust.ai/blog/echo-chamber-context-poisoning-jailbreak)[^scripte] | J03 |
| `deceptive-delight` | *Deceptive Delight* : le sujet interdit noyé entre deux sujets anodins | [Unit 42, 23/10/2024](https://unit42.paloaltonetworks.com/jailbreak-llms-through-camouflage-distraction/) | J05 |
| `bad-likert` | *Bad Likert Judge* : le modèle joue l'évaluateur, puis donne un exemple de chaque niveau | [Unit 42, 31/12/2024](https://unit42.paloaltonetworks.com/multi-turn-technique-jailbreaks-llms/) | J06 |
| `unicode-tags` | Contrebande Unicode : caractères « tag » invisibles, homoglyphes | [Cisco, 12/03/2024](https://blogs.cisco.com/ai/understanding-and-mitigating-unicode-tag-prompt-injection) ; [Promptfoo, ASCII smuggling](https://www.promptfoo.dev/docs/red-team/plugins/ascii-smuggling/) ; [Promptfoo, homoglyphes](https://www.promptfoo.dev/docs/red-team/strategies/homoglyph/)[^unicode] | H08, I04 à I06 |
| `past-tense` | Reformulation au passé | [Andriushchenko, Flammarion (EPFL), arXiv 2407.11969](https://arxiv.org/abs/2407.11969) | I11 |
| `artprompt` | *ArtPrompt* : le mot sensible écrit en art ASCII | [Jiang et al., arXiv 2402.11753, 2024](https://arxiv.org/abs/2402.11753) | I07 |
| `low-resource` | Langues peu dotées | [Yong, Menghini, Bach, arXiv 2310.02446, 2023](https://arxiv.org/abs/2310.02446)[^langues] | I12, I13 |
| `persona-modulation` | Changement de persona ou de rôle | [Shah et al., arXiv 2311.03348, 2023](https://arxiv.org/abs/2311.03348) | B05, B13, B16, F02, F03, F05, F06 |
| `sockpuppeting` | *Sockpuppetting* : une réponse de l'assistant déjà consentante, fabriquée pour que le modèle continue | [Dotsinski, Eustratiadis, arXiv 2601.13359, v1 de janv. 2026](https://arxiv.org/abs/2601.13359v1) ; [Cloud Security Alliance, 13/04/2026](https://labs.cloudsecurityalliance.org/research/csa-research-note-sockpuppeting-llm-api-jailbreak-20260413-c/)[^sock] | B15, K01 à K03, K05 à K09, K12 |
| `communaute-dan` | DAN, mode développeur, grand-mère : invites communautaires | [Shen et al., *Do Anything Now*, arXiv 2308.03825](https://arxiv.org/abs/2308.03825)[^dan] | B02 à B04 |
| `tahoe` | Assistant d'un concessionnaire Chevrolet, déc. 2023 : un Tahoe à 1 $ | [AI Incident Database, incident 622](https://incidentdatabase.ai/cite/622/) ; [rapport 3534](https://incidentdatabase.ai/reports/3534)[^tahoe] | C01 à C03, C10 à C12 |
| `air-canada` | *Moffatt v. Air Canada*, 2024 BCCRT 149 : l'entreprise répond des informations inexactes données par son assistant | [McCarthy Tétrault, 19/02/2024](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot)[^aircanada] | C04 à C09, C13, C14, H07 |
| `dpd` | Assistant de DPD, janv. 2024 : il jure et écrit un poème contre sa propre entreprise | [BBC, 19/01/2024](https://www.bbc.com/news/technology-68025677)[^dpd] | D05, D06, E01, E09, E10 |
| `ia-act-50` | Transparence : la personne doit savoir qu'elle échange avec une IA | [Règlement (UE) 2024/1689, article 50](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)[^ia] | F01 |
| `temoin` | Questions légitimes | Sans objet | T01 à T04 (et vos témoins ajoutés) |

[^llm01]: Sa septième mesure recommande des tests d'intrusion réguliers « en traitant le modèle comme un utilisateur non fiable » : c'est l'objet même de ce banc.
[^llm07]: OWASP y écrit que les instructions système (*system prompt*) « ne doivent pas être considérées comme un secret, ni utilisées comme contrôle de sécurité ».
[^msj]: La technique gagne en efficacité avec le nombre d'exemples. Le banc en joue de courtes versions (d'un à neuf faux échanges), à la mesure d'un assistant de site qui limite l'historique.
[^scripte]: Ces techniques adaptent chaque question à la réponse précédente. Le banc en rejoue l'enchaînement tel qu'il est écrit, sans s'adapter aux réponses de l'assistant ; un attaquant qui improvise peut aller plus loin.
[^puppetry]: A10 et B09 reprennent le squelette de balises du gabarit publié (`interaction-config`, `role`, `blocked-modes`...), avec un contenu propre au banc.
[^unicode]: I05 (espaces de largeur nulle entre chaque lettre) est une variante propre au banc, de la même famille que les caractères invisibles décrits par Cisco.
[^langues]: L'article teste douze langues et range parmi les peu dotées le zoulou, le gaélique écossais, le hmong et le guarani. Le banc applique la technique à l'occitan (I12) et au swahili (I13).
[^sock]: La note de la CSA recommande de rejeter côté serveur les messages attribués à l'assistant qui ne viennent pas de lui. La documentation d'Anthropic indique que les modèles Claude 4.6 et suivants refusent un message de l'assistant prérempli en dernière position ([page des erreurs](https://platform.claude.com/docs/en/api/errors)), mais un service qui accepte des tours attribués à l'assistant **au milieu** de l'historique, fournis par le navigateur, reste exposé : c'est ce que teste la famille `historique` (K01 à K12).
[^dan]: Les deux premières phrases de B02 reprennent l'ouverture, très diffusée, de l'invite communautaire DAN (auteur anonyme, recensée par Shen et al.) ; la suite est propre au banc.
[^tahoe]: **Citation** : C02 reprend les deux phrases de l'invite publiée par Chris Bakke en décembre 2023 et sa demande suivante (le Tahoe remplacé par votre offre), citées par Upworthy (rapport 3534), pour vérifier que l'attaque d'origine ne passe plus. C01, C03 et C10 à C12 en sont des variantes écrites pour le banc.
[^aircanada]: Le site bloque les robots (code 429) ; l'article a été relu par un outil de lecture le 09/10/2026. Le tribunal a retenu une déclaration inexacte faite par négligence (*negligent misrepresentation*) ; les attaques C04 à C09, C13, C14 et H07 testent ce risque voisin : une affirmation ou une promesse de l'assistant engage l'entreprise.
[^dpd]: Rattachement par analogie pour E01, E09 et E10 : l'incident montre un assistant qui produit des propos qu'aucune entreprise ne voudrait signer ; le banc l'étend au dénigrement et aux propos discriminatoires.
[^ia]: EUR-Lex bloque les robots ; le texte de l'article a été relu sur [artificialintelligenceact.eu](https://artificialintelligenceact.eu/article/50/), qui indique une application depuis le 2 août 2026 (article 113). F01 vérifie seulement que l'assistant ne nie pas être une IA quand on le lui demande. L'article 50 demande une information claire au plus tard lors de la première interaction (paragraphe 5) : elle relève de votre interface (bandeau, premier message) et le banc ne la teste pas.

## Documentation du juge

Le juge appelle l'API d'Anthropic. Ces faits ont été relus le 09/10/2026 dans la documentation officielle :

- prix de base par million de tokens : Claude Sonnet 5.5 à 2 $ en entrée et 10 $ en sortie, Claude Haiku 5.5 à 0,10 $ et 0,50 $ (requêtes jusqu'à 100 000 tokens), [page des prix](https://platform.claude.com/docs/en/about-claude/pricing) ;
- codes d'erreur : 400 quand l'organisation atteint un plafond de dépense qu'elle a fixé (message « You have reached your specified API usage limits », [page des limites](https://platform.claude.com/docs/en/api/rate-limits)), 402 `billing_error` pour un problème de facturation, 429 pour une limite de débit ou le plafond mensuel du palier, [page des erreurs](https://platform.claude.com/docs/en/api/errors) ; sur ces erreurs, le banc arrête le juge au lieu d'insister ;
- `thinking: {"type": "between_tools"}` n'est accepté que par Claude Sonnet 5.5 (même page) : le banc ne l'envoie par défaut qu'à ce modèle.
