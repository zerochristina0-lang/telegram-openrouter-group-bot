import type { UserMessageItem } from '#/agent';
import type { WorkerContext } from '#/config';
import type * as Telegram from 'telegram-bot-api-types';
import type { MessageHandler } from './handler/types';
import { ENV } from '#/config';
import { chatWithCleanMessage, chatWithMessage } from './chat';
import { MessageSender } from './sender';

const PENDING_ASK_INPUT_TTL_SECONDS = 5 * 60;

type AskInputMode = 'normal' | 'clean';

interface PendingAskInput {
    userId: number;
    mode: AskInputMode;
}

function pendingAskInputKey(context: WorkerContext): string {
    return `pending_ask_input:${context.SHARE_CONTEXT.chatHistoryKey}`;
}

function messageText(message: Telegram.Message): string {
    return (message.text || message.caption || '').trim();
}

function containsBotCommand(message: Telegram.Message): boolean {
    return message.entities?.some(entity => entity.type === 'bot_command')
        || message.caption_entities?.some(entity => entity.type === 'bot_command')
        || false;
}

async function loadPendingAskInput(context: WorkerContext): Promise<PendingAskInput | null> {
    const raw = await ENV.DATABASE.get(pendingAskInputKey(context));
    if (!raw) {
        return null;
    }
    try {
        const value = JSON.parse(raw) as PendingAskInput;
        if (typeof value.userId !== 'number' || (value.mode !== 'normal' && value.mode !== 'clean')) {
            return null;
        }
        return value;
    } catch (e) {
        console.warn('Invalid pending ask input', e);
        return null;
    }
}

export async function clearPendingAskInput(context: WorkerContext): Promise<void> {
    await ENV.DATABASE.delete(pendingAskInputKey(context));
}

export async function beginPendingAskInput(message: Telegram.Message, context: WorkerContext, mode: AskInputMode): Promise<Response> {
    const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
    const userId = message.from?.id;
    if (!userId) {
        return sender.sendPlainText('无法识别提问者，请直接使用：/ask 你的问题');
    }

    await ENV.DATABASE.put(
        pendingAskInputKey(context),
        JSON.stringify({ userId, mode } satisfies PendingAskInput),
        { expirationTtl: PENDING_ASK_INPUT_TTL_SECONDS },
    );

    const text = mode === 'clean'
        ? '请直接发送文字问题（5 分钟内有效）。\n本次将不附加系统提示词或会话上下文。\n发送 /cancel 可取消。'
        : '请直接发送你的文字问题（5 分钟内有效）。\n发送 /cancel 可取消。';
    const params: Telegram.SendMessageParams = {
        chat_id: message.chat.id,
        text,
        reply_markup: {
            force_reply: true,
            input_field_placeholder: '输入想问的问题…',
            selective: true,
        },
    };
    if (sender.context.reply_to_message_id) {
        params.reply_parameters = {
            message_id: sender.context.reply_to_message_id,
            chat_id: sender.context.chat_id,
            allow_sending_without_reply: sender.context.allow_sending_without_reply || undefined,
        };
    }
    return sender.sendRawMessage(params);
}

export class PendingAskInputHandler implements MessageHandler {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        // 命令仍然交由正常的命令处理器执行，尤其是 /cancel。
        if (containsBotCommand(message)) {
            return null;
        }
        const text = messageText(message);
        const userId = message.from?.id;
        if (!text || !userId) {
            return null;
        }
        const pending = await loadPendingAskInput(context);
        if (!pending || pending.userId !== userId) {
            return null;
        }

        // 在调用模型前先清掉状态，避免网络重试或连续消息被重复当作同一个问题。
        await clearPendingAskInput(context);
        const params: UserMessageItem = {
            role: 'user',
            content: text,
        };
        if (pending.mode === 'clean') {
            return chatWithCleanMessage(message, params, context);
        }
        return chatWithMessage(message, params, context, null);
    };
}
