import type { AgentUserConfig } from '#/config';
import { bearerHeader } from './utils';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const REASONING_MODES = ['pro'] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export type ReasoningMode = typeof REASONING_MODES[number];

export interface OpenRouterModelReasoning {
    supportedEfforts: ReasoningEffort[] | null;
    defaultEffort: ReasoningEffort | null;
    defaultEnabled: boolean | null;
    mandatory: boolean;
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
    return (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isReasoningMode(value: string): value is ReasoningMode {
    return (REASONING_MODES as readonly string[]).includes(value);
}

export function isOpenRouterBase(base: string): boolean {
    try {
        return new URL(base).hostname === 'openrouter.ai';
    } catch {
        return false;
    }
}

export function supportsOpenRouterProMode(model: string): boolean {
    const normalizedModel = model.replace(/^~/, '');
    if (normalizedModel === 'openai/gpt-latest') {
        return true;
    }
    const version = normalizedModel.match(/^openai\/gpt-(\d+)\.(\d+)/);
    if (!version) {
        return false;
    }
    const major = Number.parseInt(version[1], 10);
    const minor = Number.parseInt(version[2], 10);
    return major > 5 || (major === 5 && minor >= 6);
}

// 将群级设置合并到环境变量 OPENAI_API_EXTRA_PARAMS 中已有的 reasoning 配置。
// 未设置群级值时完全保留环境变量行为；设置后不回传思考过程到 Telegram。
export function buildOpenRouterReasoning(
    extraParams: Record<string, any> | undefined,
    effort: string,
    mode: string,
): Record<string, any> | undefined {
    const reasoning = isRecord(extraParams?.reasoning) ? { ...extraParams.reasoning } : {};
    let overridden = false;

    if (isReasoningEffort(effort)) {
        reasoning.effort = effort;
        overridden = true;
    }
    if (isReasoningMode(mode)) {
        reasoning.mode = mode;
        overridden = true;
    }
    if (overridden) {
        reasoning.exclude = true;
    }
    return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

export async function loadOpenRouterModelReasoning(context: Pick<AgentUserConfig, 'OPENAI_API_BASE' | 'OPENAI_API_KEY' | 'OPENAI_CHAT_MODEL'>): Promise<OpenRouterModelReasoning | null> {
    const base = context.OPENAI_API_BASE.replace(/\/+$/, '');
    const apiKey = Array.isArray(context.OPENAI_API_KEY) ? context.OPENAI_API_KEY.at(0) || null : null;
    const response = await fetch(`${base}/models`, {
        headers: bearerHeader(apiKey),
    });
    if (!response.ok) {
        throw new Error(`OpenRouter 模型目录请求失败：HTTP ${response.status}`);
    }

    const payload = await response.json() as any;
    const currentModel = context.OPENAI_CHAT_MODEL.replace(/^~/, '');
    const model = Array.isArray(payload?.data)
        ? payload.data.find((item: any) => item?.id === context.OPENAI_CHAT_MODEL || item?.id === currentModel)
        : null;
    if (!isRecord(model?.reasoning)) {
        return null;
    }

    const rawEfforts = model.reasoning.supported_efforts;
    const supportedEfforts = Array.isArray(rawEfforts)
        ? rawEfforts.filter((item: unknown): item is ReasoningEffort => typeof item === 'string' && isReasoningEffort(item))
        : null;
    const defaultEffort = typeof model.reasoning.default_effort === 'string' && isReasoningEffort(model.reasoning.default_effort)
        ? model.reasoning.default_effort
        : null;
    return {
        supportedEfforts,
        defaultEffort,
        defaultEnabled: typeof model.reasoning.default_enabled === 'boolean' ? model.reasoning.default_enabled : null,
        mandatory: model.reasoning.mandatory === true,
    };
}
