import type { SchoolSheetType, SchoolSubject } from '../schemas/school';

// =============================================================================
// Revision booklets (« carnets de révision »)
//
// Same idea as schoolPresets.ts, for paper instead of shopping: a booklet is a
// ready-made set of one-page revision sheets a parent imports onto a student in
// one click, then prints. Adding a booklet for another grade / country means
// appending an entry to REVISION_BOOKLETS — no schema change.
//
// Everything imported becomes a NORMAL school_revision_sheets row afterwards:
// editable, deletable, reprintable. The import route skips a sheet whose
// (subject, title) already exists for that student, so re-importing tops the
// booklet up instead of duplicating it.
//
// Design rules every sheet below follows — they are what makes the booklet
// usable rather than just correct:
//   * ONE notion per sheet, one printed page, 15-25 minutes. A child coming
//     back from two months off cannot sustain more, and a half-finished sheet
//     teaches that sheets don't get finished.
//   * A `focus_warmup` before any pencil work. Late August is a concentration
//     problem before it is a knowledge problem, so every sheet opens with a
//     2-3 minute ritual that is deliberately NOT academic.
//   * A playful frame (`title` + `sheet_type`) over a real curriculum notion
//     (`topic`), never instead of one.
//   * Answers live on the sheet's exercises and are printed on a SEPARATE
//     corrigé page, so the sheet handed to the child carries no answers.
// =============================================================================

export interface BookletExercise {
    prompt: string;
    /** Coup de pouce — printed in small type under the question. */
    hint?: string;
    /** Corrigé. Printed on the separate answer page only. */
    answer?: string;
    /** Blank ruled lines to leave for the answer. 0 = none (multiple choice…). */
    answer_lines?: number;
}

export interface BookletSheet {
    subject: SchoolSubject;
    topic: string;
    title: string;
    sheet_type: SchoolSheetType;
    duration_minutes: number;
    focus_warmup: string;
    instructions: string;
    exercises: BookletExercise[];
    source?: string;
    notes?: string;
}

export interface RevisionBooklet {
    id: string;
    label: string;
    description: string;
    grade_level: string;
    /** Shown as a warning banner before/after import. */
    caveat: string;
    sheets: BookletSheet[];
}

// -----------------------------------------------------------------------------
// Québec — 4e année du primaire, retour en classe.
//
// Notions and their naming follow the Alloprof « répertoires de révision » for
// 4e année (français, mathématique) and for the 2e cycle du primaire (science),
// so a child who gets stuck has a page to go read:
//   https://www.alloprof.qc.ca/fr/eleves/bv/francais/repertoire-de-revision-4e-annee-du-primaire-f1591
//   https://www.alloprof.qc.ca/fr/eleves/bv/mathematiques/repertoire-de-revision-en-mathematiques-4e-annee-primaire-m1434
//   https://www.alloprof.qc.ca/fr/eleves/bv/sciences/repertoire-revision-sciences-deuxieme-cycle-primaire-s1620
//
// The booklet is sized for the three weeks before la rentrée: roughly one sheet
// a day, five days a week, never two sheets of the same subject back to back.
// -----------------------------------------------------------------------------

const ALLOPROF_FR =
    'Alloprof — Répertoire de révision, français 4e année : https://www.alloprof.qc.ca/fr/eleves/bv/francais/repertoire-de-revision-4e-annee-du-primaire-f1591';
const ALLOPROF_MATH =
    'Alloprof — Répertoire de révision, mathématique 4e année : https://www.alloprof.qc.ca/fr/eleves/bv/mathematiques/repertoire-de-revision-en-mathematiques-4e-annee-primaire-m1434';
const ALLOPROF_SCI =
    'Alloprof — Répertoire de révision, science 2e cycle du primaire : https://www.alloprof.qc.ca/fr/eleves/bv/sciences/repertoire-revision-sciences-deuxieme-cycle-primaire-s1620';

