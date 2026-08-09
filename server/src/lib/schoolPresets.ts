import type { SchoolEventType, SchoolSubject, SchoolSupplyCategory } from '../schemas/school';

// =============================================================================
// School-year presets
//
// A preset is a ready-made bundle of calendar events + supply-checklist rows a
// user can import onto a student in one click, instead of typing the school's
// letter in by hand. Presets are plain data: adding one for another school /
// country means appending an entry to SCHOOL_PRESETS, no schema change.
//
// Everything a preset creates is a NORMAL row afterwards — editable, deletable,
// with its own reminder settings. Importing twice is guarded by the route
// (it skips rows whose (title, start_date) or (label, category) already exist
// for that student), so a re-import tops up rather than duplicates.
//
// `caveat` is surfaced in the UI: some values below were read off a printed
// calendar grid, so the user is told to check them against the official one.
// =============================================================================

export interface PresetEvent {
    title: string;
    event_type: SchoolEventType;
    start_date: string;
    end_date?: string;
    notes?: string;
    reminder_enabled?: boolean;
    reminder_days_before?: number;
}

export interface PresetSupply {
    label: string;
    category: SchoolSupplyCategory;
    quantity: number;
    isbn?: string;
    subject?: SchoolSubject;
    store?: string;
    notes?: string;
}

export interface SchoolPreset {
    id: string;
    label: string;
    description: string;
    school_year: string;
    grade_level: string;
    school_name: string;
    /** Shown as a warning banner before/after import. */
    caveat: string;
    events: PresetEvent[];
    supplies: PresetSupply[];
}

// -----------------------------------------------------------------------------
// Québec — Centre de services scolaire des Patriotes, École J.-P.-Labarre,
// 2026-2027.
//
// Sources:
//  - "CALENDRIER SCOLAIRE 2026-2027 (version parents)" — the dated events below.
//    The first day of school and the last day of class are printed with their
//    own legend markers; the pedagogical days and holidays were read off the
//    month grids, hence the caveat.
//  - Letter "Processus d'achat des cahiers d'exercices" (2 July 2026) — the
//    Buropro Citation pickup date (primary grades only).
//  - Letter "Aux parents des élèves du préscolaire 5 ans" (30 June 2026) — the
//    staggered-start schedule and the parents' meeting (kindergarten only).
//  - "LISTE DES EFFETS SCOLAIRES POUR L'ANNÉE 2026-2027" (one per grade) —
//    workbooks + supplies, transcribed verbatim including quantities.
//
// Deliberately NOT included: the classmates' first names printed on the
// teacher's welcome card. Those are other people's children; a preset ships in
// the repository for every user, so it must not carry them. A parent who wants
// them can paste them into their own child's `notes`.
// -----------------------------------------------------------------------------

const PATRIOTES_CAVEAT =
    'Les journées pédagogiques et les congés proviennent de la lecture du calendrier 2026-2027 (version parents). Vérifiez-les avec le calendrier officiel de l’école avant de vous y fier — chaque date reste modifiable ou supprimable.';

/**
 * The board-wide calendar, shared by every grade. Grade-specific presets
 * prepend their own back-to-school events (the primary "rentrée" is a single
 * day; kindergarten runs a four-day staggered start) and then spread this in.
 */
