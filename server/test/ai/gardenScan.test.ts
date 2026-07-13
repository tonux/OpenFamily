import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetAiConfigCache } from '../../src/ai/config';
import { scanGardenPhoto, setAiProviderForTests } from '../../src/ai/AIService';
import { AiError } from '../../src/ai/errors';
import { resetTokenAccountingCache } from '../../src/ai/tokenAccounting';
import type { BaseProvider, ChatRequest } from '../../src/ai/providers/BaseProvider';

const USER = '550e8400-e29b-41d4-a716-446655440000';
const IMAGE = 'data:image/jpeg;base64,/9j/fake';

// -- DB mock ---------------------------------------------------------------
vi.mock('../../src/db', () => ({
    query: vi.fn(async (sql: string) => {
        if (/SUM\(prompt_tokens \+ completion_tokens\)/i.test(sql)) {
            return { rows: [{ used: 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }),
    getClient: vi.fn(),
    default: { query: vi.fn() },
}));

const makeMockProvider = (chatImpl: BaseProvider['chat']): BaseProvider => ({
    name: 'mock',
    chat: chatImpl,
    health: vi.fn(),
});

const okResponse = (content: string) => ({
    content,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: 'stop' as const,
    model: 'mock-vision',
    latencyMs: 12,
});

/** Mounts a provider that replies with `payload` and hands back the captured request. */
const respondWith = (payload: unknown) => {
    const captured: ChatRequest[] = [];
    const chat = vi.fn(async (req: ChatRequest) => {
        captured.push(req);
        return okResponse(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
    setAiProviderForTests(makeMockProvider(chat));
    return { chat, captured };
};

const PLANT_PAYLOAD = {
    detected: true,
    confidence: 'high',
    plant: {
        name: 'Tomate',
        plant_type: 'Légume',
        variety: null,
        health_status: 'À surveiller',
        watering_frequency_days: 2,
    },
    observation: {
        notes: 'Taches brunes sur les feuilles basses, suspicion de mildiou.',
        health_status: 'À surveiller',
        height_cm: 60,
    },
    care: [
        {
            care_type: 'Traitement',
            title: 'Traiter à la bouillie bordelaise',
            due_in_days: 1,
            recurrence_days: null,
            notes: 'Répéter après une pluie.',
        },
    ],
    warnings: [],
};

beforeEach(() => {
    resetAiConfigCache();
    resetTokenAccountingCache();
    process.env.AI_ENABLED = 'true';
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.AI_MODEL_VISION = 'mock-vision';
    process.env.AI_MONTHLY_TOKEN_LIMIT_PER_USER = '0';
});

describe('scanGardenPhoto — plant mode', () => {
    it('maps a well-formed response to zone-less scan with one plant', async () => {
        respondWith(PLANT_PAYLOAD);

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.mode).toBe('plant');
        expect(scan.detected).toBe(true);
        expect(scan.confidence).toBe('high');
        expect(scan.zone).toBeNull(); // never proposed in plant mode
        expect(scan.plants).toHaveLength(1);
        expect(scan.plants[0]).toMatchObject({
            name: 'Tomate',
            plant_type: 'Légume',
            health_status: 'À surveiller',
            watering_frequency_days: 2,
        });
        expect(scan.care).toHaveLength(1);
        expect(scan.care[0].care_type).toBe('Traitement');
        expect(scan.care[0].due_in_days).toBe(1);
        expect(scan.observation?.notes).toContain('mildiou');
        expect(scan.observation?.height_cm).toBe(60);
    });

    it('sends the image to the vision model in a multimodal user message', async () => {
        const { captured } = respondWith(PLANT_PAYLOAD);

        await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        const req = captured[0];
        expect(req.model).toBe('mock-vision');
        expect(req.jsonMode).toBe(true);
        expect(req.temperature).toBe(0);

        const userContent = req.messages[1].content;
        expect(Array.isArray(userContent)).toBe(true);
        const parts = userContent as Array<{ type: string; image_url?: { url: string } }>;
        expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe(IMAGE);
    });

    it('passes the zone context into the prompt when the plant targets a zone', async () => {
        const { captured } = respondWith(PLANT_PAYLOAD);

        await scanGardenPhoto(
            {
                imageDataUrl: IMAGE,
                mode: 'plant',
                season: 'Été',
                zoneContext: { name: 'Potager du fond', zoneType: 'Potager', sunExposure: 'Ombre' },
            },
            { userId: USER },
        );

        const parts = captured[0].messages[1].content as Array<{ type: string; text?: string }>;
        const text = parts.find((p) => p.type === 'text')?.text ?? '';
        expect(text).toContain('Potager du fond');
        expect(text).toContain('Ombre');
    });

    it('ignores a `plants` array in plant mode — only the singular `plant` counts', async () => {
        respondWith({
            ...PLANT_PAYLOAD,
            plants: [{ name: 'Courgette', plant_type: 'Légume', health_status: 'En bonne santé' }],
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.plants.map((p) => p.name)).toEqual(['Tomate']);
    });

    it('rejects a non-image data URL before spending a token', async () => {
        const { chat } = respondWith(PLANT_PAYLOAD);

        await expect(
            scanGardenPhoto(
                { imageDataUrl: 'https://example.com/leaf.jpg', mode: 'plant', season: 'Été' },
                { userId: USER },
            ),
        ).rejects.toThrow(AiError);
        expect(chat).not.toHaveBeenCalled();
    });
});

describe('scanGardenPhoto — zone mode', () => {
    const ZONE_PAYLOAD = {
        detected: true,
        confidence: 'medium',
        zone: {
            name: 'Potager du fond',
            zone_type: 'Potager',
            sun_exposure: 'Plein soleil',
            notes: 'Rangs bien tenus, quelques adventices entre les plants.',
        },
        plants: [
            {
                name: 'Tomate',
                plant_type: 'Légume',
                variety: null,
                health_status: 'En bonne santé',
                watering_frequency_days: 2,
            },
            {
                name: 'Basilic',
                plant_type: 'Aromatique',
                variety: null,
                health_status: 'En bonne santé',
                watering_frequency_days: 1,
            },
        ],
        observation: { notes: 'Zone globalement saine.', health_status: 'En bonne santé' },
        care: [
            {
                care_type: 'Désherbage',
                title: 'Désherber entre les rangs',
                due_in_days: 3,
                recurrence_days: 14,
                notes: null,
            },
        ],
        warnings: ['Cadrage large, identification des plants du fond incertaine'],
    };

    it('maps a zone, its plants and its care tasks', async () => {
        respondWith(ZONE_PAYLOAD);

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'zone', season: 'Printemps' },
            { userId: USER },
        );

        expect(scan.zone).toMatchObject({
            name: 'Potager du fond',
            zone_type: 'Potager',
            sun_exposure: 'Plein soleil',
        });
        expect(scan.plants.map((p) => p.name)).toEqual(['Tomate', 'Basilic']);
        expect(scan.care[0]).toMatchObject({ care_type: 'Désherbage', recurrence_days: 14 });
        expect(scan.warnings).toHaveLength(1);
    });

    it('caps plants at 8 and care tasks at 4', async () => {
        respondWith({
            ...ZONE_PAYLOAD,
            plants: Array.from({ length: 12 }, (_, i) => ({
                name: `Plante ${i}`,
                plant_type: 'Fleur',
                health_status: 'En bonne santé',
            })),
            care: Array.from({ length: 9 }, (_, i) => ({
                care_type: 'Arrosage',
                title: `Arroser ${i}`,
                due_in_days: i,
            })),
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'zone', season: 'Été' },
            { userId: USER },
        );

        expect(scan.plants).toHaveLength(8);
        expect(scan.care).toHaveLength(4);
    });
});

describe('scanGardenPhoto — sanitising a hostile model', () => {
    it('drops care tasks whose care_type is not a known enum value', async () => {
        respondWith({
            ...PLANT_PAYLOAD,
            care: [
                { care_type: 'Bêchage lunaire', title: 'Bêcher', due_in_days: 0 },
                { care_type: 'Arrosage', title: 'Arroser au pied', due_in_days: 0 },
            ],
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        // An invented care_type would land in the DB as a value no filter can
        // ever select again — it's dropped, not coerced.
        expect(scan.care.map((c) => c.care_type)).toEqual(['Arrosage']);
    });

    it('falls back to "Autre" on an unknown plant_type and zone_type', async () => {
        respondWith({
            detected: true,
            confidence: 'high',
            zone: { name: 'Zone', zone_type: 'Jardin japonais', sun_exposure: 'Crépusculaire' },
            plants: [{ name: 'Bonsaï', plant_type: 'Arbre nain', health_status: 'Radieux' }],
            care: [],
            observation: null,
            warnings: [],
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'zone', season: 'Hiver' },
            { userId: USER },
        );

        expect(scan.zone?.zone_type).toBe('Autre');
        expect(scan.zone?.sun_exposure).toBeNull();
        expect(scan.plants[0].plant_type).toBe('Autre');
        expect(scan.plants[0].health_status).toBe('En bonne santé');
    });

    it('clamps out-of-range numbers instead of trusting them', async () => {
        respondWith({
            ...PLANT_PAYLOAD,
            plant: { ...PLANT_PAYLOAD.plant, watering_frequency_days: 900 },
            observation: { ...PLANT_PAYLOAD.observation, height_cm: -5 },
            care: [
                {
                    care_type: 'Arrosage',
                    title: 'Arroser',
                    due_in_days: 99_999,
                    recurrence_days: 0,
                },
            ],
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.plants[0].watering_frequency_days).toBeNull();
        expect(scan.observation?.height_cm).toBeNull();
        expect(scan.care[0].due_in_days).toBe(0); // out of range → today, never a bogus date
        expect(scan.care[0].recurrence_days).toBeNull();
    });

    it('reports detected=false when nothing usable survives sanitising', async () => {
        respondWith({
            detected: true, // the model claims a hit…
            confidence: 'low',
            plant: { name: '' }, // …but there is nothing to keep
            care: [],
            observation: null,
            warnings: ['Photo trop sombre'],
        });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.detected).toBe(false);
        expect(scan.plants).toHaveLength(0);
        expect(scan.warnings).toEqual(['Photo trop sombre']);
    });

    it('honours an explicit detected=false even if fields are present', async () => {
        respondWith({ ...PLANT_PAYLOAD, detected: false });

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.detected).toBe(false);
    });

    it('throws BAD_JSON when the response is not JSON at all', async () => {
        respondWith('je ne peux pas analyser cette image');

        await expect(
            scanGardenPhoto(
                { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
                { userId: USER },
            ),
        ).rejects.toMatchObject({ code: 'BAD_JSON' });
    });

    it('tolerates markdown fences around the JSON', async () => {
        respondWith('```json\n' + JSON.stringify(PLANT_PAYLOAD) + '\n```');

        const { scan } = await scanGardenPhoto(
            { imageDataUrl: IMAGE, mode: 'plant', season: 'Été' },
            { userId: USER },
        );

        expect(scan.plants[0].name).toBe('Tomate');
    });
});
