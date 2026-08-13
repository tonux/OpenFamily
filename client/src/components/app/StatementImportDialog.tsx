import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    FileText,
    Upload,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    X as CloseIcon,
} from 'lucide-react';
import { Button, Dialog } from '../ui';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// StatementImportDialog
//
// Upload a statement PDF, watch it parse, hand the result to the parent for
// review. Deliberately does NOT show the extracted transactions itself: the
// review table is a full-width surface with inline editing, and cramming it
// into an upload modal would make both worse.
//
// XMLHttpRequest rather than fetch, for the same reason ReceiptScanDialog uses
// it: upload progress. A statement parse takes 10-30 seconds (several model
// calls, one per chunk), which is long enough that a silent spinner reads as a
// hang. The progress bar covers the upload; the indeterminate phase after it
// is labelled explicitly so the wait feels accounted for.
// =============================================================================

export interface ImportedStatement {
    id: string;
    issuer: string | null;
    account_label: string | null;
    card_last4: string | null;
    currency: string;
    statement_date: string | null;
    period_start: string | null;
    period_end: string | null;
    new_balance: number | null;
    minimum_due: number | null;
    due_date: string | null;
    total_purchases: number | null;
    reconciliation_delta: number | null;
    warnings: string[];
    transaction_count: number;
    pending_count: number;
    duplicate_count: number;
    ignored_count: number;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Fired once the PDF is parsed and staged; parent opens the review view. */
    onImported: (statementId: string) => void;
}

const MAX_SIZE_MB = 15;

type UploadErrorKind = 'http' | 'network' | 'abort';
interface UploadError extends Error {
    kind: UploadErrorKind;
    status?: number;
    code?: string;
    serverMessage?: string;
    existingStatementId?: string;
}