const PATRIOTES_2026_2027_CALENDAR: PresetEvent[] = [
    {
        title: 'Journées pédagogiques (avant la rentrée)',
        event_type: 'Pédagogique',
        start_date: '2026-08-25',
        end_date: '2026-08-31',
        notes: 'Journées de travail des enseignants — pas de classe pour les élèves.',
        reminder_enabled: false,
    },
    { title: 'Fête du Travail', event_type: 'Congé', start_date: '2026-09-07' },
    { title: 'Journée pédagogique', event_type: 'Pédagogique', start_date: '2026-09-18' },
    { title: 'Action de grâce', event_type: 'Congé', start_date: '2026-10-12' },
    { title: 'Journée pédagogique', event_type: 'Pédagogique', start_date: '2026-10-23' },
    {
        title: 'Journées pédagogiques',
        event_type: 'Pédagogique',
        start_date: '2026-11-19',
        end_date: '2026-11-20',
    },
    {
        title: 'Vacances des Fêtes',
        event_type: 'Congé',
        start_date: '2026-12-23',
        end_date: '2027-01-05',
        reminder_days_before: 2,
    },
    {
        title: 'Journée pédagogique',
        event_type: 'Pédagogique',
        start_date: '2027-01-06',
        notes: 'Journée pédagogique pour force majeure — retour en classe le 7 janvier.',
    },
    { title: 'Journée pédagogique', event_type: 'Pédagogique', start_date: '2027-01-27' },
    {
        title: 'Période officielle d’inscription 2027-2028',
        event_type: 'Autre',
        start_date: '2027-02-01',
        end_date: '2027-02-05',
        reminder_days_before: 7,
    },
    {
        title: 'Journées pédagogiques',
        event_type: 'Pédagogique',
        start_date: '2027-02-11',
        end_date: '2027-02-12',
    },
    {
        title: 'Semaine de relâche',
        event_type: 'Congé',
        start_date: '2027-03-01',
        end_date: '2027-03-05',
        reminder_days_before: 5,
    },
    { title: 'Vendredi saint', event_type: 'Congé', start_date: '2027-03-26' },
    { title: 'Lundi de Pâques', event_type: 'Congé', start_date: '2027-03-29' },
    {
        title: 'Journée nationale des patriotes',
        event_type: 'Congé',
        start_date: '2027-05-24',
    },
    {
        title: 'Journée pédagogique',
        event_type: 'Pédagogique',
        start_date: '2027-05-25',
        notes: 'Journée pédagogique pour force majeure.',
    },
    { title: 'Journée pédagogique', event_type: 'Pédagogique', start_date: '2027-06-04' },
    {
        title: 'Fin des classes pour les élèves',
        event_type: 'Autre',
        start_date: '2027-06-23',
        reminder_days_before: 2,
    },
    { title: 'Saint-Jean-Baptiste', event_type: 'Congé', start_date: '2027-06-24' },
];

// --- 4e année ---------------------------------------------------------------

const QC_PATRIOTES_2026_2027_4E: SchoolPreset = {
    id: 'qc-patriotes-2026-2027-4e',
    label: 'École J.-P.-Labarre — 4e année (2026-2027)',
    description:
        'Calendrier scolaire du Centre de services scolaire des Patriotes, cahiers d’exercices (avec ISBN) et liste des effets scolaires de 4e année.',
    school_year: '2026-2027',
    grade_level: '4e année',
    school_name: 'École J.-P.-Labarre',
    caveat: PATRIOTES_CAVEAT,
    events: [
        {
            title: 'Cahiers d’exercices disponibles chez Buropro Citation',
            event_type: 'Autre',
            start_date: '2026-08-03',
            notes: '600, boulevard Sir-Wilfrid-Laurier, Beloeil (J3G 4J2). Commande en ligne et livraison à domicile possibles : https://www.buroprocitation.ca/listes-scolaires',
            reminder_days_before: 3,
        },
        {
            title: 'Rentrée scolaire des élèves',
            event_type: 'Rentrée',
            start_date: '2026-09-01',
            reminder_days_before: 2,
        },
        ...PATRIOTES_2026_2027_CALENDAR,
    ],
    supplies: [
        // --- Cahiers d'exercices (à acheter chez un libraire) ---
        {
            label: 'Matcha (mathématique)',
            category: 'Cahier',
            quantity: 1,
            isbn: '999-8-2024-1019-6',
            subject: 'Mathématique',
            store: 'Buropro Citation',
        },
        {
            label: 'Jazz (français)',
            category: 'Cahier',
            quantity: 1,
            isbn: '999-8-2024-1011-0',
            subject: 'Français',
            store: 'Buropro Citation',
        },
        {
            label: 'Escale (univers social)',
            category: 'Cahier',
            quantity: 1,
            isbn: '978-2-7661-5521-7',
            subject: 'Univers social',
            store: 'Buropro Citation',
        },
        {
            label: 'New Adventures 2e édition (anglais)',
            category: 'Cahier',
            quantity: 1,
            isbn: '978-2-7617-8210-4',
            subject: 'Anglais',
            store: 'Buropro Citation',
        },
        // --- Effets scolaires ---
        {
            label: 'Crayons à la mine HB',
            category: 'Fourniture',
            quantity: 10,
            notes: 'Évitez les pousse-mines.',
        },
        { label: 'Boîte de crayons de couleur', category: 'Fourniture', quantity: 1 },
        { label: 'Stylos', category: 'Fourniture', quantity: 2 },
        {
            label: 'Cahiers d’exercices lignés 32 pages (8 ½" x 11")',
            category: 'Fourniture',
            quantity: 3,
        },
        {
            label: 'Cahiers d’exercices interlignés (8 ½" x 11")',
            category: 'Fourniture',
            quantity: 2,
        },
        {
            label: 'Cahier d’exercices quadrillé 80 pages',
            category: 'Fourniture',
            quantity: 1,
            notes: 'Grosseur du quadrillé : 4 au pouce.',
        },
        { label: 'Paquet de feuilles lignées (50)', category: 'Fourniture', quantity: 1 },
        {
            label: 'Couvertures de présentation avec 3 attaches métalliques',
            category: 'Fourniture',
            quantity: 6,
        },
        { label: 'Cartable 1 pouce', category: 'Fourniture', quantity: 1 },
        {
            label: 'Couverture de présentation bleue, 3 attaches à 2 tiges avec pochettes',
            category: 'Fourniture',
            quantity: 1,
        },
        { label: 'Gommes à effacer blanches', category: 'Fourniture', quantity: 2 },
        { label: 'Règle métrique en plastique de 30 cm', category: 'Fourniture', quantity: 1 },
        {
            label: 'Surligneurs de couleurs',
            category: 'Fourniture',
            quantity: 2,
            notes: '1 bleu et 1 jaune.',
        },
        { label: 'Étuis à crayons', category: 'Fourniture', quantity: 2 },
        {
            label: 'Boîte de crayons feutres à pointes larges',
            category: 'Fourniture',
            quantity: 1,
        },
        {
            label: 'Boîte de crayons feutres à pointes fines',
            category: 'Fourniture',
            quantity: 1,
        },
        { label: 'Bâtons de colle', category: 'Fourniture', quantity: 2 },
        { label: 'Paire de ciseaux', category: 'Fourniture', quantity: 1 },
        { label: 'Pochettes plastiques', category: 'Fourniture', quantity: 10 },
        {
            label: 'Marqueur noir permanent à pointe ultra fine',
            category: 'Fourniture',
            quantity: 1,
        },
        {
            label: 'Marqueur noir permanent à pointe fine',
            category: 'Fourniture',
            quantity: 1,
            notes: 'La quantité n’est pas précisée sur la liste de l’école — ajustez au besoin.',
        },
        {
            label: 'Taille-crayon cylindrique avec couvercle qui se visse',
            category: 'Fourniture',
            quantity: 1,
        },
        {
            label: 'Sac pour congélation, large (environ 27 cm x 28 cm)',
            category: 'Fourniture',
            quantity: 1,
        },
    ],
};

