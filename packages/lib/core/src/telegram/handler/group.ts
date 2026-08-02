import type { UserMessageItem } from '#/agent';
import type { WorkerContext } from '#/config';
import type * as Telegram from 'telegram-bot-api-types';
import { appendHistoryItems } from '#/agent';
import type { MessageHandler } from './types';
import { createTelegramBotAPI } from '../api';
import { isGroupChat } from '../auth';

const DIRECT_GROUP_COMMANDS = new Set(['/ask', '/askclean', '/reset', '/model', '/help', '/start']);

function entitiesContainCommand(entities: Telegram.MessageEntity[] | undefined): boolean {
    return entities?.some(entity => entity.type === 'bot_command') ?? false;
}

function containsDirectGroupCommand(content: string, entities: Telegram.MessageEntity[] | undefined): boolean {
    return entities?.some((entity) => {
        if (entity.type !== 'bot_command') {
            return false;
        }
        const command = content.slice(entity.offset, entity.offset + entity.length);
        return DIRECT_GROUP_COMMANDS.has(command);
    }) ?? false;
}

function containsMentionCandidate(content: string, entities: Telegram.MessageEntity[] | undefined): boolean {
    return entities?.some((entity) => {
        if (entity.type === 'mention' || entity.type === 'text_mention') {
            return true;
        }
        if (entity.type !== 'bot_command') {
            return false;
        }
        const command = content.slice(entity.offset, entity.offset + entity.length);
        return command.includes('@');
    }) ?? false;
}

function displayName(user: Telegram.User): string {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return name || user.username || `${user.id}`;
}

function createGroupContextItem(message: Telegram.Message): UserMessageItem | null {
    const text = (message.text || message.caption || '').trim();
    const user = message.from;
    if (
        !text
        || !user
        || user.is_bot
        || entitiesContainCommand(message.entities)
        || entitiesContainCommand(message.caption_entities)
    ) {
        return null;
    }
    return {
        role: 'user',
        content: `[群聊记录｜${displayName(user)}] ${text}`,
    };
}

async function saveBackgroundGroupMessage(message: Telegram.Message, context: WorkerContext): Promise<Response> {
    const item = createGroupContextItem(message);
    if (item) {
        await appendHistoryItems(context.SHARE_CONTEXT.chatHistoryKey, [item]);
    }
    // Telegram 只需要一个成功状态；不进入后续的命令或 LLM 处理器。
    return new Response(null, { status: 204 });
}

function checkMention(content: string, entities: Telegram.MessageEntity[], botName: string, botId: number): {
    isMention: boolean;
    content: string;
} {
    let isMention = false;
    for (const entity of entities) {
        const entityStr = content.slice(entity.offset, entity.offset + entity.length);
        switch (entity.type) {
            case 'mention': // "mention"适用于有用户名的普通用户
                if (entityStr === `@${botName}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'text_mention': // "text_mention"适用于没有用户名的用户或需要通过ID提及用户的情况
                if (`${entity.user?.id}` === `${botId}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'bot_command': // "bot_command"适用于命令
                if (entityStr.endsWith(`@${botName}`)) {
                    isMention = true;
                    const newEntityStr = entityStr.replace(`@${botName}`, '');
                    content = content.slice(0, entity.offset) + newEntityStr + content.slice(entity.offset + entity.length);
                }
                break;
            default:
                break;
        }
    }
    return {
        isMention,
        content,
    };
}

export class GroupMention implements MessageHandler {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        // 非群组消息不作判断，交给下一个中间件处理
        if (!isGroupChat(message.chat.type)) {
            return null;
        }

        // 处理回复消息, 如果回复的是当前机器人的消息交给下一个中间件处理
        const replyMe = `${message.reply_to_message?.from?.id}` === `${context.SHARE_CONTEXT.botId}`;
        if (replyMe) {
            return null;
        }

        let isMention = false;
        let needBotName = false;
        // 检查text中是否有机器人的提及
        if (message.text && message.entities) {
            const originalText = message.text;
            isMention = containsDirectGroupCommand(originalText, message.entities);
            needBotName = containsMentionCandidate(originalText, message.entities);
        }
        // 检查caption中是否有机器人的提及
        if (message.caption && message.caption_entities) {
            isMention = containsDirectGroupCommand(message.caption, message.caption_entities) || isMention;
            needBotName = containsMentionCandidate(message.caption, message.caption_entities) || needBotName;
        }

        // 对普通消息无需请求 Telegram 的 getMe 接口。只有可能包含 @机器人或带用户名命令时才解析机器人名称。
        if (needBotName) {
            let botName = context.SHARE_CONTEXT.botName;
            if (!botName) {
                const res = await createTelegramBotAPI(context.SHARE_CONTEXT.botToken).getMeWithReturns();
                botName = res.result.username || null;
                context.SHARE_CONTEXT.botName = botName;
            }
            if (!botName) {
                throw new Error('Not set bot name');
            }
            if (message.text && message.entities) {
                const res = checkMention(message.text, message.entities, botName, context.SHARE_CONTEXT.botId);
                isMention = res.isMention || isMention;
                message.text = res.content.trim();
            }
            if (message.caption && message.caption_entities) {
                const res = checkMention(message.caption, message.caption_entities, botName, context.SHARE_CONTEXT.botId);
                isMention = res.isMention || isMention;
                message.caption = res.content.trim();
            }
        }
        if (!isMention) {
            return saveBackgroundGroupMessage(message, context);
        }

        return null;
    };
}