const QC_4E_RENTREE: RevisionBooklet = {
    id: 'qc-4e-rentree',
    label: 'Rentrée en douceur — 4e année (Québec)',
    description:
        'Carnet de reprise avant la rentrée : 20 fiches d’une page, 15 à 25 minutes chacune, chacune ouverte par un rituel de concentration. Français, mathématique, lecture, science et anglais, sur les notions des répertoires de révision Alloprof de 4e année.',
    grade_level: '4e année',
    caveat: 'Ces fiches sont un entraînement maison, pas le programme officiel : elles reprennent les notions des répertoires Alloprof pour redémarrer, elles ne remplacent ni le cahier d’exercices ni l’enseignant(e). Commencez par une seule fiche par jour — si elle est trop facile ou trop difficile, chaque fiche reste modifiable.',
    sheets: [
        // --- Le rituel, à afficher au mur -----------------------------------
        {
            subject: 'Autre',
            topic: 'Se remettre en mode école',
            title: 'Mon rituel de concentration',
            sheet_type: 'Projet',
            duration_minutes: 15,
            focus_warmup:
                'Assieds-toi bien droite, les deux pieds au sol. Ferme les yeux et respire lentement : on inspire en comptant jusqu’à 4, on garde l’air jusqu’à 4, on souffle jusqu’à 6. Fais-le 4 fois. C’est tout — c’est le signal « le cerveau se met en marche ».',
            instructions:
                'Cette fiche ne se remplit qu’une fois, puis elle s’affiche au mur au-dessus du bureau. Tu la relis avant CHAQUE fiche des autres jours. Réponds au crayon : tu auras le droit de changer d’avis en cours d’année.',
            exercises: [
                {
                    prompt: 'Où est mon coin de travail ? Décris-le en une phrase (la table, la chaise, la lumière).',
                    hint: 'Le meilleur coin est celui où il n’y a RIEN d’autre sur la table que la fiche du jour.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Les 3 choses que j’enlève de la table avant de commencer :',
                    hint: 'Écran, jouets, collation… tout ce qui fait « et si je regardais juste une seconde ».',
                    answer_lines: 3,
                },
                {
                    prompt: 'Mon signal de départ : je respire 4 fois, puis je dis à voix haute la phrase…',
                    hint: 'Par exemple : « 20 minutes, une seule fiche, et après je suis libre. »',
                    answer_lines: 2,
                },
                {
                    prompt: 'Quand un mot me bloque, je fais quoi AVANT de demander de l’aide ? Écris tes 2 réflexes.',
                    hint: 'Relire la consigne à voix haute · souligner ce que je comprends · faire un dessin · passer à la question suivante et revenir.',
                    answer_lines: 3,
                },
                {
                    prompt: 'Ma récompense quand la fiche est finie (et seulement quand elle est finie) :',
                    answer_lines: 2,
                },
            ],
            notes: 'À imprimer en premier et à afficher au-dessus du bureau. Les autres fiches y renvoient.',
        },

        // --- Français --------------------------------------------------------
        {
            subject: 'Français',
            topic: 'Les homophones a et à',
            title: 'La chasse aux jumeaux : a ou à ?',
            sheet_type: 'Jeu',
            duration_minutes: 15,
            focus_warmup:
                'Debout, secoue les mains 10 secondes. Puis dis 5 fois à voix haute, de plus en plus vite : « a, c’est avait — à, c’est pas avait ». C’est le truc de toute la fiche : si on peut remplacer par « avait », on écrit **a** (le verbe avoir). Sinon, on écrit **à** (avec l’accent).',
            instructions:
                'Complète avec « a » ou « à ». Pour chaque phrase, essaie d’abord de remplacer par « avait » dans ta tête. Souligne les cas où ça marche.',
            exercises: [
                {
                    prompt: 'Adja ___ oublié sa boîte à lunch ___ la maison.',
                    hint: '« Adja avait oublié » → ça marche pour le premier.',
                    answer: 'Adja **a** oublié sa boîte à lunch **à** la maison.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Le premier cours commence ___ 8 h 23 : il ___ intérêt ___ se lever tôt !',
                    answer: 'commence **à** 8 h 23 : il **a** intérêt **à** se lever tôt.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Elle ___ un crayon ___ mine et une gomme ___ effacer.',
                    answer: 'Elle **a** un crayon **à** mine et une gomme **à** effacer.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Mon frère n’___ rien ___ dire ___ ce sujet.',
                    answer: 'n’**a** rien **à** dire **à** ce sujet.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Invente TOI-MÊME une phrase qui contient un « a » et deux « à ».',
                    hint: 'Relis-la ensuite en remplaçant par « avait » pour vérifier.',
                    answer: 'Réponse libre. Vérification : un seul mot doit accepter « avait ».',
                    answer_lines: 2,
                },
            ],
            source: ALLOPROF_FR,
        },
        {
            subject: 'Français',
            topic: 'Les homophones son/sont et ont/on',
            title: 'Le détective des homophones',
            sheet_type: 'Énigme',
            duration_minutes: 20,
            focus_warmup:
                'Regarde autour de toi et nomme dans ta tête 5 choses que tu vois, 4 que tu entends, 3 que tu peux toucher. Ça prend une minute et ça range le cerveau. Ensuite, écris les 4 trucs en haut de ta feuille : son → mon · sont → étaient · ont → avaient · on → il.',
            instructions:
                'Tu es détective : pour chaque mot manquant, écris D’ABORD le mot de remplacement au-dessus (mon, étaient, avaient, il), PUIS le bon homophone.',
            exercises: [
                {
                    prompt: 'Les crayons ___ déjà rangés dans ___ étui.',
                    hint: '« étaient rangés » ? « mon étui » ?',
                    answer: 'Les crayons **sont** déjà rangés dans **son** étui.',
                    answer_lines: 1,
                },
                {
                    prompt: '___ dirait que les crayons ___ déjà taillés.',
                    answer: '**On** dirait que les crayons **sont** déjà taillés. (« Il dirait » / « étaient taillés »)',
                    answer_lines: 1,
                },
                {
                    prompt: 'Mes amies ___ toutes apporté leur dîner ; ___ mange dehors.',
                    answer: 'Mes amies **ont** toutes apporté leur dîner ; **on** mange dehors. (« avaient apporté » / « il mange »)',
                    answer_lines: 1,
                },
                {
                    prompt: '___ sac est lourd parce qu’ils ___ mis tous les cahiers dedans.',
                    answer: '**Son** sac est lourd parce qu’ils **ont** mis tous les cahiers dedans.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Les réponses ___ au tableau : ___ les recopie et ___ vérifie ___ travail.',
                    answer: 'Les réponses **sont** au tableau : **on** les recopie et **on** vérifie **son** travail.',
                    answer_lines: 1,
                },
            ],
            source: ALLOPROF_FR,
        },
        {
            subject: 'Français',
            topic: 'Les accords dans le groupe du nom',
            title: 'L’usine à accords',
            sheet_type: 'Exercice',
            duration_minutes: 20,
            focus_warmup:
                'Prends ton crayon et trace, sans lever la main, 5 grandes boucles sur une feuille brouillon. Lentement. Ça réveille la main avant d’écrire. Puis rappelle-toi la règle : dans le groupe du nom, c’est le NOM qui donne son genre et son nombre au déterminant et à l’adjectif. Le nom est le patron.',
            instructions:
                'Dans chaque groupe du nom : encercle le nom (le patron), puis relie-le par une flèche au déterminant et à l’adjectif, et accorde-les.',
            exercises: [
                {
                    prompt: 'Accorde : « des (grand) ___ fenêtre**s** (ouvert) ___ »',
                    hint: 'fenêtres = féminin pluriel → l’adjectif prend -es.',
                    answer: 'des **grandes** fenêtres **ouvertes**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Accorde : « un (nouveau) ___ cartable (bleu) ___ »',
                    answer: 'un **nouveau** cartable **bleu** (masculin singulier : rien à ajouter)',
                    answer_lines: 1,
                },
                {
                    prompt: 'Accorde : « (ce) ___ (joli) ___ crayons (neuf) ___ »',
                    answer: '**ces** **jolis** crayons **neufs**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Corrige la phrase : « Les petit élève range ses cahier vert. »',
                    hint: 'Il y a 4 erreurs. Cherche d’abord tous les noms.',
                    answer: '« Les **petits** **élèves** **rangent** leurs **cahiers** **verts**. » (petit → petits, élève → élèves, range → rangent, cahier → cahiers, vert → verts)',
                    answer_lines: 2,
                },
                {
                    prompt: 'Écris un groupe du nom au féminin pluriel avec 1 déterminant, 1 nom et 2 adjectifs.',
                    answer: 'Réponse libre. Ex. : « ces belles journées ensoleillées ». Vérifier que TOUT est au féminin pluriel.',
                    answer_lines: 2,
                },
            ],
            source: ALLOPROF_FR,
        },
        {
            subject: 'Français',
            topic: 'L’indicatif présent et l’indicatif imparfait',
            title: 'La machine à voyager dans le temps',
            sheet_type: 'Défi',
            duration_minutes: 20,
            focus_warmup:
                'Minuterie : 60 secondes, tu ne fais RIEN d’autre que regarder l’aiguille (ou le chrono du four). C’est long, et c’est exactement le but : ton cerveau apprend à rester sur une seule chose. Ensuite seulement, tu prends ton crayon.',
            instructions:
                'Même verbe, deux époques. Écris la forme au présent (aujourd’hui) puis à l’imparfait (l’an dernier). Les terminaisons de l’imparfait sont toujours : -ais, -ais, -ait, -ions, -iez, -aient.',
            exercises: [
                {
                    prompt: 'AVOIR — je ___ (présent) / je ___ (imparfait)',
                    answer: "j'**ai** / j'**avais**",
                    answer_lines: 1,
                },
                {
                    prompt: 'ÊTRE — nous ___ (présent) / nous ___ (imparfait)',
                    answer: 'nous **sommes** / nous **étions**',
                    answer_lines: 1,
                },
                {
                    prompt: 'ALLER — elles ___ (présent) / elles ___ (imparfait)',
                    answer: 'elles **vont** / elles **allaient**',
                    answer_lines: 1,
                },
                {
                    prompt: 'FAIRE — tu ___ (présent) / tu ___ (imparfait)',
                    answer: 'tu **fais** / tu **faisais**',
                    answer_lines: 1,
                },
                {
                    prompt: 'FINIR — on ___ (présent) / on ___ (imparfait)',
                    hint: 'Verbe en -ir : au présent, 3e personne du singulier → -it.',
                    answer: 'on **finit** / on **finissait**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Réécris à l’imparfait : « Je pars à 7 h 30, je prends l’autobus et j’arrive à l’école avant la cloche. »',
                    answer: '« Je **partais** à 7 h 30, je **prenais** l’autobus et j’**arrivais** à l’école avant la cloche. »',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_FR,
        },
        {
            subject: 'Français',
            topic: 'Les préfixes, les suffixes et les familles de mots',
            title: 'Le laboratoire des mots',
            sheet_type: 'Jeu',
            duration_minutes: 20,
            focus_warmup:
                'Jeu d’échauffement, 2 minutes chrono : trouve le plus de mots possible qui commencent par « re- ». À voix haute, sans écrire. C’est déjà la leçon du jour : « re- » veut dire « encore une fois ».',
            instructions:
                'Un mot est une construction : préfixe + radical + suffixe. Démonte, puis remonte.',
            exercises: [
                {
                    prompt: 'Sépare : REFAIRE = ___ + ___ . Que veut dire le préfixe ?',
                    answer: 're- + faire. « re- » = à nouveau, une deuxième fois.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Ajoute le préfixe qui veut dire « le contraire » : ___possible, ___content, ___faire son sac.',
                    answer: '**im**possible, **mé**content, **dé**faire son sac.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Trouve 4 mots de la famille de DENT.',
                    hint: 'Regarde ce qui reste pareil dans tous les mots : d-e-n-t.',
                    answer: 'dentiste, dentifrice, dentaire, denture, édenté… (4 suffisent)',
                    answer_lines: 2,
                },
                {
                    prompt: 'Le suffixe « -eur / -euse » sert à nommer quelqu’un qui fait l’action. Complète : celui qui nage est un ___ , celle qui chante est une ___ .',
                    answer: 'un **nageur** ; une **chanteuse**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Écris le champ lexical de l’ÉCOLE : 8 mots.',
                    answer: 'Réponse libre. Ex. : pupitre, cloche, récréation, enseignante, cahier, cour, autobus, casier.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_FR,
        },
        {
            subject: 'Français',
            topic: 'Les types de phrases et la ponctuation',
            title: 'Le bar à ponctuation',
            sheet_type: 'Exercice',
            duration_minutes: 15,
            focus_warmup:
                'Lis à voix haute, deux fois, la phrase suivante — d’abord comme une question, puis comme un ordre : « Tu ranges ton sac ». Entends-tu que ta voix change ? C’est ça, un type de phrase. La ponctuation, c’est juste la voix écrite.',
            instructions:
                'Pour chaque phrase : écris son type (déclaratif, interrogatif, impératif ou exclamatif) et ajoute la bonne ponctuation finale.',
            exercises: [
                {
                    prompt: 'Range ton pupitre avant de partir ___  → type : ___',
                    answer: 'Range ton pupitre avant de partir **.** (ou !) → **impératif** (elle donne un ordre)',
                    answer_lines: 1,
                },
                {
                    prompt: 'Est-ce que la récréation est déjà finie ___  → type : ___',
                    answer: '… finie **?** → **interrogatif**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Quelle belle rentrée ___  → type : ___',
                    answer: 'Quelle belle rentrée **!** → **exclamatif**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Mets les virgules : « Dans mon sac il y a des crayons une gomme une règle et des ciseaux. »',
                    hint: 'La virgule sépare les éléments d’une énumération — mais pas avant le « et » final.',
                    answer: '« Dans mon sac, il y a des crayons, une gomme, une règle et des ciseaux. »',
                    answer_lines: 2,
                },
                {
                    prompt: 'Transforme en phrase négative : « Elle a fini ses devoirs. »',
                    answer: '« Elle **n**’a **pas** fini ses devoirs. » (les deux mots de négation sont obligatoires à l’écrit)',
                    answer_lines: 1,
                },
            ],
            source: ALLOPROF_FR,
        },

        // --- Mathématique -----------------------------------------------------
        {
            subject: 'Mathématique',
            topic: 'Les nombres naturels inférieurs à 100 000',
            title: 'Le coffre-fort à 5 chiffres',
            sheet_type: 'Énigme',
            duration_minutes: 20,
            focus_warmup:
                'Compte à rebours à voix haute de 100 à 0, de 5 en 5, le plus vite possible sans te tromper. Si tu te trompes, tu recommences. Deux essais maximum — ça suffit pour brancher le cerveau sur les nombres.',
            instructions:
                'Chaque bonne réponse te donne un chiffre du code du coffre. Écris tes réponses proprement, en séparant les milliers par une espace (ex. : 42 300).',
            exercises: [
                {
                    prompt: 'Écris en chiffres : soixante-douze mille quatre cent six.',
                    answer: '72 406',
                    answer_lines: 1,
                },
                {
                    prompt: 'Dans 48 375, quel chiffre est à la position des centaines ? Et celui des dizaines de mille ?',
                    hint: 'Compte les positions en partant de la DROITE : unités, dizaines, centaines…',
                    answer: 'Centaines : **3**. Dizaines de mille : **4**.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Décompose 60 508 selon la valeur de position.',
                    answer: '60 000 + 500 + 8 (il n’y a ni millier isolé, ni dizaine)',
                    answer_lines: 1,
                },
                {
                    prompt: 'Range du plus petit au plus grand : 9 087 ; 90 780 ; 9 807 ; 90 087',
                    hint: 'Compare d’abord le NOMBRE de chiffres.',
                    answer: '9 087 < 9 807 < 90 087 < 90 780',
                    answer_lines: 1,
                },
                {
                    prompt: 'Quel nombre vient juste avant 40 000 ? Et juste après 89 999 ?',
                    answer: '**39 999** et **90 000**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Je suis un nombre pair, plus grand que 5 400 et plus petit que 5 410, et la somme de mes chiffres est 11. Qui suis-je ?',
                    hint: 'Écris les nombres pairs de 5 402 à 5 408 et additionne les chiffres de chacun.',
                    answer: '**5 402** (5 + 4 + 0 + 2 = 11). Les autres : 5 404 → 13 ; 5 406 → 15 ; 5 408 → 17.',
                    answer_lines: 2,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Les opérations sur les nombres',
            title: 'Le défi chrono des opérations',
            sheet_type: 'Défi',
            duration_minutes: 20,
            focus_warmup:
                'Avant de commencer : 20 sauts sur place, puis assieds-toi et respire 4 fois lentement. Le corps bouge d’abord, la tête travaille ensuite. Puis règle une minuterie sur 10 minutes pour les 4 premiers calculs.',
            instructions:
                'Pose chaque opération en colonnes sur la feuille, avec les retenues. Le but n’est pas la vitesse : c’est d’écrire les retenues au bon endroit.',
            exercises: [
                { prompt: '3 456 + 2 789 = ___', answer: '**6 245**', answer_lines: 2 },
                {
                    prompt: '8 004 − 3 617 = ___',
                    hint: 'Attention aux zéros : il faut emprunter deux fois.',
                    answer: '**4 387**',
                    answer_lines: 2,
                },
                { prompt: '47 × 6 = ___', answer: '**282**', answer_lines: 2 },
                {
                    prompt: '138 ÷ 6 = ___',
                    hint: 'Combien de fois 6 entre-t-il dans 13 ? Puis dans le reste ?',
                    answer: '**23**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Problème : une boîte contient 24 crayons. L’école commande 15 boîtes. Combien de crayons au total ?',
                    hint: 'Écris l’opération AVANT de calculer.',
                    answer: '24 × 15 = **360 crayons**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Problème : il y a 152 élèves. On les place en équipes de 4. Combien d’équipes ? Reste-t-il des élèves ?',
                    answer: '152 ÷ 4 = **38 équipes**, reste **0** élève.',
                    answer_lines: 2,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Les fractions',
            title: 'La pizzeria des fractions',
            sheet_type: 'Jeu',
            duration_minutes: 20,
            focus_warmup:
                'Prends une feuille brouillon et plie-la en deux, puis encore en deux, puis encore en deux. Déplie : combien de parts ? Huit. Tu viens de fabriquer des huitièmes avec tes mains — garde cette feuille à côté de toi pendant la fiche.',
            instructions:
                'Rappel : le nombre du BAS (dénominateur) dit en combien de parts égales on a coupé ; le nombre du HAUT (numérateur) dit combien de parts on prend. Fais un dessin pour chaque question, même quand ça semble facile.',
            exercises: [
                {
                    prompt: 'Dessine un rectangle de 8 cases et colorie 3/4 des cases. Combien de cases as-tu coloriées ?',
                    hint: '8 cases pour 4 parts égales → chaque part fait 2 cases.',
                    answer: '**6 cases** (3 parts de 2 cases)',
                    answer_lines: 2,
                },
                {
                    prompt: 'Calcule les 3/4 de 20.',
                    hint: 'D’abord 20 ÷ 4, ensuite × 3.',
                    answer: '20 ÷ 4 = 5, puis 5 × 3 = **15**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Quelle fraction est la plus grande : 2/5 ou 3/5 ? Pourquoi ?',
                    answer: '**3/5**, parce que les parts sont de la même taille (cinquièmes) et qu’on en prend plus.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Complète : 1/2 = ___/8 et 1/2 = ___/6',
                    answer: '**4**/8 et **3**/6',
                    answer_lines: 1,
                },
                {
                    prompt: 'Une pizza est coupée en 6 parts égales. Tu en manges 2. Quelle fraction de la pizza reste-t-il ?',
                    answer: '**4/6** de la pizza (soit **2/3**)',
                    answer_lines: 1,
                },
                {
                    prompt: 'Range dans l’ordre croissant : 1/2 ; 1/4 ; 3/4 ; 1',
                    hint: 'Plus le dénominateur est grand, plus les parts sont PETITES.',
                    answer: '1/4 < 1/2 < 3/4 < 1',
                    answer_lines: 1,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Les nombres décimaux',
            title: 'Le marché des décimaux',
            sheet_type: 'Exercice',
            duration_minutes: 20,
            focus_warmup:
                'Va chercher de la vraie monnaie (ou les pièces d’un jeu). Étale 2,45 $ sur la table avec le moins de pièces possible. Les décimaux, c’est de l’argent : 0,1 = 10 ¢ (un dixième), 0,01 = 1 ¢ (un centième).',
            instructions:
                'Écris toujours la virgule bien alignée quand tu poses tes opérations en colonnes. Une virgule mal placée, et le prix est faux.',
            exercises: [
                {
                    prompt: 'Écris en nombre décimal : trois dixièmes ; sept centièmes ; deux unités et cinq dixièmes.',
                    answer: '**0,3** ; **0,07** ; **2,5**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Quelle est la valeur du chiffre 5 dans 12,45 ?',
                    answer: '5 **centièmes**, c’est-à-dire 0,05',
                    answer_lines: 1,
                },
                {
                    prompt: '2,50 $ + 1,75 $ = ___',
                    answer: '**4,25 $**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Tu paies un article de 6,45 $ avec un billet de 10 $. Combien te rend-on ?',
                    answer: '10,00 − 6,45 = **3,55 $**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Range du plus petit au plus grand : 0,7 ; 0,07 ; 0,77 ; 7',
                    hint: 'Piège classique : 0,07 est plus petit que 0,7.',
                    answer: '0,07 < 0,7 < 0,77 < 7',
                    answer_lines: 1,
                },
                {
                    prompt: 'Écris 1/2 et 3/4 en nombres décimaux.',
                    answer: '1/2 = **0,5** ; 3/4 = **0,75**',
                    answer_lines: 1,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Le périmètre et l’aire',
            title: 'L’architecte du potager',
            sheet_type: 'Projet',
            duration_minutes: 25,
            focus_warmup:
                'Prends ta règle de 30 cm et mesure 3 objets autour de toi avant de commencer (un cahier, ta main, la table). Note les mesures sur ta feuille. Ça met les yeux et la main d’accord — et ça évite les réponses en « cm » quand on parlait de mètres.',
            instructions:
                'Rappel : le PÉRIMÈTRE, c’est le tour (on l’exprime en cm, m…) ; l’AIRE, c’est la surface à l’intérieur (en cm², m²). Fais un schéma pour chaque question et écris les unités — une réponse sans unité est une réponse fausse.',
            exercises: [
                {
                    prompt: 'Un rectangle mesure 7 cm sur 4 cm. Calcule son périmètre.',
                    hint: '7 + 4 + 7 + 4, ou (7 + 4) × 2.',
                    answer: '**22 cm**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Le même rectangle : calcule son aire.',
                    answer: '7 × 4 = **28 cm²**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Un carré a un côté de 6 cm. Périmètre ? Aire ?',
                    answer: 'Périmètre : 6 × 4 = **24 cm**. Aire : 6 × 6 = **36 cm²**.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Le potager de la famille est un rectangle de 9 m sur 5 m. Combien de mètres de clôture faut-il pour en faire le tour ?',
                    answer: '(9 + 5) × 2 = **28 m** de clôture',
                    answer_lines: 2,
                },
                {
                    prompt: 'Ce même potager : quelle surface faut-il retourner à la pelle ?',
                    answer: '9 × 5 = **45 m²**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Défi : dessine DEUX rectangles différents qui ont le même périmètre de 12 cm. Ont-ils la même aire ?',
                    hint: 'Essaie 5 cm × 1 cm, puis 4 cm × 2 cm, puis 3 cm × 3 cm.',
                    answer: 'Ex. : 5 × 1 (aire 5 cm²), 4 × 2 (aire 8 cm²), 3 × 3 (aire 9 cm²). **Non** : même périmètre ne veut pas dire même aire. C’est LA découverte de la fiche.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Le temps',
            title: 'L’horloge de la rentrée',
            sheet_type: 'Défi',
            duration_minutes: 15,
            focus_warmup:
                'Devine, sans regarder : combien de temps s’est-il écoulé depuis que tu t’es assise ? Note ton estimation, puis vérifie sur une horloge. Personne ne tombe juste — et c’est pour ça qu’on apprend à calculer le temps au lieu de le deviner.',
            instructions:
                'Utilise une ligne du temps dessinée sur ta feuille pour les calculs de durée : c’est plus sûr qu’une soustraction posée, parce qu’une heure vaut 60 minutes et non 100.',
            exercises: [
                {
                    prompt: 'Il est 14 h 35. Quelle heure sera-t-il dans 50 minutes ?',
                    hint: 'Saute d’abord jusqu’à 15 h 00 (25 min), puis ajoute ce qu’il reste.',
                    answer: '**15 h 25**',
                    answer_lines: 1,
                },
                {
                    prompt: 'L’école commence à 8 h 23 et se termine à 14 h 25. Combien de temps dure la journée ?',
                    answer: 'De 8 h 23 à 14 h 23 = 6 h, puis 2 min → **6 h 2 min**',
                    answer_lines: 2,
                },
                {
                    prompt: 'Combien de minutes dans 3 heures et quart ?',
                    answer: '(3 × 60) + 15 = **195 minutes**',
                    answer_lines: 1,
                },
                {
                    prompt: 'La récréation dure 15 minutes et commence à 10 h 05. À quelle heure finit-elle ?',
                    answer: '**10 h 20**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Combien de jours y a-t-il en septembre ? Et combien de semaines complètes ?',
                    answer: '**30 jours**, soit **4 semaines complètes** et 2 jours.',
                    answer_lines: 1,
                },
            ],
            source: ALLOPROF_MATH,
        },
        {
            subject: 'Mathématique',
            topic: 'Les solides et les figures planes',
            title: 'La chasse aux solides',
            sheet_type: 'Jeu',
            duration_minutes: 20,
            focus_warmup:
                'Fais le tour de la cuisine et rapporte 3 objets : un qui roule, un qui glisse, un qui fait les deux. Pose-les devant toi. Tu viens de trier des solides selon leurs faces — c’est le sujet de la fiche.',
            instructions:
                'Pour chaque question, tu peux prendre un objet réel dans tes mains et compter dessus. C’est permis, et c’est même la meilleure méthode.',
            exercises: [
                {
                    prompt: 'Un cube : combien de faces ? d’arêtes ? de sommets ?',
                    hint: 'Prends un dé et compte vraiment.',
                    answer: '**6 faces**, **12 arêtes**, **8 sommets**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Nomme deux solides qui roulent et explique pourquoi.',
                    answer: 'La **sphère**, le **cylindre**, le **cône** : ils ont au moins une surface courbe.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Quel quadrilatère a 4 côtés égaux ET 4 angles droits ?',
                    answer: 'Le **carré**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Combien de côtés a un pentagone ? un hexagone ? un octogone ?',
                    hint: 'penta = 5, hexa = 6, octo = 8 (comme la pieuvre… octopus !)',
                    answer: '**5**, **6**, **8**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Trace un axe de symétrie sur un rectangle. Combien y en a-t-il en tout ?',
                    answer: '**2** (un vertical, un horizontal). Les diagonales ne sont PAS des axes de symétrie du rectangle.',
                    answer_lines: 2,
                },
            ],
            source: ALLOPROF_MATH,
        },

        // --- Lecture ---------------------------------------------------------
        {
            subject: 'Lecture',
            topic: 'La compréhension de lecture',
            title: 'Enquête : qui a vidé la boîte à lunch ?',
            sheet_type: 'Énigme',
            duration_minutes: 25,
            focus_warmup:
                'Avant de lire : pose ton doigt sous la première ligne et lis les 3 premières phrases À VOIX HAUTE. Après deux mois de vacances, la lecture silencieuse va trop vite et le cerveau saute des mots. La voix, elle, ne triche pas.',
            instructions:
                'Lis le texte DEUX fois : la première pour comprendre l’histoire, la deuxième avec un crayon pour souligner les indices. Écris ensuite tes réponses en faisant des PHRASES COMPLÈTES.',
            exercises: [
                {
                    prompt: 'Texte à lire (à recopier ou coller ici avant d’imprimer) — ou choisis les 2 premières pages d’un roman de la bibliothèque. Écris le titre et l’auteur :',
                    hint: 'Cette fiche marche avec n’importe quel texte : un roman, un article, une recette.',
                    answer: 'Réponse libre.',
                    answer_lines: 2,
                },
                {
                    prompt: 'QUI ? Nomme les personnages et dis en un mot comment est chacun.',
                    answer: 'Dépend du texte. Vérifier que chaque personnage cité apparaît vraiment dans le texte.',
                    answer_lines: 3,
                },
                {
                    prompt: 'OÙ et QUAND l’histoire se passe-t-elle ? Recopie la phrase du texte qui te l’apprend.',
                    hint: 'Une bonne réponse s’appuie toujours sur une phrase du texte, jamais sur une devinette.',
                    answer: 'Doit citer une phrase précise du texte.',
                    answer_lines: 3,
                },
                {
                    prompt: 'QUEL est le problème du personnage principal ?',
                    answer: 'Dépend du texte.',
                    answer_lines: 3,
                },
                {
                    prompt: 'Trouve 3 mots que tu ne connaissais pas. Devine leur sens grâce à la phrase, PUIS vérifie dans le dictionnaire.',
                    answer: 'Réponse libre. L’important est l’ordre : deviner d’abord, vérifier ensuite.',
                    answer_lines: 4,
                },
                {
                    prompt: 'À ton avis, que va-t-il se passer ensuite ? Justifie avec un indice du texte.',
                    answer: 'Réponse libre, mais elle DOIT contenir un « parce que… » qui renvoie au texte.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_FR,
            notes: 'Fiche réutilisable : elle fonctionne avec n’importe quel livre. À imprimer en plusieurs exemplaires.',
        },
        {
            subject: 'Lecture',
            topic: 'Le plaisir de lire',
            title: 'Mon carnet de lecture — 15 minutes par jour',
            sheet_type: 'Projet',
            duration_minutes: 15,
            focus_warmup:
                'Aucun échauffement : ici, on ouvre le livre et on lit. La seule règle est la minuterie — 15 minutes, pas une de plus. On arrête même si c’est passionnant : c’est ce qui donne envie de revenir demain.',
            instructions:
                'Une ligne par jour, pendant les deux semaines avant la rentrée. Le but n’est pas de finir le livre, c’est de retrouver l’habitude de s’asseoir 15 minutes.',
            exercises: [
                {
                    prompt: 'Le livre que je lis cette semaine (titre et auteur) :',
                    answer_lines: 2,
                },
                {
                    prompt: 'Jour 1 — pages lues : ___  Le mot le plus beau de ma lecture :',
                    answer_lines: 2,
                },
                {
                    prompt: 'Jour 2 — pages lues : ___  Ce que je n’ai pas compris :',
                    answer_lines: 2,
                },
                {
                    prompt: 'Jour 3 — pages lues : ___  Le personnage que je préfère et pourquoi :',
                    answer_lines: 2,
                },
                {
                    prompt: 'Jour 4 — pages lues : ___  Si j’étais le personnage, je ferais :',
                    answer_lines: 2,
                },
                {
                    prompt: 'Jour 5 — pages lues : ___  Je recommande ce livre à ___ parce que :',
                    answer_lines: 3,
                },
            ],
            notes: 'À imprimer en 2 ou 3 exemplaires (un par semaine).',
        },

        // --- Science ---------------------------------------------------------
        {
            subject: 'Science',
            topic: 'Les propriétés de la matière et les changements physiques',
            title: 'Le labo de la cuisine',
            sheet_type: 'Projet',
            duration_minutes: 25,
            focus_warmup:
                'Va poser un glaçon dans une assiette, sur le comptoir. Ne le regarde pas. Reviens t’asseoir et commence la fiche : tu iras l’observer à la question 4. Un scientifique attend — c’est la première compétence du métier.',
            instructions:
                'Cette fiche se fait DANS la cuisine, avec un adulte pour tout ce qui chauffe. Écris ce que tu OBSERVES, pas ce que tu crois savoir.',
            exercises: [
                {
                    prompt: 'Nomme les 3 états de la matière et donne un exemple de chacun trouvé dans ta cuisine.',
                    answer: '**Solide** (glaçon, sucre), **liquide** (eau, lait), **gazeux** (vapeur, air dans le sac de croustilles).',
                    answer_lines: 2,
                },
                {
                    prompt: 'Décris 3 propriétés d’un objet de ton choix : sa couleur, sa texture, et s’il flotte ou coule.',
                    hint: 'Teste vraiment le flottement dans un bol d’eau.',
                    answer: 'Réponse libre — vérifier que le test de flottement a bien été fait.',
                    answer_lines: 3,
                },
                {
                    prompt: 'Mélange une cuillère de sucre dans un verre d’eau. Le sucre a-t-il disparu ? Comment le prouver ?',
                    answer: 'Non, il s’est **dissous**. Preuve : l’eau a un goût sucré ; si on laisse l’eau s’évaporer, le sucre réapparaît. C’est un **changement physique** (réversible).',
                    answer_lines: 3,
                },
                {
                    prompt: 'Retourne voir ton glaçon. Qu’est-il devenu ? Comment s’appelle ce changement ? Est-il réversible ?',
                    answer: 'Il a **fondu** : solide → liquide, c’est la **fusion**. **Oui**, c’est réversible : au congélateur, l’eau redevient glace (**solidification**).',
                    answer_lines: 3,
                },
                {
                    prompt: 'Quand l’eau bout dans une casserole, de la « fumée » blanche s’échappe. Qu’est-ce que c’est vraiment ?',
                    hint: 'Piège : ce n’est pas de la fumée.',
                    answer: 'C’est de la **vapeur d’eau qui se recondense** en minuscules gouttelettes au contact de l’air plus froid. La vapeur elle-même est invisible.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_SCI,
        },
        {
            subject: 'Science',
            topic: 'Le cycle de l’eau',
            title: 'Le voyage d’une goutte',
            sheet_type: 'Exercice',
            duration_minutes: 20,
            focus_warmup:
                'Regarde par la fenêtre pendant une minute complète et décris le ciel à voix haute : y a-t-il des nuages ? de quelle couleur ? bougent-ils ? Observer, c’est déjà faire de la science.',
            instructions:
                'Dessine le cycle de l’eau au dos de la feuille avec le soleil, la mer, les nuages, la montagne et la rivière. Ajoute une flèche et un nom pour chaque étape, puis réponds aux questions.',
            exercises: [
                {
                    prompt: 'Nomme les 4 grandes étapes du cycle de l’eau, dans l’ordre.',
                    answer: '**Évaporation** → **condensation** → **précipitations** → **ruissellement** (et infiltration dans le sol).',
                    answer_lines: 2,
                },
                {
                    prompt: 'Quelle est la source d’énergie qui fait fonctionner tout le cycle ?',
                    answer: 'Le **Soleil** : c’est sa chaleur qui fait évaporer l’eau.',
                    answer_lines: 1,
                },
                {
                    prompt: 'Comment un nuage se forme-t-il ?',
                    answer: 'La vapeur d’eau monte, rencontre de l’air froid en altitude et se **condense** en gouttelettes minuscules : c’est le nuage.',
                    answer_lines: 3,
                },
                {
                    prompt: 'Cite 3 formes de précipitations.',
                    answer: 'La **pluie**, la **neige**, la **grêle** (accepter aussi : le grésil, le verglas).',
                    answer_lines: 1,
                },
                {
                    prompt: 'L’eau de la Terre s’épuise-t-elle ? Explique.',
                    answer: '**Non** : c’est un cycle, la même eau circule sans fin. Ce qui peut manquer, c’est de l’eau **propre et accessible** au bon endroit.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_SCI,
        },
        {
            subject: 'Science',
            topic: 'Le système Soleil-Terre-Lune',
            title: 'Le carrousel du ciel',
            sheet_type: 'Jeu',
            duration_minutes: 20,
            focus_warmup:
                'Debout au milieu de la pièce. Tu es la Terre : tourne lentement sur toi-même une fois — voilà une journée. Maintenant marche en cercle autour d’une chaise (le Soleil) — voilà une année. Refais-le une fois en disant les mots à voix haute.',
            instructions:
                'Réponds sans chercher sur Internet d’abord ; tu vérifieras ensuite. Se tromper puis corriger fait mieux retenir que copier la bonne réponse.',
            exercises: [
                {
                    prompt: 'Qu’est-ce qui cause l’alternance du jour et de la nuit ?',
                    answer: 'La **rotation de la Terre sur elle-même**, en environ **24 heures**. Le côté éclairé par le Soleil a le jour, l’autre la nuit.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Combien de temps la Terre met-elle à faire le tour du Soleil ? Qu’est-ce que cela cause ?',
                    answer: 'Environ **365 jours** (une année). Combinée à l’inclinaison de la Terre, cette révolution cause les **saisons**.',
                    answer_lines: 2,
                },
                {
                    prompt: 'La Lune tourne autour de quoi ? En combien de temps environ ?',
                    answer: 'Autour de la **Terre**, en environ **29 jours et demi** (un mois lunaire).',
                    answer_lines: 1,
                },
                {
                    prompt: 'Pourquoi voit-on la Lune briller alors qu’elle ne produit pas de lumière ?',
                    answer: 'Elle **réfléchit** la lumière du Soleil, comme un miroir.',
                    answer_lines: 2,
                },
                {
                    prompt: 'Observe la Lune ce soir et dessine sa forme. Recommence dans une semaine : qu’a-t-il changé ?',
                    hint: 'Ça s’appelle les phases de la Lune.',
                    answer: 'La portion éclairée aura changé (croissant, quartier, gibbeuse, pleine lune…). C’est le cycle des **phases**.',
                    answer_lines: 3,
                },
            ],
            source: ALLOPROF_SCI,
        },

        // --- Anglais ---------------------------------------------------------
        {
            subject: 'Anglais',
            topic: 'Back to school vocabulary',
            title: 'What’s in my school bag?',
            sheet_type: 'Quiz',
            duration_minutes: 15,
            focus_warmup:
                'Vide ton sac d’école sur la table. Prends chaque objet dans ta main et dis son nom en anglais si tu le connais, sinon dis « I don’t know this one ». Ne triche pas en regardant la fiche : c’est le test de départ.',
            instructions:
                'Traduis, puis relis chaque mot à voix haute deux fois. Un mot d’anglais qu’on n’a jamais prononcé ne rentre pas dans la tête.',
            exercises: [
                {
                    prompt: 'un crayon = ___ · une gomme à effacer = ___ · une règle = ___',
                    answer: 'a **pencil** · an **eraser** · a **ruler**',
                    answer_lines: 1,
                },
                {
                    prompt: 'des ciseaux = ___ · de la colle = ___ · un cahier = ___',
                    answer: '**scissors** · **glue** · a **notebook**',
                    answer_lines: 1,
                },
                {
                    prompt: 'un sac à dos = ___ · un pupitre = ___ · un enseignant = ___',
                    answer: 'a **backpack** · a **desk** · a **teacher**',
                    answer_lines: 1,
                },
                {
                    prompt: 'Complète : « I ___ nine years old. » (I am / I have)',
                    hint: 'En anglais, on ne « a » pas son âge, on l’« est ».',
                    answer: '« I **am** nine years old. »',
                    answer_lines: 1,
                },
                {
                    prompt: 'Réponds en anglais, en une phrase complète : « What is your favourite subject? »',
                    answer: '« My favourite subject is ___. » (math, French, science, art, gym…)',
                    answer_lines: 2,
                },
                {
                    prompt: 'Écris 3 phrases : « In my school bag, there is/are ___ . »',
                    hint: 'there **is** + singulier · there **are** + pluriel',
                    answer: 'Ex. : « In my school bag, there is a pencil case. There are three notebooks. There is a water bottle. »',
                    answer_lines: 3,
                },
            ],
        },
    ],
};

export const REVISION_BOOKLETS: RevisionBooklet[] = [QC_4E_RENTREE];

export const findBooklet = (id: string): RevisionBooklet | undefined =>
    REVISION_BOOKLETS.find((b) => b.id === id);

/** Listing shape — the heavy `sheets` array is replaced by counts. */
export const listBooklets = () =>
    REVISION_BOOKLETS.map((b) => ({
        id: b.id,
        label: b.label,
        description: b.description,
        grade_level: b.grade_level,
        caveat: b.caveat,
        sheets_count: b.sheets.length,
        // Distinct subjects, in first-appearance order, so the import dialog can
        // offer them as checkboxes without shipping the whole booklet.
        subjects: [...new Set(b.sheets.map((s) => s.subject))],
        total_minutes: b.sheets.reduce((sum, s) => sum + s.duration_minutes, 0),
    }));