// --- Préscolaire 5 ans ------------------------------------------------------
//
// Kindergarten does not start like the other grades: the first four days are a
// staggered entry, split into two sub-groups by family name, with no bus and no
// daycare at first. Each day is its own event so the parent sees the right
// hours at the right time, and the two sub-groups' hours are both kept in the
// notes — the preset can't know which one applies to a given family.

const QC_PATRIOTES_2026_2027_PRESCOLAIRE: SchoolPreset = {
    id: 'qc-patriotes-2026-2027-prescolaire',
    label: 'École J.-P.-Labarre — Préscolaire 5 ans (2026-2027)',
    description:
        'Calendrier scolaire du Centre de services scolaire des Patriotes, horaire de la rentrée progressive du préscolaire et liste des effets scolaires 5 ans.',
    school_year: '2026-2027',
    grade_level: 'Préscolaire 5 ans',
    school_name: 'École J.-P.-Labarre',
    caveat: `${PATRIOTES_CAVEAT} Les heures de la rentrée progressive sont données pour les deux sous-groupes (Groupe 1 : noms de famille A à F, Groupe 2 : G à Z) — gardez celles qui vous concernent.`,
    events: [
        {
            title: 'Confirmer l’inscription au service de garde',
            event_type: 'Autre',
            start_date: '2026-08-17',
            notes: 'À faire le plus rapidement possible si le service de garde est prévu pour le 2 et le 3 septembre. Technicienne du service de garde : 450-645-2359, poste 6281.',
            reminder_days_before: 0,
        },
        {
            title: 'Réunion de parents (sans élèves)',
            event_type: 'Réunion',
            start_date: '2026-08-27',
            notes: 'À 17h30, dans la classe de votre enfant (une liste sera affichée à l’entrée de la classe). Durée : environ une heure.',
            reminder_days_before: 2,
        },
        {
            title: 'Rentrée progressive — jour 1 (en sous-groupe, avec un adulte)',
            event_type: 'Rentrée',
            start_date: '2026-09-01',
            notes: 'Groupe 1 (noms A à F) : 9h10 à 10h10. Groupe 2 (noms G à Z) : 10h15 à 11h15. Pas d’autobus ni de service de garde — prévoyez le transport.',
            reminder_days_before: 2,
        },
        {
            title: 'Rentrée progressive — jour 2 (en sous-groupe, sans parent)',
            event_type: 'Rentrée',
            start_date: '2026-09-02',
            notes: 'Groupe 1 : 8h50 à 10h00. Groupe 2 : 10h05 à 11h15. Pas d’autobus ; service de garde après la période en classe pour ceux qui en ont fait la demande.',
        },
        {
            title: 'Rentrée progressive — jour 3 (avant-midi seulement)',
            event_type: 'Rentrée',
            start_date: '2026-09-03',
            notes: '8h23 à 11h15 pour tous les élèves. Premier jour avec autobus ; service de garde après la période en classe pour ceux qui en ont fait la demande.',
        },
        {
            title: 'Première journée complète (horaire régulier)',
            event_type: 'Rentrée',
            start_date: '2026-09-04',
            notes: '8h23 à 11h50, puis 13h10 à 14h25.',
        },
        ...PATRIOTES_2026_2027_CALENDAR,
    ],
    supplies: [
        {
            label: 'Grand sac d’école pouvant contenir un cartable',
            category: 'Fourniture',
            quantity: 1,
        },
        {
            label: 'Étui pour les fournitures scolaires',
            category: 'Fourniture',
            quantity: 1,
            notes: 'Assez grand pour y ranger crayons feutres, colle en bâton et ciseaux.',
        },
        {
            label: 'Vieille chemise ou couvre-tout avec manches longues',
            category: 'Vêtement',
            quantity: 1,
        },
        {
            label: 'Paire de ciseaux 6 pouces à bouts ronds ou semi-pointus',
            category: 'Fourniture',
            quantity: 1,
            notes: 'Avec lames de métal.',
        },
        {
            label: 'Couvertures de présentation en carton, 3 attaches à 2 tiges',
            category: 'Fourniture',
            quantity: 6,
            notes: 'Une verte, une bleue, une jaune, une noire, une blanche, une orange.',
        },
        {
            label: 'Album de coupures avec spirale, 20 feuilles (35,6 x 27,9 cm)',
            category: 'Fourniture',
            quantity: 1,
        },
        { label: 'Ruban adhésif', category: 'Fourniture', quantity: 1 },
        {
            label: 'Enveloppe transparente 1 ¼" — 9 ¾" x 13" (format légal)',
            category: 'Fourniture',
            quantity: 1,
            notes: 'Avec fermeture éclair ou fermeture à velcro.',
        },
        {
            label: 'Bouteille de colle pour projet 3D de 118 ml',
            category: 'Fourniture',
            quantity: 1,
        },
        { label: 'Crayons à la mine HB', category: 'Fourniture', quantity: 2 },
        {
            label: 'Taille-crayon cylindrique avec couvercle qui se visse',
            category: 'Fourniture',
            quantity: 1,
        },
        { label: 'Crayon effaçable à sec, pointe fine', category: 'Fourniture', quantity: 1 },
        {
            label: 'Bâtons de colle 40 g',
            category: 'Fourniture',
            quantity: 2,
            notes: 'Bâtons et capuchons identifiés.',
        },
        {
            label: 'Boîtes de 20 crayons feutres (super pointe lavable)',
            category: 'Fourniture',
            quantity: 2,
        },
        {
            label: 'Boîte de 12 crayons de couleur en bois taillés (ou plus)',
            category: 'Fourniture',
            quantity: 1,
        },
        {
            label: 'Sacs de congélation « à glissière »',
            category: 'Fourniture',
            quantity: 2,
            notes: 'Identifier le sac.',
        },
        { label: 'Gomme à effacer blanche', category: 'Fourniture', quantity: 1 },
        { label: 'Planchette à pince', category: 'Fourniture', quantity: 1 },
        { label: 'Couverture pour la détente', category: 'Autre', quantity: 1 },
        {
            label: 'Sac identifié avec vêtements de rechange complet',
            category: 'Vêtement',
            quantity: 1,
        },
        { label: 'Bouteille d’eau qui se referme bien', category: 'Autre', quantity: 1 },
    ],
};

export const SCHOOL_PRESETS: SchoolPreset[] = [
    QC_PATRIOTES_2026_2027_4E,
    QC_PATRIOTES_2026_2027_PRESCOLAIRE,
];

export const findPreset = (id: string): SchoolPreset | undefined =>
    SCHOOL_PRESETS.find((p) => p.id === id);

/** Listing shape — the heavy arrays are replaced by counts. */
export const listPresets = () =>
    SCHOOL_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        school_year: p.school_year,
        grade_level: p.grade_level,
        school_name: p.school_name,
        caveat: p.caveat,
        events_count: p.events.length,
        supplies_count: p.supplies.length,
    }));
