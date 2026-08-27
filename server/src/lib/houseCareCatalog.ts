// =============================================================================
// Curated home-care catalog.
//
// This is the "what a good owner actually does" reference the seasonal program
// is seeded from. It is deliberately plain data, not AI output: a first-time
// owner needs a correct, complete baseline on day one, and the AI's job is to
// personalise and prioritise ON TOP of it — never to invent the fundamentals.
//
// Every entry carries `riskIfSkipped`, because the module's real promise isn't
// "here is a chore list", it's "here is what protects you from a five-figure
// repair". A task without a stated consequence gets skipped; one that says
// "un boyau laissé branché fait éclater le tuyau dans le mur" does not.
//
// Applicability: entries declare `requires` (profile facts) and `climates`.
// selectCatalogForProfile() filters on both, so a condo without a basement
// never sees sump-pump tasks and a Mediterranean house never sees ice dams.
//
// Cost figures are CAD order-of-magnitude anchors for budgeting, not quotes.
// =============================================================================

export const CARE_CATEGORIES = [
    'Toiture',
    'Extérieur',
    'Fondation',
    'Plomberie',
    'Chauffage & ventilation',
    'Électricité',
    'Sécurité',
    'Intérieur',
    'Gros postes',
] as const;
export type CareCategory = (typeof CARE_CATEGORIES)[number];

export const CARE_SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver', "Toute l'année"] as const;
export type CareSeason = (typeof CARE_SEASONS)[number];

export const CARE_FREQUENCIES = [
    'Hebdomadaire',
    'Mensuel',
    'Trimestriel',
    'Saisonnier',
    'Annuel',
    'Pluriannuel',
] as const;
export type CareFrequency = (typeof CARE_FREQUENCIES)[number];

export const CARE_PRIORITIES = ['Critique', 'Important', 'Confort'] as const;
export type CarePriority = (typeof CARE_PRIORITIES)[number];

export const CARE_RESPONSIBILITIES = ['Soi-même', 'Professionnel', 'Mixte'] as const;
export type CareResponsibility = (typeof CARE_RESPONSIBILITIES)[number];

/**
 * Profile facts an entry can depend on. Kept as a flat vocabulary rather than
 * a predicate function so the catalog stays serialisable and inspectable (the
 * AI prompt lists the applicable keys as grounding).
 */
export type CareRequirement =
    | 'basement'
    | 'sumpPump'
    | 'woodStove'
    | 'heatPump'
    | 'combustionHeating' // fournaise/chaudière gaz ou mazout
    | 'airExchanger'
    | 'pool'
    | 'septic'
    | 'well'
    | 'garage'
    | 'irrigation'
    | 'yard'; // terrain privatif (exclut le condo)

/**
 * Climate families. 'cold' = freeze/thaw cycles and snow load (Québec, Nordic
 * Europe, northern US). 'temperate' = mild winters. 'hot' = little to no frost.
 */
export type ClimateFamily = 'cold' | 'temperate' | 'hot';

export interface CareCatalogEntry {
    key: string;
    title: string;
    category: CareCategory;
    season: CareSeason;
    frequency: CareFrequency;
    /** Canonical recurrence in months. null for weekly tasks. */
    intervalMonths: number | null;
    /** Ideal calendar window, 1-12. Wrapping (12 → 2) is legal. */
    monthStart: number | null;
    monthEnd: number | null;
    priority: CarePriority;
    responsibility: CareResponsibility;
    estimatedMinutes: number | null;
    /** Typical out-of-pocket in CAD when a pro does it. null when free/DIY. */
    estimatedCost: number | null;
    riskIfSkipped: string;
    steps: string[];
    requires?: CareRequirement[];
    climates?: ClimateFamily[];
}

// ---------------------------------------------------------------------------
// Weekly routine — the 10-minute tour. Short, high-signal, all year.
//
// These are the checks that turn a catastrophe into a nuisance: water shows up
// small before it shows up big, and every one of these is about noticing early.
// ---------------------------------------------------------------------------

