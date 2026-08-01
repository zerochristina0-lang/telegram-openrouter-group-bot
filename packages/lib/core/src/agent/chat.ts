import type { WorkerContext } from '#/config';
import type { ChatAgent, HistoryItem, HistoryModifier, LLMChatParams, UserMessageItem } from './types';
import { ENV } from '#/config';
import { extractTextContent } from './utils';

function tokensCounter(): (text: string) => number {
    return (text) => {
        return text.length;
    };
}

function trimHistory(list: HistoryItem[], initLength: number, maxLength: number, maxToken: number): HistoryItem[] {
    if (maxLength >= 0 && list.length > maxLength) {
        list = list.slice(list.length - maxLength);
    }
    if (maxToken > 0) {
        const counter = tokensCounter();
        let tokenLength = initLength;
        for (let i = list.length - 1; i >= 0; i--) {
            const historyItem = list[i];
            const length = historyItem.content ? counter(extractTextContent(historyItem)) : 0;
            if (!historyItem.content) {
                historyItem.content = '';
            }
            tokenLength += length;
            if (tokenLength > maxToken) {
                list = list.slice(i + 1);
                break;
            }
        }
    }
    return list;
}

async function loadHistory(key: string): Promise<HistoryItem[]> {
    // 加载历史记录
    let history = [];
    try {
        history = JSON.parse(await ENV.DATABASE.get(key));
    } catch (e) {
        console.error(e);
    }
    if (!history || !Array.isArray(history)) {
        history = [];
    }

    // 裁剪
    if (ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH > 0) {
        history = trimHistory(history, 0, ENV.MAX_HISTORY_LENGTH, ENV.MAX_TOKEN_LENGTH);
    }

    return history;
}

export type StreamResultHandler = (text: string) => Promise<any>;

export async function requestCompletionsFromLLM(params: UserMessageItem | null, context: WorkerContext, agent: ChatAgent, modifier: HistoryModifier | null, onStream: StreamResultHandler | null): Promise<string> {
    const historyDisable = ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH <= 0;
    const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
    if (!historyKey) {
        throw new Error('History key not found');
    }
    let history = await loadHistory(historyKey);
    if (modifier) {
        const modifierData = modifier(history, params || null);
        history = modifierData.history;
        params = modifierData.message;
    }
    if (!params) {
        throw new Error('Message is empty');
    }
    const llmParams: LLMChatParams = {
        prompt: context.USER_CONFIG.SYSTEM_INIT_MESSAGE || undefined,
        messages: [...history, params],
    };
    const { text, responses } = await agent.request(llmParams, context.USER_CONFIG, onStream);
    if (!historyDisable) {
        const editParams = { ...params };
        if (ENV.HISTORY_IMAGE_PLACEHOLDER) {
            if (Array.isArray(editParams.content)) {
                const imageCount = editParams.content.filter(i => i.type === 'image').length;
                const textContent = editParams.content.findLast(i => i.type === 'text');
                if (textContent) {
                    editParams.content = editParams.content.filter(i => i.type !== 'image');
                    textContent.text = textContent.text + ` ${ENV.HISTORY_IMAGE_PLACEHOLDER}`.repeat(imageCount);
                }
            }
        }
        const nextHistory = trimHistory(
            [...history, editParams, ...responses],
            0,
            ENV.MAX_HISTORY_LENGTH,
            ENV.MAX_TOKEN_LENGTH,
        );
        await ENV.DATABASE.put(historyKey, JSON.stringify(nextHistory), {
            expirationTtl: ENV.SESSION_TTL_SECONDS,
        }).catch(console.error);
    }
    return text;
}
