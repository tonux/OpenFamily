// =============================================================================
// Provider interface
//
// All concrete providers (Nvidia today, OpenAI / Anthropic / Mistral later)
// implement this contract. The shapes mirror OpenAI's chat completion API
// because every modern LLM endpoint speaks that dialect — keeping the surface
// minimal lets us swap providers via a single env var.
// =============================================================================

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

/**
 * Multimodal content parts (OpenAI / NVIDIA OpenAI-compatible format). A user
 * message can carry an image alongside text by setting `content` to an array:
 *     [{ type: 'text', text: '...' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }]
 * Text-only messages keep `content` as a plain string (simpler call sites).
 */
export type ChatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
    role: ChatRole;
    content: string | null | ChatContentPart[];
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** Force the model to emit valid JSON in its response (OpenAI `response_format: json_object`). */
    jsonMode?: boolean;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
    /** User id for logging / quota accounting. Never sent to the provider. */
    userId: string;
    /** Logical feature name for accounting (e.g. "shopping.classify"). */
    feature: string;
}

export interface ChatUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ChatResponse {
    content: string | null;
    toolCalls: ToolCall[];
    usage: ChatUsage;
    finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';
    model: string;
    latencyMs: number;
}

export interface ProviderHealth {
    ok: boolean;
    provider: string;
    model: string;
    latencyMs: number;
    detail?: string;
}

export interface BaseProvider {
    /** Display name (e.g. "nvidia"). */
    readonly name: string;

    /** Single non-streaming chat completion. */
    chat(req: ChatRequest): Promise<ChatResponse>;

    /** Lightweight liveness check (e.g. a 1-token completion). */
    health(): Promise<ProviderHealth>;
}
