import { describe, it, expect } from 'vitest';
import { normalizePdfText, chunkStatementText, hashText } from '../../src/lib/pdfText';

// =============================================================================
// Statement text preparation.
//
// Pure logic, no PDF and no model: everything here is about the two properties
// the rest of the import pipeline assumes and cannot recover from if broken.
//
//   1. No transaction line is ever lost at a chunk boundary. A dropped line is
//      silent — the user sees a statement that reconciles to the wrong total
//      with no error anywhere — so it is the failure worth pinning down.
//   2. A line that IS repeated across two chunks is repeated whole, because
//      the downstream deduplication matches on the full (date, description,
//      amount) triple and a half-line would slip through as a new transaction.
//
// The fixture mirrors the real Desjardins layout: "DD MM DD MM MERCHANT CITY
// QC R,RR % 1 234,56", amounts with a space thousands separator and a comma
// decimal, credits marked by a CR suffix.
// =============================================================================

const txLine = (day: string, month: string, merchant: string, amount: string) =>
    `${day} ${month} ${day} ${month} ${merchant} SAINT-LAMBERTQC 4,00 % ${amount}`;

const buildStatement = (lineCount: number): string => {
    const lines = [
        'DATE DU RELEVÉ 27 07 2026 REMISES WORLD ELITE MASTERCARD',
        'Page : 1 de 4',
        "Date de transaction Date d'inscription Description Remises Montant J M J M",
    ];
    for (let i = 0; i < lineCount; i += 1) {
        const day = String((i % 28) + 1).padStart(2, '0');
        lines.push(txLine(day, '07', `MARCHAND NUMERO ${i}`, `${i + 10},${(i % 99) + 1}`));
    }
    lines.push('16 07 16 07 PAIEMENT CAISSE 2 422,61CR');
    lines.push('TOTAL 5 825,51');
    return lines.join('\n');
};

describe('normalizePdfText', () => {
    it('collapses column-alignment runs without merging lines', () => {
        const raw = 'MAXI    ST-LAMBERT     19,30\r\nDOLLARAMA     23,18';
        expect(normalizePdfText(raw)).toBe('MAXI ST-LAMBERT 19,30\nDOLLARAMA 23,18');
    });

    it('turns non-breaking and thin spaces into plain spaces', () => {
        // FR/CA statements use U+00A0 and U+202F inside amounts ("1 080,72").
        const raw = 'IKEA BOUCHERVILLE 1 080,72\nJYSK 1 192,29';
        expect(normalizePdfText(raw)).toBe('IKEA BOUCHERVILLE 1 080,72\nJYSK 1 192,29');
    });

    it('drops blank lines and trims, so chunk budgets are not spent on padding', () => {
        expect(normalizePdfText('  A  \n\n\n   \n  B  ')).toBe('A\nB');
    });

    it('is stable, so the same PDF always yields the same content hash', () => {
        const a = normalizePdfText('MAXI   19,30\r\n\r\nDOLLARAMA  23,18');
        const b = normalizePdfText('MAXI 19,30\nDOLLARAMA 23,18');
        expect(hashText(a)).toBe(hashText(b));
    });
});

describe('chunkStatementText', () => {
    it('keeps every line intact — none is split across two chunks', () => {
        const text = buildStatement(120);
        const chunks = chunkStatementText(text, 1200);

        expect(chunks.length).toBeGreaterThan(1);
        for (const line of text.split('\n')) {
            expect(chunks.some((c) => c.includes(line))).toBe(true);
        }
    });

    it('repeats the seam lines rather than dropping them', () => {
        const text = buildStatement(120);
        const chunks = chunkStatementText(text, 1200, 2);
        const repeated = text
            .split('\n')
            .filter((line) => chunks.filter((c) => c.includes(line)).length > 1);

        // Two overlap lines per seam, and there is at least one seam.
        expect(repeated.length).toBeGreaterThanOrEqual(2 * (chunks.length - 1));
    });

    it('emits a single chunk when the statement fits the budget', () => {
        const text = buildStatement(5);
        expect(chunkStatementText(text, 6000)).toHaveLength(1);
    });

    it('respects the character budget except for lines longer than it', () => {
        const text = buildStatement(60);
        const chunks = chunkStatementText(text, 900);
        const longest = Math.max(...text.split('\n').map((l) => l.length));
        for (const chunk of chunks) {
            // A chunk may exceed the budget only by carrying one oversized line.
            expect(chunk.length).toBeLessThanOrEqual(900 + longest);
        }
    });

    it('never loops forever on a line longer than the whole budget', () => {
        const text = ['short', 'x'.repeat(5000), 'short again'].join('\n');
        const chunks = chunkStatementText(text, 100);
        expect(chunks.join('\n')).toContain('x'.repeat(5000));
        expect(chunks.length).toBeLessThan(10);
    });

    it('produces no empty chunk', () => {
        const chunks = chunkStatementText(buildStatement(80), 700);
        expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
    });
});