const uploadStatement = (
    file: File,
    onProgress: (percent: number) => void,
): Promise<ImportedStatement> =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/api/statements/import`);
        xhr.withCredentials = true;
        xhr.responseType = 'json';

        const fail = (kind: UploadErrorKind, extra: Partial<UploadError> = {}) =>
            reject(Object.assign(new Error(kind), { kind, ...extra }) as UploadError);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onerror = () => fail('network');
        xhr.onabort = () => fail('abort');
        xhr.onload = () => {
            const body = xhr.response as {
                success?: boolean;
                data?: { statement?: ImportedStatement } & Record<string, unknown>;
                error?: { code?: string; message?: string };
            } | null;

            if (xhr.status >= 200 && xhr.status < 300 && body?.data?.statement) {
                resolve(body.data.statement);
                return;
            }
            fail('http', {
                status: xhr.status,
                code: body?.error?.code,
                serverMessage: body?.error?.message,
                // 409 carries the id of the statement that already exists, so
                // the user can jump straight to it instead of being stuck.
                existingStatementId:
                    xhr.status === 409
                        ? ((body?.data as { statement?: { id?: string } } | undefined)?.statement
                              ?.id ?? undefined)
                        : undefined,
            });
        };

        const form = new FormData();
        form.append('file', file);
        xhr.send(form);
    });

export const StatementImportDialog: React.FC<Props> = ({ open, onOpenChange, onImported }) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);
    const [phase, setPhase] = useState<'idle' | 'uploading' | 'parsing'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [duplicateId, setDuplicateId] = useState<string | null>(null);
    const [result, setResult] = useState<ImportedStatement | null>(null);

    useEffect(() => {
        if (!open) {
            setFile(null);
            setBusy(false);
            setProgress(0);
            setPhase('idle');
            setError(null);
            setDuplicateId(null);
            setResult(null);
        }
    }, [open]);

    const pick = (picked: File | null) => {
        setError(null);
        setDuplicateId(null);
        if (!picked) return;
        if (picked.type !== 'application/pdf') {
            setError(t('statements.import.error_type'));
            return;
        }
        if (picked.size > MAX_SIZE_MB * 1024 * 1024) {
            setError(t('statements.import.error_size', { max: MAX_SIZE_MB }));
            return;
        }
        setFile(picked);
    };

    const submit = async () => {
        if (!file) return;
        setBusy(true);
        setError(null);
        setDuplicateId(null);
        setProgress(0);
        setPhase('uploading');
        try {
            const statement = await uploadStatement(file, (p) => {
                setProgress(p);
                if (p >= 100) setPhase('parsing');
            });
            setResult(statement);
            setPhase('idle');
        } catch (err) {
            const e = err as UploadError;
            setPhase('idle');
            if (e.code === 'ALREADY_IMPORTED') {
                setDuplicateId(e.existingStatementId ?? null);
                setError(t('statements.import.error_duplicate'));
            } else if (e.kind === 'network') {
                setError(t('statements.import.error_network'));
            } else if (e.code === 'NO_TEXT_LAYER') {
                setError(t('statements.import.error_scan'));
            } else if (e.code === 'QUOTA_EXCEEDED') {
                setError(t('statements.import.error_quota'));
            } else {
                setError(e.serverMessage || t('statements.import.error_generic'));
            }
        } finally {
            setBusy(false);
        }
    };

    const money = (v: number | null, currency: string) =>
        v === null
            ? '—'
            : new Intl.NumberFormat('fr-CA', {
                  style: 'currency',
                  currency: currency || 'CAD',
                  maximumFractionDigits: 2,
              }).format(v);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={t('statements.import.title')}
            description={t('statements.import.description')}
        >
            <div className="space-y-4">
                {/* ---------------- result ---------------- */}
                {result ? (
                    <div className="space-y-4">
                        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                            <div className="text-sm">
                                <p className="font-medium">
                                    {t('statements.import.success_title', {
                                        count: result.transaction_count,
                                    })}
                                </p>
                                <p className="text-muted-foreground">
                                    {[result.issuer, result.account_label]
                                        .filter(Boolean)
                                        .join(' · ') || t('statements.unknown_issuer')}
                                    {result.card_last4 ? ` ····${result.card_last4}` : ''}
                                </p>
                            </div>
                        </div>

                        <dl className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <dt className="text-muted-foreground">
                                    {t('statements.fields.new_balance')}
                                </dt>
                                <dd className="font-semibold">
                                    {money(result.new_balance, result.currency)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    {t('statements.fields.due_date')}
                                </dt>
                                <dd className="font-semibold">{result.due_date ?? '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    {t('statements.import.to_review')}
                                </dt>
                                <dd className="font-semibold">{result.pending_count}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    {t('statements.import.auto_excluded')}
                                </dt>
                                <dd className="font-semibold">
                                    {result.ignored_count + result.duplicate_count}
                                </dd>
                            </div>
                        </dl>

                        {result.warnings?.length > 0 && (
                            <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                                {result.warnings.map((w, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                                        <span>{w}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => onOpenChange(false)}>
                                {t('common.close')}
                            </Button>
                            <Button onClick={() => onImported(result.id)}>
                                {t('statements.import.review_now')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* ---------------- picker ---------------- */
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={busy}
                            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/60 disabled:opacity-60"
                        >
                            {file ? (
                                <>
                                    <FileText className="h-8 w-8 text-primary" />
                                    <span className="text-sm font-medium">{file.name}</span>
                                    <span className="text-caption text-muted-foreground">
                                        {(file.size / 1024).toFixed(0)} Ko
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Upload className="h-8 w-8 text-muted-foreground" />
                                    <span className="text-sm font-medium">
                                        {t('statements.import.pick')}
                                    </span>
                                    <span className="text-caption text-muted-foreground">
                                        {t('statements.import.pick_hint', { max: MAX_SIZE_MB })}
                                    </span>
                                </>
                            )}
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            className="hidden"
                            onChange={(e) => pick(e.target.files?.[0] ?? null)}
                        />

                        {busy && (
                            <div className="space-y-2">
                                <div className="h-2 overflow-hidden rounded-pill bg-surface-2">
                                    <div
                                        className="h-full rounded-pill bg-primary transition-all"
                                        style={{
                                            width: phase === 'parsing' ? '100%' : `${progress}%`,
                                        }}
                                    />
                                </div>
                                <p className="flex items-center gap-2 text-caption text-muted-foreground">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {phase === 'parsing'
                                        ? t('statements.import.parsing')
                                        : t('statements.import.uploading', { percent: progress })}
                                </p>
                            </div>
                        )}

                        {error && (
                            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                                <div className="space-y-2">
                                    <p>{error}</p>
                                    {duplicateId && (
                                        <Button
                                            variant="secondary"
                                            onClick={() => onImported(duplicateId)}
                                        >
                                            {t('statements.import.open_existing')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => onOpenChange(false)}
                                disabled={busy}
                            >
                                <CloseIcon className="mr-2 h-4 w-4" />
                                {t('common.cancel')}
                            </Button>
                            <Button onClick={submit} disabled={!file || busy}>
                                {busy ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Upload className="mr-2 h-4 w-4" />
                                )}
                                {t('statements.import.submit')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </Dialog>
    );
};