const WEEKLY: CareCatalogEntry[] = [
    {
        key: 'weekly-basement-tour',
        title: 'Tour du sous-sol : traces d’eau, odeur d’humidité',
        category: 'Fondation',
        season: "Toute l'année",
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: null,
        monthEnd: null,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Une infiltration repérée la semaine même se règle souvent avec un tube de scellant. Découverte trois mois plus tard, c'est la moisissure derrière le gypse, le plancher à refaire et une réclamation d'assurance : 8 000 à 30 000 $.",
        steps: [
            'Fais le tour du périmètre en regardant le bas des murs et la jonction mur-plancher.',
            'Cherche : auréole, efflorescence blanche (sels), peinture qui cloque, carton de gypse gondolé.',
            'Passe la main derrière les boîtes et les meubles collés au mur — c’est là que ça commence.',
            'Fie-toi à ton nez : une odeur de terre humide qui apparaît est un signal, même sans tache visible.',
            'Note toute nouvelle fissure et photographie-la avec une règle à côté pour suivre son évolution.',
        ],
        requires: ['basement'],
    },
    {
        key: 'weekly-water-points',
        title: 'Vérifier les points d’eau (éviers, toilettes, électros)',
        category: 'Plomberie',
        season: "Toute l'année",
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: null,
        monthEnd: null,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Le dégât d'eau est la réclamation d'assurance habitation numéro un, et la majorité part d'un raccord de lave-vaisselle ou d'un joint de toilette qui suinte depuis des semaines. Le mélamine gonflé sous l'évier est le signe qu'il est déjà trop tard.",
        steps: [
            'Ouvre les armoires sous chaque évier : passe la main sur les raccords, cherche le bois gonflé ou taché.',
            'Regarde le plancher au pied des toilettes — un anneau de cire usé laisse une auréole avant de tout défaire.',
            'Regarde derrière/sous le lave-vaisselle et la laveuse ; vérifie que les boyaux ne sont ni craquelés ni pliés.',
            'Vérifie que le chauffe-eau n’a pas d’humidité ni de rouille au bas du réservoir.',
        ],
    },
    {
        key: 'weekly-sump-pump',
        title: 'Tester la pompe de puisard',
        category: 'Fondation',
        season: "Toute l'année",
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: null,
        monthEnd: null,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Une pompe morte ne se remarque qu'au moment où elle devait servir : à la fonte ou pendant l'orage. Un sous-sol fini inondé, c'est 15 000 à 40 000 $ et souvent une franchise salée. Fais-le chaque semaine au printemps, au minimum une fois par mois le reste de l'année.",
        steps: [
            'Verse un seau d’eau dans le puisard jusqu’à faire monter le flotteur.',
            'La pompe doit démarrer seule, évacuer, puis s’arrêter nette — pas de ronronnement continu.',
            'Vérifie que l’eau sort bien dehors et loin de la fondation, pas dans le drain de fondation.',
            'Enlève les débris au fond du puisard, ils bloquent le flotteur.',
            'Si tu as une batterie de secours, teste-la en débranchant la pompe du courant.',
        ],
        requires: ['sumpPump'],
    },
    {
        key: 'weekly-winter-vents',
        title: 'Dégager les évents extérieurs après chaque bordée',
        category: 'Chauffage & ventilation',
        season: 'Hiver',
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: 11,
        monthEnd: 4,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 10,
        estimatedCost: null,
        riskIfSkipped:
            "Un évent d'appareil à combustion bloqué par la neige refoule le monoxyde de carbone dans la maison. C'est la seule tâche de cette liste qui peut tuer. Un évent de sécheuse bouché, lui, c'est le risque d'incendie.",
        steps: [
            'Repère et dégage à la main (jamais à la pelle contre le tuyau) : sortie de sécheuse, échangeur d’air, évent de chauffe-eau ou de fournaise à haute efficacité.',
            'Dégage aussi la prise d’air, souvent un deuxième tuyau à côté de l’évacuation.',
            'Vérifie qu’aucune plaque de glace ne s’est formée sur la grille au-dessus.',
            'Profites-en pour dégager la sortie de la hotte de cuisine.',
        ],
        climates: ['cold'],
    },
    {
        key: 'weekly-heatpump-winter',
        title: 'Dégager et écouter la thermopompe',
        category: 'Chauffage & ventilation',
        season: 'Hiver',
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: 11,
        monthEnd: 4,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 10,
        estimatedCost: null,
        riskIfSkipped:
            "Une unité extérieure ensevelie ou bloquée dans la glace force le compresseur : c'est le remplacement à 5 000-9 000 $ au lieu d'un déneigement de dix minutes. Le givre permanent signale un cycle de dégivrage défaillant, à faire voir avant qu'il ne casse.",
        steps: [
            'Dégage 45 à 60 cm tout autour de l’unité extérieure et au-dessus.',
            'Laisse le dessous libre : la glace qui s’accumule sous l’unité finit par bloquer le ventilateur.',
            'Ne jamais frapper la glace : verse de l’eau tiède si nécessaire.',
            'Un peu de givre qui disparaît après un cycle de dégivrage est normal ; une carapace de glace permanente, non.',
            'Écoute : un grincement, un cliquetis ou une vibration nouvelle se signale à un technicien tout de suite.',
        ],
        requires: ['heatPump'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'weekly-ice-dams',
        title: 'Surveiller les glaçons et les barrages de glace',
        category: 'Toiture',
        season: 'Hiver',
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: 12,
        monthEnd: 3,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Un barrage de glace fait remonter l'eau de fonte SOUS les bardeaux : elle ressort dans les murs et les plafonds. Les dégâts se voient au printemps, quand la cause a fondu. Réparation typique : 5 000 à 25 000 $, plus la cause à corriger (isolation/ventilation du grenier).",
        steps: [
            'Fais le tour dehors et regarde le bord du toit : un bourrelet de glace au débord ou de gros glaçons alignés = barrage.',
            'Regarde les coins de plafond et le haut des murs extérieurs à l’intérieur : auréole = l’eau est déjà entrée.',
            'Si accumulation importante, dégage la neige du débord à la racle depuis le sol — jamais sur le toit, jamais à la hache.',
            'Un barrage qui revient chaque année est un problème d’isolation ou de ventilation du grenier, pas de glace.',
        ],
        climates: ['cold'],
    },
    {
        key: 'weekly-humidity',
        title: 'Lire le taux d’humidité intérieur',
        category: 'Intérieur',
        season: "Toute l'année",
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 2,
        estimatedCost: null,
        riskIfSkipped:
            "Trop humide en hiver, l'eau condense dans les murs et le grenier : moisissure et pourriture invisibles pendant des années. Trop sec, ce sont les planchers de bois qui fendent et les joints qui craquent.",
        steps: [
            'Vise 30-40 % en hiver (baisse vers 25-30 % par grand froid), 40-50 % en été.',
            'De la condensation qui coule au bas des fenêtres = trop humide : réduis, fais tourner l’échangeur d’air.',
            'Fais toujours tourner le ventilateur de salle de bain 20-30 minutes après une douche.',
            'Un hygromètre à 15 $ dans le salon et un au sous-sol suffisent.',
        ],
    },
    {
        key: 'weekly-woodstove',
        title: 'Contrôle du poêle à bois en saison de chauffe',
        category: 'Sécurité',
        season: 'Hiver',
        frequency: 'Hebdomadaire',
        intervalMonths: null,
        monthStart: 10,
        monthEnd: 4,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 10,
        estimatedCost: null,
        riskIfSkipped:
            "La créosote s'accumule vite quand on brûle du bois humide ou qu'on étouffe le feu la nuit : un feu de cheminée monte à plus de 1 000 °C et se propage à la charpente. C'est aussi le motif numéro un de refus d'indemnisation quand le ramonage annuel n'est pas documenté.",
        steps: [
            'Vide les cendres dans un contenant métallique avec couvercle, posé dehors sur une surface incombustible — jamais dans un sac ni sur la galerie de bois.',
            'Regarde la vitre : un noircissement rapide et gras signale du bois trop humide ou un tirage insuffisant.',
            'Vérifie le joint tressé de la porte (une feuille de papier coincée doit résister quand la porte est fermée).',
            'Brûle uniquement du bois séché 12 à 24 mois, sous 20 % d’humidité — un humidimètre coûte 25 $.',
            'Dehors, jette un œil au chapeau de cheminée : pas d’obstruction, pas de grillage encrassé.',
        ],
        requires: ['woodStove'],
    },
];

// ---------------------------------------------------------------------------
// Monthly / quarterly routine.
// ---------------------------------------------------------------------------

const MONTHLY: CareCatalogEntry[] = [
    {
        key: 'monthly-smoke-co-test',
        title: 'Tester les avertisseurs de fumée et de CO',
        category: 'Sécurité',
        season: "Toute l'année",
        frequency: 'Mensuel',
        intervalMonths: 1,
        monthStart: null,
        monthEnd: null,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Un avertisseur muet ne prévient de rien. Avec un appareil à combustion dans la maison, l'avertisseur de CO n'est pas optionnel — et les deux types d'appareils se remplacent complètement après 10 ans, pile neuve ou non.",
        steps: [
            'Appuie sur le bouton test de chaque appareil jusqu’au signal sonore.',
            'Un avertisseur de fumée par étage minimum, dont un près des chambres ; un avertisseur de CO à chaque étage avec appareil à combustion ou garage attenant.',
            'Regarde la date de fabrication à l’endos : fumée = 10 ans, CO = 7 à 10 ans selon le modèle. Passé ça, on remplace l’appareil.',
            'Change les piles deux fois par an, aux changements d’heure.',
        ],
    },
    {
        key: 'monthly-hvac-filter',
        title: 'Filtre de la thermopompe / du système de ventilation',
        category: 'Chauffage & ventilation',
        season: "Toute l'année",
        frequency: 'Mensuel',
        intervalMonths: 1,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 10,
        estimatedCost: 15,
        riskIfSkipped:
            "Un filtre colmaté étrangle le débit d'air : la consommation grimpe, le serpentin gèle et le compresseur s'use prématurément. C'est la panne la plus chère causée par la pièce la moins chère.",
        steps: [
            'Vérifie le filtre chaque mois ; remplace ou lave-le aux 1 à 3 mois (plus souvent avec animaux ou travaux).',
            'Note le format exact (ex. 16x25x1) dans la fiche de l’équipement pour ne plus jamais le chercher.',
            'Respecte le sens de la flèche de circulation d’air imprimée sur le cadre.',
            'Sur les unités murales (mini-split), sors les filtres et rince-les à l’eau tiède, laisse sécher complètement.',
        ],
        requires: ['heatPump'],
    },
    {
        key: 'monthly-air-exchanger',
        title: 'Nettoyer les filtres de l’échangeur d’air (VRC)',
        category: 'Chauffage & ventilation',
        season: "Toute l'année",
        frequency: 'Trimestriel',
        intervalMonths: 3,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            "Dans une maison moderne étanche, le VRC est ce qui empêche l'humidité et les polluants de s'accumuler. Encrassé, il ne renouvelle plus rien : fenêtres qui condensent, air lourd, moisissure au grenier.",
        steps: [
            'Coupe l’appareil, sors les deux filtres et passe-les à l’aspirateur, puis à l’eau tiède savonneuse.',
            'Sors le noyau (le bloc d’échange) une à deux fois par an et rince-le doucement.',
            'Vérifie que le tuyau de condensat n’est pas bouché et que le siphon contient de l’eau.',
            'Dehors, dégage les deux grilles d’admission et d’évacuation.',
        ],
        requires: ['airExchanger'],
    },
    {
        key: 'monthly-floor-drain',
        title: 'Verser de l’eau dans les drains peu utilisés',
        category: 'Plomberie',
        season: "Toute l'année",
        frequency: 'Mensuel',
        intervalMonths: 1,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 5,
        estimatedCost: null,
        riskIfSkipped:
            "Le siphon d'un drain de plancher qui s'assèche ouvre un passage direct entre l'égout et ta maison : odeurs, insectes, et l'entrée possible de gaz de sol. C'est deux litres d'eau par mois.",
        steps: [
            'Verse 2 litres d’eau dans le drain de plancher du sous-sol et du garage.',
            'Fais couler l’eau des salles de bain et des éviers rarement utilisés.',
            'Ajoute une cuillère d’huile végétale pour ralentir l’évaporation dans les drains vraiment inutilisés.',
        ],
        requires: ['basement'],
    },
    {
        key: 'monthly-gfci-test',
        title: 'Tester les prises DDFT (GFCI) et le panneau électrique',
        category: 'Électricité',
        season: "Toute l'année",
        frequency: 'Trimestriel',
        intervalMonths: 3,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 10,
        estimatedCost: null,
        riskIfSkipped:
            'Une prise DDFT défectueuse ne protège plus contre l’électrocution là où il y a de l’eau — salle de bain, cuisine, extérieur, garage. Le test prend dix secondes par prise.',
        steps: [
            'Appuie sur TEST : le courant doit couper. Appuie sur RESET : il doit revenir.',
            'Si une prise ne coupe pas ou ne se réarme pas, fais-la remplacer.',
            'Regarde et sens le panneau électrique : aucune odeur de brûlé, aucun bourdonnement, aucune trace de chaleur.',
            'Vérifie qu’aucun disjoncteur ne se déclenche à répétition — c’est un symptôme, pas un caprice.',
        ],
    },
    {
        key: 'monthly-water-heater-flush',
        title: 'Purger quelques litres du chauffe-eau',
        category: 'Plomberie',
        season: "Toute l'année",
        frequency: 'Trimestriel',
        intervalMonths: 3,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            "Les sédiments au fond du réservoir isolent l'élément, font surchauffer l'acier et raccourcissent la vie du chauffe-eau de plusieurs années. Un chauffe-eau qui cède, c'est 200 litres d'eau au sous-sol.",
        steps: [
            'Branche un boyau sur le robinet de vidange au bas du réservoir, dirige-le vers un drain.',
            'Ouvre quelques secondes et laisse couler 10 à 20 litres jusqu’à ce que l’eau soit claire.',
            'Referme bien et vérifie qu’il n’y a aucun goutte-à-goutte après.',
            'Actionne brièvement la soupape de sûreté température-pression une fois par an, et remplace-la si elle goutte ensuite.',
        ],
    },
    {
        key: 'monthly-range-hood',
        title: 'Nettoyer hotte, filtre de lave-vaisselle et joints',
        category: 'Intérieur',
        season: "Toute l'année",
        frequency: 'Trimestriel',
        intervalMonths: 3,
        monthStart: null,
        monthEnd: null,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: null,
        riskIfSkipped:
            'Un filtre de hotte saturé de graisse est un accélérateur d’incendie au-dessus de la cuisinière, et un lave-vaisselle encrassé sent mauvais puis draine mal.',
        steps: [
            'Fais tremper les filtres métalliques de la hotte dans l’eau chaude avec du dégraissant.',
            'Sors et rince le filtre au fond du lave-vaisselle, nettoie le joint de porte.',
            'Nettoie le joint du réfrigérateur et passe l’aspirateur sur les serpentins à l’arrière ou en dessous.',
            'Nettoie le filtre à charpie de la sécheuse à fond (le film invisible de l’assouplissant se retire à l’eau savonneuse).',
        ],
    },
];

// ---------------------------------------------------------------------------
// Printemps (mars-mai) — le bilan d'après-hiver. C'est la saison où l'on
// découvre ce que le gel a fait, et où l'on prépare l'eau de fonte.
// ---------------------------------------------------------------------------

const SPRING: CareCatalogEntry[] = [
    {
        key: 'spring-foundation-inspection',
        title: 'Inspecter la fondation et la pente du terrain après le dégel',
        category: 'Fondation',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 5,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 60,
        estimatedCost: null,
        riskIfSkipped:
            "Le remblai se tasse d'un ou deux centimètres par an et finit par diriger l'eau de fonte vers la fondation au lieu de l'en éloigner. C'est la cause la plus fréquente et la moins chère à corriger des sous-sols humides — face à un drain français à refaire, 15 000 à 30 000 $.",
        steps: [
            'Fais le tour de la maison et vérifie que le sol descend d’au moins 15 cm sur les 2 premiers mètres, en s’éloignant du mur.',
            'Ajoute de la terre là où ça s’est creusé — de la terre, pas du paillis ni du gravier seul.',
            'Note et mesure chaque fissure : verticale et fine (< 3 mm) est courante ; en escalier, horizontale, ou qui s’élargit = fais voir un ingénieur.',
            'Vérifie les margelles (puits de fenêtre) : elles doivent drainer, pas retenir l’eau.',
            'Regarde le solage à nu : béton qui s’effrite, joints de blocs ouverts.',
        ],
        requires: ['yard'],
    },
    {
        key: 'spring-gutters',
        title: 'Nettoyer les gouttières et vérifier les descentes',
        category: 'Toiture',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 5,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: 200,
        riskIfSkipped:
            "Une gouttière bouchée déverse toute l'eau du toit au pied de la fondation. C'est le raccourci le plus direct vers un sous-sol humide, et l'hiver suivant, c'est aussi ce qui alimente les barrages de glace.",
        steps: [
            'Sors les débris à la main (gants), puis rince au boyau vers la descente.',
            'Vérifie que l’eau s’écoule vraiment et repère les fuites aux joints.',
            'Confirme que chaque descente rejette l’eau à 1,5 m minimum de la fondation — rallonge ou déflecteur au besoin.',
            'Vérifie que la gouttière est bien fixée et légèrement pentée vers la descente.',
            'Deux fois par an au minimum : après la fonte, et surtout après la chute des feuilles.',
        ],
        requires: ['yard'],
    },
    {
        key: 'spring-roof-inspection',
        title: 'Inspection visuelle de la toiture',
        category: 'Toiture',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 6,
        priority: 'Critique',
        responsibility: 'Mixte',
        estimatedMinutes: 45,
        estimatedCost: 300,
        riskIfSkipped:
            "Trois bardeaux arrachés se réparent pour quelques centaines de dollars. La même fuite ignorée deux ans traverse le contreplaqué, l'isolant et le plafond : on parle alors de 10 000 $ et plus, et la toiture complète coûte 12 000 à 25 000 $.",
        steps: [
            'Depuis le sol avec des jumelles (ou depuis l’échelle, sans monter sur le toit) : bardeaux soulevés, fendus, manquants, granules accumulées au bas des descentes.',
            'Regarde tous les solins : cheminée, évents de plomberie, lucarnes, noues. C’est là que 90 % des fuites commencent.',
            'Vérifie les évents de toit et le capuchon de ventilation : rien d’écrasé par la neige ni de nid d’oiseau.',
            'À l’intérieur, monte au grenier de jour : toute trace de lumière ou auréole sur le bois se traite tout de suite.',
            'Passé 15 ans, fais faire une inspection professionnelle aux 2 ans et commence à provisionner le remplacement.',
        ],
    },
    {
        key: 'spring-attic-check',
        title: 'Vérifier le grenier : isolation, ventilation, traces d’eau',
        category: 'Toiture',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 5,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: null,
        riskIfSkipped:
            "Un grenier mal ventilé, c'est la cause profonde des barrages de glace ET de la moisissure sur la face intérieure du toit. Corriger la ventilation coûte quelques centaines de dollars ; refaire un pontage pourri, plusieurs milliers.",
        steps: [
            'Vérifie que les déflecteurs (chicanes) laissent l’air passer des soffites vers le faîte — l’isolant soufflé les bouche souvent.',
            'Cherche du noircissement ou de la moisissure sur le contreplaqué, surtout au nord.',
            'Vérifie que les ventilateurs de salle de bain et la hotte débouchent DEHORS, jamais dans le grenier.',
            'Mesure l’épaisseur d’isolant : vise R-50 à R-60 (environ 40-50 cm de cellulose) au Québec.',
            'Repère les fuites d’air autour des plafonniers encastrés et de la trappe d’accès : c’est par là que la chaleur monte et fait fondre la neige.',
        ],
    },
    {
        key: 'spring-outdoor-faucets',
        title: 'Rouvrir les robinets extérieurs et chercher les fuites',
        category: 'Plomberie',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 5,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            'Un robinet extérieur fissuré par le gel ne se voit pas de dehors : il fuit dans le mur dès qu’on rouvre la valve intérieure, souvent au-dessus du sous-sol fini.',
        steps: [
            'Attends la fin des risques de gel nocturne.',
            'Ouvre la valve intérieure lentement pendant que quelqu’un surveille le robinet dehors.',
            'Fais couler, puis referme et va inspecter le mur et le plafond du sous-sol sous le robinet.',
            'Vérifie l’état du boyau et du raccord anti-refoulement.',
        ],
        requires: ['yard'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'spring-hvac-service',
        title: 'Entretien professionnel annuel de la thermopompe',
        category: 'Chauffage & ventilation',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 4,
        monthEnd: 6,
        priority: 'Important',
        responsibility: 'Professionnel',
        estimatedMinutes: 90,
        estimatedCost: 250,
        riskIfSkipped:
            "Une thermopompe entretenue tient 15 à 20 ans ; négligée, 8 à 10. Le remplacement coûte 6 000 à 12 000 $, l'entretien annuel 180 à 300 $. Plusieurs garanties de fabricant exigent d'ailleurs la preuve d'un entretien annuel.",
        steps: [
            'Prends rendez-vous au printemps ou à l’automne — jamais pendant la canicule ou le premier grand froid, les délais explosent.',
            'Le technicien doit nettoyer les serpentins, vérifier la charge de frigorigène, les contacteurs, le drain de condensat et le cycle de dégivrage.',
            'Demande le rapport écrit et classe-le dans les documents de la maison.',
            'Fais nettoyer aussi les conduits si tu vois de la poussière sortir aux grilles (aux 5-8 ans, pas plus souvent).',
        ],
        requires: ['heatPump'],
    },
    {
        key: 'spring-dryer-vent',
        title: 'Nettoyer le conduit de sécheuse au complet',
        category: 'Sécurité',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 3,
        monthEnd: 5,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 45,
        estimatedCost: 30,
        riskIfSkipped:
            "Le conduit de sécheuse est l'une des premières causes d'incendie domestique. La charpie s'accumule sur toute la longueur du tuyau, pas seulement dans le filtre, et sèche à 60 °C plusieurs heures par semaine.",
        steps: [
            'Débranche la sécheuse, tire-la, détache le conduit.',
            'Passe une brosse-écouvillon sur toute la longueur, des deux bouts.',
            'Aspire aussi le boîtier de la sécheuse derrière le filtre.',
            'Remplace tout conduit en plastique ou en aluminium flexible accordéon par du métal rigide ou semi-rigide.',
            'Dehors, vérifie que le volet du clapet s’ouvre librement.',
        ],
    },
    {
        key: 'spring-exterior-walkaround',
        title: 'Faire le tour extérieur : bardage, calfeutrage, moustiquaires',
        category: 'Extérieur',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 5,
        monthEnd: 6,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: 50,
        riskIfSkipped:
            "Le calfeutrage est la peau de la maison : quelques dollars de scellant empêchent l'eau d'entrer dans la structure et l'air chaud d'en sortir. Un joint ouvert derrière une moulure, c'est du bois pourri qu'on découvre en refaisant le revêtement.",
        steps: [
            'Vérifie le scellant autour des fenêtres, des portes, et de chaque pénétration (robinet, câble, sortie de sécheuse, boîtier électrique).',
            'Cherche le bardage fendu, décollé, ou taché ; regarde en particulier sous les fenêtres.',
            'Vérifie que rien (terre, paillis, bois de chauffage) ne touche le bas du revêtement — laisse 15 cm dégagés.',
            'Installe les moustiquaires, répare les déchirures.',
            'Regarde les galeries et le patio : planches fendues, vis qui ressortent, poteaux dont la base a noirci.',
        ],
        requires: ['yard'],
    },
    {
        key: 'spring-window-seals',
        title: 'Laver les fenêtres et vérifier les scellants des thermos',
        category: 'Intérieur',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 5,
        monthEnd: 6,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 120,
        estimatedCost: null,
        riskIfSkipped:
            "De la buée EN PERMANENCE entre les deux vitres veut dire que le joint du thermos est brisé : la fenêtre a perdu son pouvoir isolant. On remplace la vitre seule (300-600 $) plutôt que le cadre complet si on s'y prend avant que le cadre souffre.",
        steps: [
            'Lave les vitres et note lesquelles gardent de la buée entre les vitres même après nettoyage.',
            'Nettoie les rails et les trous de drainage au bas du cadre — bouchés, l’eau reste dans le châssis.',
            'Lubrifie les mécanismes de manivelle et les charnières.',
            'Vérifie les coupe-froid : un joint aplati ou craquelé se remplace pour quelques dollars du mètre.',
        ],
    },
    {
        key: 'spring-driveway',
        title: 'Inspecter l’asphalte, le pavé et les marches',
        category: 'Extérieur',
        season: 'Printemps',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 5,
        monthEnd: 6,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 45,
        estimatedCost: null,
        riskIfSkipped:
            "Une fissure d'asphalte laisse entrer l'eau, qui gèle et fait éclater la surface de l'intérieur. Sceller une fissure coûte quelques dollars ; refaire une entrée, 5 000 à 12 000 $.",
        steps: [
            'Repère les fissures de plus de 3 mm et les affaissements.',
            'Vérifie que l’entrée et les dalles s’éloignent de la maison, sans contre-pente.',
            'Regarde les marches et le béton de la galerie : éclatements, armature apparente, main courante qui bouge.',
            'Le sel de déglaçage attaque le béton de moins d’un an : utilise du sable ou de la pierre nette la première année.',
        ],
        requires: ['yard'],
    },
];

// ---------------------------------------------------------------------------
// Été (juin-août) — la saison des travaux extérieurs : c'est le seul moment où
// le scellant, la peinture et l'asphalte prennent correctement.
// ---------------------------------------------------------------------------

const SUMMER: CareCatalogEntry[] = [
    {
        key: 'summer-caulking',
        title: 'Refaire le calfeutrage extérieur',
        category: 'Extérieur',
        season: 'Été',
        frequency: 'Pluriannuel',
        intervalMonths: 36,
        monthStart: 6,
        monthEnd: 8,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 180,
        estimatedCost: 80,
        riskIfSkipped:
            "Le scellant durcit et fend en 5 à 8 ans sous nos écarts de température. Une fois ouvert, il capte l'eau au lieu de la repousser et la retient contre le bois.",
        steps: [
            'Travaille par temps sec, entre 10 et 25 °C — un scellant posé sur du mouillé ou par grand froid n’adhère pas.',
            'Enlève complètement l’ancien joint, nettoie et sèche la surface.',
            'Utilise un scellant extérieur uréthane ou silicone de qualité, pas du latex de peintre.',
            'Priorise : pourtour des fenêtres et des portes, jonction des matériaux, pénétrations de service.',
            'Ne scelle JAMAIS les trous de drainage (weep holes) au bas des fenêtres ou de la brique.',
        ],
        requires: ['yard'],
    },
    {
        key: 'summer-driveway-seal',
        title: 'Sceller les fissures de l’entrée',
        category: 'Extérieur',
        season: 'Été',
        frequency: 'Pluriannuel',
        intervalMonths: 24,
        monthStart: 7,
        monthEnd: 8,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 180,
        estimatedCost: 120,
        riskIfSkipped:
            'L’eau qui entre par une fissure gèle en hiver et double le dommage à chaque cycle de gel-dégel. Deux hivers suffisent pour transformer un trait de crayon en nid-de-poule.',
        steps: [
            'Choisis une période sèche, sans pluie annoncée pendant 48 h.',
            'Nettoie les fissures à fond (souffleur, brosse métallique, désherbage).',
            'Applique un remplisseur à fissures, puis le scellant une fois sec.',
            'Le scellant complet d’asphalte se refait aux 2-4 ans, pas chaque année — trop souvent, il craquèle.',
        ],
        requires: ['yard'],
    },
    {
        key: 'summer-deck-stain',
        title: 'Nettoyer et teindre la galerie / le patio',
        category: 'Extérieur',
        season: 'Été',
        frequency: 'Pluriannuel',
        intervalMonths: 24,
        monthStart: 6,
        monthEnd: 8,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 480,
        estimatedCost: 200,
        riskIfSkipped:
            "Le bois laissé nu grisonne puis pourrit, en commençant par les vis et le bas des poteaux. Refaire une galerie, c'est 8 000 à 20 000 $ ; la teindre aux deux ans, 200 $.",
        steps: [
            'Lave à basse pression avec un nettoyant à bois, laisse sécher 48 h.',
            'Remplace les planches fendues et resserre la quincaillerie.',
            'Vérifie particulièrement la base des poteaux et les solives contre la maison (le point de pourriture classique).',
            'Applique la teinture par temps couvert, jamais en plein soleil.',
            'Contrôle que la structure est bien ancrée et que le garde-corps ne bouge pas.',
        ],
        requires: ['yard'],
    },
    {
        key: 'summer-pests',
        title: 'Contrôler insectes et rongeurs autour de la maison',
        category: 'Extérieur',
        season: 'Été',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 6,
        monthEnd: 8,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 60,
        estimatedCost: null,
        riskIfSkipped:
            "Les fourmis charpentières ne mangent pas le bois, elles le creusent — et elles s'installent dans le bois déjà humide, donc leur présence signale une fuite. Une colonie dans une solive de rive, c'est plusieurs milliers de dollars de structure.",
        steps: [
            'Cherche des amas de bran de scie fin au pied des murs, des poteaux de galerie, des cadres de porte.',
            'Vérifie que le bois de chauffage est empilé loin de la maison et surélevé.',
            'Élague les branches qui touchent le toit ou le revêtement (autoroute à fourmis et à écureuils).',
            'Bouche les ouvertures de plus de 6 mm avec de la laine d’acier et du scellant ; grillage sur les soffites et les évents.',
            'Guêpes : traite tôt, avant que le nid grossisse, en soirée.',
        ],
        requires: ['yard'],
    },
    {
        key: 'summer-chimney-sweep',
        title: 'Ramonage annuel de la cheminée',
        category: 'Sécurité',
        season: 'Été',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 7,
        monthEnd: 9,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 90,
        estimatedCost: 200,
        riskIfSkipped:
            "Un feu de cheminée peut détruire la maison, et l'assureur exige presque toujours la preuve d'un ramonage annuel pour indemniser un sinistre lié au chauffage au bois. Beaucoup de municipalités québécoises l'imposent aussi par règlement.",
        steps: [
            'Prends rendez-vous en été : les ramoneurs sont débordés dès septembre et les prix montent.',
            'Fais ramoner ET inspecter : conduit, briques réfractaires, joints, chapeau, solin de cheminée.',
            'Exige et conserve la facture ou le certificat — c’est ta pièce justificative auprès de l’assureur.',
            'Chauffage intensif (plus de 3 cordes par saison) : fais un deuxième ramonage en milieu d’hiver.',
        ],
        requires: ['woodStove'],
    },
    {
        key: 'summer-condensate-drain',
        title: 'Vérifier le drain de condensat de la climatisation',
        category: 'Chauffage & ventilation',
        season: 'Été',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 6,
        monthEnd: 8,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            'Un drain de condensat bouché par les algues fait déborder le bac au-dessus du plafond ou dans le sous-sol. C’est un dégât d’eau lent et silencieux, en pleine canicule.',
        steps: [
            'Repère le tuyau de condensat de l’unité intérieure et vérifie qu’il coule bien.',
            'Aspire le bout du tuyau à l’aspirateur d’atelier pour déloger le bouchon.',
            'Vérifie que le bac de récupération est propre et sec.',
            'Sur un mini-split mural, vérifie que le tuyau qui sort dehors goutte pendant la climatisation.',
        ],
        requires: ['heatPump'],
    },
    {
        key: 'summer-septic',
        title: 'Vidange et contrôle de la fosse septique',
        category: 'Plomberie',
        season: 'Été',
        frequency: 'Pluriannuel',
        intervalMonths: 24,
        monthStart: 6,
        monthEnd: 9,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 120,
        estimatedCost: 400,
        riskIfSkipped:
            "Au Québec, la vidange est obligatoire aux 2 ans pour une résidence permanente (4 ans en saisonnier). Une fosse non vidangée colmate le champ d'épuration : son remplacement coûte 15 000 à 30 000 $, contre 300-500 $ la vidange.",
        steps: [
            'Planifie la vidange aux 2 ans et garde le reçu (la municipalité peut l’exiger).',
            'Ne roule ni ne stationne jamais sur le champ d’épuration.',
            'Pas de lingettes, de graisse, de peinture ni de produits chlorés en quantité dans les drains.',
            'Surveille les signes : herbe anormalement verte au-dessus du champ, odeurs, drains lents.',
        ],
        requires: ['septic'],
    },
    {
        key: 'summer-well-test',
        title: 'Analyse de l’eau du puits',
        category: 'Plomberie',
        season: 'Été',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 6,
        monthEnd: 9,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 30,
        estimatedCost: 100,
        riskIfSkipped:
            'Une contamination bactériologique n’a ni goût, ni odeur, ni couleur. C’est une analyse par an dans un laboratoire accrédité, et c’est la santé de la maisonnée.',
        steps: [
            'Fais analyser au moins la bactériologie (coliformes, E. coli) une fois par an, idéalement au printemps après la fonte.',
            'Ajoute une analyse physico-chimique (nitrates, fer, manganèse, dureté, arsenic) aux 2-3 ans.',
            'Utilise un laboratoire accrédité par le ministère et suis leurs instructions d’échantillonnage à la lettre.',
            'Vérifie que le couvercle du puits est étanche et que le sol s’éloigne du tubage.',
        ],
        requires: ['well'],
    },
    {
        key: 'summer-pool-care',
        title: 'Ouverture, équilibre et fermeture de la piscine',
        category: 'Extérieur',
        season: 'Été',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 5,
        monthEnd: 9,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 240,
        estimatedCost: 300,
        riskIfSkipped:
            'Une eau mal équilibrée attaque la toile et les pièces mécaniques, et une fermeture bâclée avant le gel fait éclater la tuyauterie et la pompe.',
        steps: [
            'Ouverture en mai : nettoyage, remise en marche, équilibre du pH (7,2-7,6) et de l’alcalinité.',
            'En saison : contrôle du chlore et du pH deux fois par semaine, nettoyage du panier de skimmer.',
            'Fermeture avant le premier gel : abaisser le niveau, purger toute la tuyauterie, antigel dans les lignes, toile bien tendue.',
            'Vérifie l’état de la clôture et du loquet à fermeture automatique — c’est une obligation réglementaire.',
        ],
        requires: ['pool'],
    },
];

// ---------------------------------------------------------------------------
// Automne (septembre-novembre) — LA saison critique au Québec. Tout ce qui
// n'est pas fait avant la première neige coûte cher, ou ne se fait plus.
// ---------------------------------------------------------------------------

const FALL: CareCatalogEntry[] = [
    {
        key: 'fall-outdoor-faucets',
        title: 'Fermer et purger les robinets extérieurs',
        category: 'Plomberie',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            "Un boyau laissé branché empêche le robinet de se vider : l'eau gèle dans le tuyau à l'intérieur du mur et le fait éclater. On ne s'en aperçoit qu'au printemps, quand l'eau jaillit dans le mur. C'est 20 minutes de travail contre 10 000 $ de dégâts.",
        steps: [
            'Débranche TOUS les boyaux — c’est l’erreur numéro un des nouveaux propriétaires.',
            'Ferme la valve intérieure qui alimente chaque robinet extérieur.',
            'Ouvre le robinet dehors pour laisser la conduite se vider complètement, puis laisse-le ouvert.',
            'Ouvre le petit bouchon de purge sur la valve intérieure et récupère le reste d’eau.',
            'Range les boyaux enroulés, à l’abri.',
        ],
        requires: ['yard'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'fall-gutters',
        title: 'Nettoyer les gouttières après la chute des feuilles',
        category: 'Toiture',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: 200,
        riskIfSkipped:
            "C'est le nettoyage le plus important de l'année. Des gouttières pleines de feuilles gèlent en bloc dès novembre : l'eau de fonte n'a plus d'issue, remonte sous les bardeaux, et c'est le barrage de glace assuré.",
        steps: [
            'Attends que les arbres soient dégarnis — nettoyer trop tôt oblige à recommencer.',
            'Vide, rince, vérifie l’écoulement de chaque descente.',
            'Fais-le AVANT le premier gel, sinon c’est bloqué jusqu’au printemps.',
            'Si tu as des arbres matures au-dessus du toit, envisage des protège-gouttières ou un deuxième passage.',
        ],
        requires: ['yard'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'fall-weatherstripping',
        title: 'Vérifier coupe-froid, seuils et calfeutrage avant l’hiver',
        category: 'Intérieur',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 9,
        monthEnd: 11,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: 60,
        riskIfSkipped:
            'Les fuites d’air représentent une part majeure de la facture de chauffage et créent les courants froids qu’on attribue à tort aux fenêtres. C’est le meilleur rendement au dollar de toute la maison.',
        steps: [
            'Par temps venteux, passe la main (ou un bâton d’encens) au pourtour des portes, fenêtres, prises de murs extérieurs et trappe du grenier.',
            'Remplace les coupe-froid aplatis ou craquelés ; ajuste les seuils de porte.',
            'Vérifie la porte du garage attenant : c’est souvent la pire fuite de la maison.',
            'Pose des coupe-froid sur les portes de sous-sol non chauffé et de garage.',
            'Bouche les grosses fuites au grenier (autour des cheminées, des colonnes de plomberie) avec du scellant coupe-feu approprié.',
        ],
    },
    {
        key: 'fall-heating-service',
        title: 'Faire réviser le système de chauffage avant la saison',
        category: 'Chauffage & ventilation',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 9,
        monthEnd: 10,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 90,
        estimatedCost: 250,
        riskIfSkipped:
            "Une panne de chauffage au premier -25 °C, c'est plusieurs jours d'attente en pleine surcharge des entreprises — et un risque réel de gel des conduites. Sur un appareil à combustion, c'est aussi le contrôle de l'échangeur, donc du monoxyde de carbone.",
        steps: [
            'Prends rendez-vous en septembre, avant la ruée.',
            'Fais vérifier le fonctionnement en mode chauffage, l’appoint électrique et le point de bascule de la thermopompe.',
            'Sur un appareil à combustion : contrôle de l’échangeur de chaleur, de la combustion et de l’évacuation.',
            'Teste toi-même le chauffage une première fois fin septembre, dans une pièce, pour découvrir un problème pendant qu’il fait encore doux.',
        ],
    },
    {
        key: 'fall-heatpump-winterize',
        title: 'Préparer l’unité extérieure pour la neige',
        category: 'Chauffage & ventilation',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: null,
        riskIfSkipped:
            "Une unité posée trop bas passe l'hiver dans la neige fondante qui regèle : le ventilateur casse, le serpentin se déforme, et le drainage sous l'unité se bloque.",
        steps: [
            'Vérifie que l’unité est surélevée d’au moins 40-45 cm au-dessus du niveau de neige habituel.',
            'Nettoie les feuilles et les débris dans et autour du serpentin.',
            'Installe au besoin un toit protecteur contre la glace qui tombe du toit — mais ne bâche JAMAIS l’unité, elle doit respirer.',
            'Marque son emplacement avec une balise pour que le déneigement l’évite.',
            'Vérifie que rien ne bloque l’écoulement de l’eau de dégivrage sous l’unité.',
        ],
        requires: ['heatPump'],
        climates: ['cold'],
    },
    {
        key: 'fall-firewood',
        title: 'Préparer le bois de chauffage et le poêle',
        category: 'Sécurité',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 9,
        monthEnd: 10,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 180,
        estimatedCost: null,
        riskIfSkipped:
            'Du bois trop humide produit deux à trois fois plus de créosote, chauffe moins et encrasse la vitre. C’est la cause directe des feux de cheminée.',
        steps: [
            'Vérifie l’humidité du bois avec un humidimètre : sous 20 %, sinon il n’est pas prêt.',
            'Empile dehors, surélevé, couvert sur le dessus seulement, à distance de la maison.',
            'Ne rentre que la quantité de quelques jours (les insectes viennent avec le bois).',
            'Avant la première flambée : vérifie les briques réfractaires, le joint de porte, le déflecteur, et que le ramonage est fait.',
            'Vérifie que l’avertisseur de CO à l’étage du poêle fonctionne.',
        ],
        requires: ['woodStove'],
    },
    {
        key: 'fall-snow-gear',
        title: 'Préparer le déneigement avant la première neige',
        category: 'Extérieur',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: 100,
        riskIfSkipped:
            'Faire réparer une souffleuse en décembre, c’est trois semaines d’attente. Et des balises posées après la première bordée ne servent plus à rien.',
        steps: [
            'Fais l’entretien de la souffleuse : huile, bougie, courroies, essence fraîche — ou réserve ton contrat de déneigement dès septembre.',
            'Pose les balises le long de l’entrée pour protéger le gazon, la haie et l’unité extérieure.',
            'Range abrasif et fondant à portée ; privilégie le sable près du béton neuf et des plantations.',
            'Sors la racle à toit et vérifie que tu peux atteindre le débord depuis le sol.',
            'Protège les arbustes exposés à la neige qui glisse du toit.',
        ],
        requires: ['yard'],
        climates: ['cold'],
    },
    {
        key: 'fall-irrigation-blowout',
        title: 'Purger le système d’irrigation',
        category: 'Extérieur',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 10,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 60,
        estimatedCost: 150,
        riskIfSkipped:
            'De l’eau laissée dans les conduites enterrées fait éclater tuyaux, valves et têtes de gicleurs. La réparation implique de creuser le terrain au printemps.',
        steps: [
            'Fais purger à l’air comprimé par un professionnel avant le premier gel.',
            'Ferme et vidange le dispositif anti-refoulement.',
            'Coupe l’alimentation et le programmateur.',
        ],
        requires: ['irrigation'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'fall-detectors-batteries',
        title: 'Changer les piles des avertisseurs et inverser les ventilateurs',
        category: 'Sécurité',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 11,
        monthEnd: 11,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: 20,
        riskIfSkipped:
            'La saison de chauffage est celle où le risque d’incendie et de monoxyde est le plus élevé. On profite du changement d’heure pour ne jamais oublier.',
        steps: [
            'Change les piles de tous les avertisseurs de fumée et de CO au changement d’heure de novembre.',
            'Passe l’aspirateur sur les grilles de chaque appareil (la poussière cause les fausses alarmes).',
            'Vérifie les dates de péremption et remplace les appareils de plus de 10 ans.',
            'Inverse le sens des ventilateurs de plafond (rotation horaire, vitesse lente) pour redescendre l’air chaud.',
            'Vérifie que l’extincteur est chargé, accessible, et que tout le monde sait où il est.',
        ],
    },
    {
        key: 'fall-sump-pre-winter',
        title: 'Contrôle complet du puisard et du clapet anti-retour',
        category: 'Fondation',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 45,
        estimatedCost: null,
        riskIfSkipped:
            "Le pire moment pour découvrir une pompe morte, c'est le redoux de janvier ou la fonte de mars. Et un clapet anti-retour d'égout défaillant laisse refouler l'égout municipal dans le sous-sol lors d'une pluie diluvienne.",
        steps: [
            'Nettoie le fond du puisard, teste la pompe au seau, vérifie le flotteur.',
            'Vérifie le clapet anti-retour (backwater valve) s’il y en a un : le battant doit bouger librement.',
            'Assure-toi que la conduite de rejet dehors n’est pas obstruée et qu’elle ne gèlera pas.',
            'Une pompe de plus de 7-10 ans se remplace préventivement : 300 $ contre un sous-sol inondé.',
            'Envisage une batterie de secours si le sous-sol est fini.',
        ],
        requires: ['sumpPump'],
    },
    {
        key: 'fall-yard-cleanup',
        title: 'Fermer le terrain : élagage, meubles, feuilles',
        category: 'Extérieur',
        season: 'Automne',
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 10,
        monthEnd: 11,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 240,
        estimatedCost: null,
        riskIfSkipped:
            'Une branche morte au-dessus du toit finit par tomber sous le poids du verglas. Et les feuilles laissées contre la fondation retiennent l’humidité tout l’hiver.',
        steps: [
            'Élague les branches mortes et celles qui surplombent le toit, l’entrée ou les fils électriques.',
            'Ramasse les feuilles collées contre la fondation et dans les margelles de fenêtres.',
            'Range ou couvre les meubles de jardin ; vide et retourne les pots de terre cuite.',
            'Vidange l’essence des petits moteurs ou ajoute un stabilisateur.',
            'Range les outils et débranche les rallonges extérieures.',
        ],
        requires: ['yard'],
    },
];

// ---------------------------------------------------------------------------
// Hiver (décembre-février) — surveillance plutôt que travaux.
// ---------------------------------------------------------------------------

const WINTER: CareCatalogEntry[] = [
    {
        key: 'winter-roof-snow-load',
        title: 'Évaluer la charge de neige sur le toit',
        category: 'Toiture',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 3,
        priority: 'Critique',
        responsibility: 'Mixte',
        estimatedMinutes: 30,
        estimatedCost: 400,
        riskIfSkipped:
            'Après un hiver chargé, surtout avec de la pluie verglaçante par-dessus la neige, la charge peut dépasser ce que la charpente supporte. Les affaissements de toit arrivent chaque année au Québec, en février et en mars.',
        steps: [
            'Surveille surtout les toits plats, les toits à faible pente, et les creux entre deux versants où la neige s’accumule.',
            'Signes d’alerte : portes intérieures qui coincent, fissures nouvelles dans le gypse, craquements inhabituels.',
            'Déneige depuis le sol avec une racle à toit ; ne monte jamais sur un toit enneigé.',
            'Au-delà de ce que la racle atteint, engage un déneigeur de toiture assuré — pas un ami avec une pelle, qui percera les bardeaux.',
            'Dégage aussi la neige qui s’accumule contre les sorties de secours du sous-sol.',
        ],
        climates: ['cold'],
    },
    {
        key: 'winter-pipe-freeze',
        title: 'Protéger les tuyaux du gel par grand froid',
        category: 'Plomberie',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 12,
        monthEnd: 2,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            'Un tuyau gelé dans un mur extérieur éclate au dégel, pas au gel — et se vide alors dans la structure. Les tuyaux les plus vulnérables sont ceux du garage, des murs extérieurs et des vides sanitaires.',
        steps: [
            'Sous -25 °C : ouvre les portes d’armoires sous les éviers des murs extérieurs.',
            'Laisse couler un mince filet d’eau froide au robinet le plus éloigné.',
            'Isole les tuyaux exposés du sous-sol, du garage et du vide sanitaire avec des manchons de mousse.',
            'Garde le thermostat à 15 °C minimum partout, même dans les pièces inoccupées.',
            'En cas d’absence prolongée : ferme l’entrée d’eau et vidange, ou fais surveiller la maison.',
        ],
        climates: ['cold'],
    },
    {
        key: 'winter-attic-frost',
        title: 'Vérifier le grenier par temps très froid',
        category: 'Toiture',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 2,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            "Du givre sur la face intérieure du toit veut dire que de l'air chaud et humide monte de la maison. Au redoux, ce givre fond et coule dans l'isolant et le plafond — le propriétaire cherche alors une fuite de toit qui n'existe pas.",
        steps: [
            'Monte au grenier lors d’une vague de froid et regarde le dessous du contreplaqué avec une lampe.',
            'Du givre ou des gouttelettes = fuite d’air à colmater (trappe, luminaires encastrés, colonnes de plomberie).',
            'Vérifie que la neige ne bloque pas les évents de toit ni les soffites.',
            'Un grenier bien fait est FROID en hiver : s’il est tiède, c’est le problème.',
        ],
        climates: ['cold'],
    },
    {
        key: 'winter-mid-season-chimney',
        title: 'Contrôle de mi-saison du conduit de cheminée',
        category: 'Sécurité',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 2,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: null,
        riskIfSkipped:
            "La créosote s'accumule le plus vite en janvier-février, quand on chauffe le plus. Un contrôle à mi-saison dit s'il faut un deuxième ramonage avant la fin de l'hiver.",
        steps: [
            'Attends que le poêle soit froid, ouvre la porte de ramonage ou le raccordement.',
            'Gratte l’intérieur du conduit : une couche de plus de 3 mm, ou d’aspect goudronneux et luisant, exige un ramonage immédiat.',
            'Vérifie le chapeau de cheminée depuis le sol : pas de glace, pas de nid.',
            'Ajuste ta façon de brûler : feux vifs et courts plutôt que combustion lente et étouffée toute la nuit.',
        ],
        requires: ['woodStove'],
    },
    {
        key: 'winter-thaw-watch',
        title: 'Surveiller la maison pendant les redoux',
        category: 'Fondation',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 3,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 20,
        estimatedCost: null,
        riskIfSkipped:
            "Les redoux de janvier et la fonte de mars sont les deux moments de l'année où un sous-sol s'inonde. Le sol est encore gelé, l'eau ne pénètre pas et cherche le chemin le plus facile : ta fondation.",
        steps: [
            'Avant un redoux annoncé, dégage la neige sur 1 à 2 m autour de la fondation, surtout aux descentes de gouttières.',
            'Dégage les margelles de fenêtres et les sorties de drain.',
            'Vérifie que la sortie de la pompe de puisard n’est pas prise dans la glace.',
            'Fais un tour du sous-sol pendant et après le redoux.',
            'Casse la glace dans les caniveaux et devant l’entrée de garage pour que l’eau s’évacue.',
        ],
        climates: ['cold'],
    },
    {
        key: 'winter-garage-salt',
        title: 'Entretien du garage et du béton en hiver',
        category: 'Extérieur',
        season: 'Hiver',
        frequency: 'Saisonnier',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 3,
        priority: 'Confort',
        responsibility: 'Soi-même',
        estimatedMinutes: 45,
        estimatedCost: null,
        riskIfSkipped:
            'La saumure qui s’égoutte des voitures ronge la dalle de garage et fait éclater le béton en surface. Un plancher de garage à refaire coûte plusieurs milliers de dollars.',
        steps: [
            'Rince la dalle à l’eau tiède quelques fois durant l’hiver, ou passe la vadrouille.',
            'Vérifie que le drain de garage n’est pas obstrué.',
            'Lubrifie les rails, ressorts et charnières de la porte de garage, et teste l’inversion automatique en plaçant un objet au sol.',
            'Vérifie le coupe-froid au bas de la porte de garage.',
            'N’utilise pas de sel sur du béton de moins d’un an.',
        ],
        requires: ['garage'],
        climates: ['cold'],
    },
];

// ---------------------------------------------------------------------------
// Gros postes — les échéances à provisionner. Ces tâches ne sont pas des
// corvées : ce sont des rappels budgétaires. Un premier acheteur qui ne les
// voit pas venir subit la dépense au lieu de la planifier.
// ---------------------------------------------------------------------------

const BIG_TICKET: CareCatalogEntry[] = [
    {
        key: 'big-water-heater-replace',
        title: 'Remplacer le chauffe-eau préventivement (10-12 ans)',
        category: 'Gros postes',
        season: "Toute l'année",
        frequency: 'Pluriannuel',
        intervalMonths: 120,
        monthStart: null,
        monthEnd: null,
        priority: 'Critique',
        responsibility: 'Professionnel',
        estimatedMinutes: 180,
        estimatedCost: 1400,
        riskIfSkipped:
            "Un chauffe-eau ne fuit pas doucement : le réservoir cède et libère 180 à 270 litres d'un coup. Remplacé préventivement, c'est 1 000 à 1 800 $ à la date de ton choix ; en urgence après le dégât, c'est le même montant plus le plancher, les murs et la franchise. Plusieurs assureurs refusent de couvrir un appareil de plus de 12 ans.",
        steps: [
            'Repère l’année de fabrication sur la plaque signalétique et note-la dans la fiche d’équipement.',
            'Planifie le remplacement à 10-12 ans, avant la panne.',
            'Installe un bac de récupération relié à un drain, ou un détecteur de fuite avec valve automatique.',
            'Profites-en pour vérifier si un chauffe-eau thermodynamique est rentable dans ton cas.',
        ],
    },
    {
        key: 'big-roof-replace',
        title: 'Provisionner le remplacement de la toiture',
        category: 'Gros postes',
        season: "Toute l'année",
        frequency: 'Pluriannuel',
        intervalMonths: 60,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Professionnel',
        estimatedMinutes: null,
        estimatedCost: 18000,
        riskIfSkipped:
            "Un toit de bardeaux d'asphalte dure 20 à 25 ans au Québec, moins sur un versant sud. Attendre la fuite ajoute la réparation de la structure et du plafond à une facture déjà à cinq chiffres — et impose de choisir l'entrepreneur dans l'urgence, au pire prix.",
        steps: [
            'Note l’année de la toiture dans le profil de la maison ; à partir de 15 ans, fais inspecter aux 2 ans.',
            'Mets de côté chaque mois : diviser 18 000 $ par le nombre d’années restantes donne le montant.',
            'Demande trois soumissions détaillées, et exige la membrane de protection au débord (obligatoire au Québec) et une ventilation adéquate.',
            'Fais faire les travaux au printemps ou à l’automne, jamais en urgence l’hiver.',
        ],
    },
    {
        key: 'big-hvac-replace',
        title: 'Anticiper le remplacement de la thermopompe (12-15 ans)',
        category: 'Gros postes',
        season: "Toute l'année",
        frequency: 'Pluriannuel',
        intervalMonths: 60,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Professionnel',
        estimatedMinutes: null,
        estimatedCost: 9000,
        riskIfSkipped:
            'Une thermopompe qui lâche en janvier se remplace au prix fort, dans les délais des autres. Anticipée, elle se remplace hors saison, avec le temps de comparer et de vérifier les subventions disponibles.',
        steps: [
            'Note l’année d’installation et suis l’évolution des coûts de réparation.',
            'Règle des 50 % : si une réparation dépasse la moitié du prix d’un appareil neuf, remplace.',
            'Vérifie les programmes de subvention en vigueur avant d’acheter — ils changent souvent.',
            'Fais faire un calcul de charge, pas juste un remplacement à l’identique.',
        ],
        requires: ['heatPump'],
    },
    {
        key: 'big-radon-test',
        title: 'Faire un test de radon (une fois, en hiver)',
        category: 'Gros postes',
        season: 'Hiver',
        frequency: 'Pluriannuel',
        intervalMonths: 60,
        monthStart: 11,
        monthEnd: 2,
        priority: 'Critique',
        responsibility: 'Soi-même',
        estimatedMinutes: 30,
        estimatedCost: 60,
        riskIfSkipped:
            "Le radon est la deuxième cause de cancer du poumon, et plusieurs régions du Québec sont à risque. Un gaz sans odeur ni couleur qui s'accumule au sous-sol, surtout en hiver quand tout est fermé. Le test coûte 40-60 $ ; l'atténuation, si nécessaire, 2 000-3 000 $.",
        steps: [
            'Achète un dosimètre longue durée (au moins 3 mois) et pose-le au sous-sol, dans une pièce occupée.',
            'Fais le test en saison de chauffage, de novembre à février.',
            'Renvoie le dosimètre au laboratoire et compare au seuil de Santé Canada (200 Bq/m³).',
            'Refais un test après des travaux majeurs au sous-sol ou une amélioration de l’étanchéité.',
        ],
        requires: ['basement'],
        climates: ['cold', 'temperate'],
    },
    {
        key: 'big-insurance-review',
        title: 'Réviser l’assurance habitation et l’inventaire',
        category: 'Gros postes',
        season: "Toute l'année",
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: null,
        monthEnd: null,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 90,
        estimatedCost: null,
        riskIfSkipped:
            "Beaucoup de propriétaires découvrent au sinistre que le refoulement d'égout ou l'infiltration par le sol n'était pas couvert — ce sont des avenants distincts. Et une maison sous-assurée ne se reconstruit pas au coût d'aujourd'hui.",
        steps: [
            'Vérifie que tu as les avenants refoulement d’égout et infiltration d’eau par le sol.',
            'Vérifie que le montant de reconstruction suit l’inflation des coûts de construction.',
            'Déclare les rénovations importantes et le chauffage au bois (souvent obligatoire à déclarer).',
            'Refais l’inventaire des biens en photo ou en vidéo, et garde-le hors de la maison (nuage).',
            'Demande le rabais lié aux détecteurs de fuite d’eau et aux systèmes d’alarme.',
        ],
    },
    {
        key: 'big-maintenance-budget',
        title: 'Mettre de côté le budget d’entretien annuel',
        category: 'Gros postes',
        season: "Toute l'année",
        frequency: 'Annuel',
        intervalMonths: 12,
        monthStart: 1,
        monthEnd: 2,
        priority: 'Important',
        responsibility: 'Soi-même',
        estimatedMinutes: 45,
        estimatedCost: null,
        riskIfSkipped:
            "La règle admise : 1 à 3 % de la valeur de la maison par année pour l'entretien et le remplacement des composantes. Ce n'est pas une dépense si on la met de côté ; c'est une crise financière si on ne le fait pas.",
        steps: [
            'Calcule 1 à 3 % de la valeur de ta maison — vise le haut de la fourchette si elle a plus de 25 ans.',
            'Ouvre un compte distinct et automatise un virement mensuel.',
            'Additionne les échéances connues (toiture, chauffe-eau, thermopompe, fenêtres) et divise par les années restantes : c’est ton plancher.',
            'Ce compte sert aussi de franchise d’assurance disponible immédiatement.',
        ],
    },
];

export const HOUSE_CARE_CATALOG: CareCatalogEntry[] = [
    ...WEEKLY,
    ...MONTHLY,
    ...SPRING,
    ...SUMMER,
    ...FALL,
    ...WINTER,
    ...BIG_TICKET,
];

/** The profile facts an entry can be filtered on, resolved from house_profile. */
export interface CareProfileFacts {
    climate: ClimateFamily;
    requirements: Set<CareRequirement>;
}

/**
 * Map a stored climate_zone label to a climate family. Unknown labels fall back
 * to 'cold' rather than dropping tasks: for a maintenance program, showing a
 * task that doesn't apply is a five-second dismissal, while hiding one that does
 * is a burst pipe.
 */
export const climateFamilyFor = (climateZone: string | null | undefined): ClimateFamily => {
    const v = (climateZone ?? '').toLowerCase();
    if (v.includes('tropical') || v.includes('chaud') || v.includes('désert')) return 'hot';
    if (v.includes('méditerran') || v.includes('océanique') || v.includes('tempér'))
        return 'temperate';
    return 'cold';
};

/** Build the requirement set from a house_profile row (snake_case as stored). */
export const requirementsForProfile = (profile: {
    has_basement?: boolean;
    has_sump_pump?: boolean;
    has_garage?: boolean;
    has_pool?: boolean;
    has_septic?: boolean;
    has_well?: boolean;
    has_irrigation?: boolean;
    has_air_exchanger?: boolean;
    heating_types?: unknown;
    dwelling_type?: string;
}): Set<CareRequirement> => {
    const req = new Set<CareRequirement>();
    if (profile.has_basement) req.add('basement');
    if (profile.has_sump_pump) req.add('sumpPump');
    if (profile.has_garage) req.add('garage');
    if (profile.has_pool) req.add('pool');
    if (profile.has_septic) req.add('septic');
    if (profile.has_well) req.add('well');
    if (profile.has_irrigation) req.add('irrigation');
    if (profile.has_air_exchanger) req.add('airExchanger');

    const heating = Array.isArray(profile.heating_types)
        ? (profile.heating_types as unknown[]).map((h) => String(h).toLowerCase())
        : [];
    if (heating.some((h) => h.includes('thermopompe') || h.includes('climatis')))
        req.add('heatPump');
    if (heating.some((h) => h.includes('bois') || h.includes('poêle') || h.includes('foyer')))
        req.add('woodStove');
    if (
        heating.some(
            (h) => h.includes('fournaise') || h.includes('chaudière') || h.includes('mazout'),
        )
    )
        req.add('combustionHeating');

    // A condo/apartment owner isn't responsible for the roof, the grounds or the
    // foundation — those tasks belong to the syndicate, not to them.
    const dwelling = (profile.dwelling_type ?? '').toLowerCase();
    if (!dwelling.includes('condo') && !dwelling.includes('appartement')) req.add('yard');

    return req;
};

/**
 * Filter the catalog down to what actually applies to this house.
 *
 * An entry is kept when EVERY declared requirement is satisfied and the climate
 * family matches (an entry with no `climates` applies everywhere).
 */
export const selectCatalogForProfile = (facts: CareProfileFacts): CareCatalogEntry[] =>
    HOUSE_CARE_CATALOG.filter((entry) => {
        if (entry.climates && !entry.climates.includes(facts.climate)) return false;
        if (entry.requires && !entry.requires.every((r) => facts.requirements.has(r))) return false;
        return true;
    });

export const catalogEntryByKey = (key: string): CareCatalogEntry | undefined =>
    HOUSE_CARE_CATALOG.find((e) => e.key === key);
