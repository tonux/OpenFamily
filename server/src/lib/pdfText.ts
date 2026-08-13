// =============================================================================
// PDF text extraction
//
// Bank statements arrive as PDFs. Almost every issuer (Desjardins, Tangerine,
// RBC, BNP, Société Générale…) generates them from a text template, so the
// text layer is present and exact — no OCR, no vision model, no guessing at
// digits. We pull that layer out here and hand plain text to the AI layer.
//
// Deliberate non-goal: scanned / photographed statements. A PDF with no text
// layer is rejected with a clear message rather than silently falling back to
// an expensive and less reliable vision pass. If that need shows up, the entry
// point is `extractPdfText` returning `hasTextLayer: false` — the caller can
// branch there without touching the rest of the pipeline.
//
// `pdf-parse` is imported from its lib entrypoint on purpose: the package's
// index.js runs a bundled demo file when it thinks it is the main module,
// which breaks under ts-node and in some bundlers. The lib entrypoint is the
// pure function.
// =============================================================================

import { createHash } from 'crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface PdfTextResult {
    /** Full extracted text, newline-separated, whitespace-normalized. */
    text: string;
    pageCount: number;
    /** False when the PDF carries no usable text layer (scan / photo). */
    hasTextLayer: boolean;
    /** sha256 of the normalized text — the statement dedup key. */
    contentHash: string;
}

export class PdfExtractionError extends Error {
    readonly code: 'NO_TEXT_LAYER' | 'CORRUPT_PDF' | 'EMPTY_PDF';

    constructor(code: PdfExtractionError['code'], message: string) {
        super(message);
        this.name = 'PdfExtractionError';
        this.code = code;
    }
}

// A statement page has, at minimum, a few dozen characters of real content.
// Below this the "text layer" is typically just the producer metadata that
// scanners embed, which would send garbage to the model.
const MIN_CHARS_PER_PAGE = 40;

/**
 * Collapse the ragged whitespace PDF extractors produce.
 *
 * Two things matter downstream: line boundaries must survive (the model reads
 * one transaction per line), and runs of spaces used for column alignment must
 * collapse (they inflate the token count by 30-40% on a statement).
 */
export const normalizePdfText = (raw: string): string =>
    raw
        .replace(/\r\n?/g, '\n')
        // Non-breaking and thin spaces are common in FR/CA amount formatting
        // ("1 080,72"); turn them into plain spaces before collapsing runs.
        .replace(/[   ]/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n');

export const hashText = (text: string): string =>
    createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Extract the text layer from a PDF buffer.
 *
 * Throws PdfExtractionError rather than returning a partial result, so the
 * route can map each code to its own user-facing message.
 */
export const extractPdfText = async (buffer: Buffer): Promise<PdfTextResult> => {
    if (!buffer || buffer.length === 0) {
        throw new PdfExtractionError('EMPTY_PDF', 'Le fichier PDF est vide.');
    }

    let parsed: { text?: string; numpages?: number };
    try {
        parsed = await pdfParse(buffer);
    } catch (error) {
        throw new PdfExtractionError(
            'CORRUPT_PDF',
            `Le PDF n'a pas pu être lu : ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const pageCount =
        typeof parsed.numpages === 'number' && parsed.numpages > 0 ? parsed.numpages : 1;
    const text = normalizePdfText(parsed.text ?? '');
    const hasTextLayer = text.length >= MIN_CHARS_PER_PAGE * Math.min(pageCount, 4);

    if (!hasTextLayer) {
        throw new PdfExtractionError(
            'NO_TEXT_LAYER',
            "Ce PDF ne contient pas de couche texte — il s'agit probablement d'un scan ou d'une photo. " +
                'Télécharge le relevé original depuis le site de ta banque.',
        );
    }

    return { text, pageCount, hasTextLayer, contentHash: hashText(text) };
};

/**
 * Split a statement into chunks small enough to fit one model call each.
 *
 * Chunking is by line, never mid-line: a transaction that straddled a boundary
 * would be read twice or lost. `maxChars` is a character budget rather than a
 * token count because we do not ship a tokenizer server-side; ~4 chars/token
 * is a safe ratio for French statement text, so 6000 chars ≈ 1500 tokens in,
 * which leaves ample room in the completion budget for the JSON out.
 *
 * `overlapLines` repeats the tail of the previous chunk at the head of the
 * next one. Deduplication downstream removes the repeats; the point is that a
 * transaction is never invisible because it sat at a seam.
 */
export const chunkStatementText = (text: string, maxChars = 6000, overlapLines = 2): string[] => {
    const lines = text.split('\n');
    const chunks: string[] = [];
    let current: string[] = [];
    let size = 0;

    for (const line of lines) {
        // +1 for the newline we will re-join with.
        if (size + line.length + 1 > maxChars && current.length > 0) {
            chunks.push(current.join('\n'));
            const tail = overlapLines > 0 ? current.slice(-overlapLines) : [];
            current = [...tail];
            size = current.reduce((acc, l) => acc + l.length + 1, 0);
        }
        current.push(line);
        size += line.length + 1;
    }

    if (current.length > 0) {
        chunks.push(current.join('\n'));
    }

    return chunks;
};
