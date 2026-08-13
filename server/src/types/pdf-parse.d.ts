// Minimal ambient declaration for pdf-parse.
//
// The package ships no types, and @types/pdf-parse pulls in a stale pdfjs
// dependency tree we do not want. We only ever call the default export with a
// Buffer and read two fields off the result, so the surface below is the whole
// contract as far as this codebase is concerned.
//
// The `/lib/pdf-parse.js` entrypoint (rather than the package root) is
// deliberate: the root index.js executes a bundled demo PDF when it believes
// it is the main module, which breaks under tsx and some bundlers.
declare module 'pdf-parse/lib/pdf-parse.js' {
    interface PdfParseResult {
        numpages: number;
        numrender: number;
        info: Record<string, unknown>;
        metadata: unknown;
        version: string;
        text: string;
    }
    function pdfParse(
        dataBuffer: Buffer,
        options?: Record<string, unknown>,
    ): Promise<PdfParseResult>;
    export = pdfParse;
}
