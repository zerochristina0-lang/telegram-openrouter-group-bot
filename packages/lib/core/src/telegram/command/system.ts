import type { HistoryItem, HistoryModifierResult, UserMessageItem } from '#/agent';
import type { AgentUserConfigKey, WorkerContext } from '#/config';
import type * as Telegram from 'telegram-bot-api-types';
import type { CommandHandler } from './types';
import { loadChatLLM, loadImageGen } from '#/agent';
import { isOpenRouterBase, isReasoningEffort, loadOpenRouterModelReasoning, REASONING_EFFORTS, supportsOpenRouterProMode } from '#/agent/reasoning';
import { ConfigMerger, ENV } from '#/config';
import { createTelegramBotAPI } from '../api';
import { isGroupChat, TELEGRAM_AUTH_CHECKER } from '../auth';
import { chatWithCleanMessage, chatWithMessage } from '../chat';
import { MessageSender } from '../sender';

export class ImgCommandHandler implements CommandHandler {
    command = '/img';
    scopes = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        if (subcommand === '') {
            const imgAgent = loadImageGen(context.USER_CONFIG);
            const text = `${ENV.I18N.command.help.img}\n\n${imgAgent?.name || 'Nan'} | ${imgAgent?.model(context.USER_CONFIG) || 'Nan'}`;
            const params: Telegram.SendMessageParams = {
                chat_id: message.chat.id,
                text,
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: ENV.I18N.callback_query.open_model_list,
                            callback_data: 'ial:',
                        },
                    ]],
                },
            };
            return sender.sendRawMessage(params);
        }
        try {
            const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
            const agent = loadImageGen(context.USER_CONFIG);
            if (!agent) {
                return sender.sendPlainText('ERROR: Image generator not found');
            }
            setTimeout(() => api.sendChatAction({
                chat_id: message.chat.id,
                action: 'upload_photo',
            }).catch(console.error), 0);
            const img = await agent.request(subcommand, context.USER_CONFIG);
            const resp = await sender.sendPhoto(img);
            if (!resp.ok) {
                return sender.sendPlainText(`ERROR: ${resp.statusText} ${await resp.text()}`);
            }
            return resp;
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class HelpCommandHandler implements CommandHandler {
    command = '/help';
    scopes = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        let helpMsg = `${ENV.I18N.command.help.summary}\n`;
        const availableCommands = new Set(['help', 'start', 'ask', 'askclean', 'reset', 'model', 'think']);
        for (const [k, v] of Object.entries(ENV.I18N.command.help)) {
            if (k === 'summary' || !availableCommands.has(k)) {
                continue;
            }
            helpMsg += `/${k}：${v}\n`;
        }
        for (const [k, v] of Object.entries(ENV.CUSTOM_COMMAND)) {
            if (v.description) {
                helpMsg += `${k}：${v.description}\n`;
            }
        }
        for (const [k, v] of Object.entries(ENV.PLUGINS_COMMAND)) {
            if (v.description) {
                helpMsg += `${k}：${v.description}\n`;
            }
        }
        return sender.sendPlainText(helpMsg);
    };
}

class BaseNewCommandHandler {
    static async handle(showID: boolean, message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> {
        await ENV.DATABASE.delete(context.SHARE_CONTEXT.chatHistoryKey);
        const text = ENV.I18N.command.new.new_chat_start + (showID ? `(${message.chat.id})` : '');
        const params: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            text,
        };
        if (ENV.SHOW_REPLY_BUTTON && !isGroupChat(message.chat.type)) {
            params.reply_markup = {
                keyboard: [[{ text: '/new' }, { text: '/redo' }]],
                selective: true,
                resize_keyboard: true,
                one_time_keyboard: false,
            };
        } else {
            params.reply_markup = {
                remove_keyboard: true,
                selective: true,
            };
        }
        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage(params);
    }
}

export class NewCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/new';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(false, message, subcommand, context);
    };
}

export class ResetCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/reset';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        await ENV.DATABASE.delete(context.SHARE_CONTEXT.lastMessageKey);
        return BaseNewCommandHandler.handle(false, message, subcommand, context);
    };
}

export class AskCommandHandler implements CommandHandler {
    command = '/ask';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        if (!subcommand) {
            return sender.sendPlainText('用法：/ask 你的问题');
        }
        return chatWithMessage(message, {
            role: 'user',
            content: subcommand,
        }, context, null);
    };
}

export class AskCleanCommandHandler implements CommandHandler {
    command = '/askclean';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        if (!subcommand) {
            return sender.sendPlainText('用法：/askclean 你的问题\n\n对照模式不会附加系统提示词或会话历史，也不会写入 Session。');
        }
        return chatWithCleanMessage(message, {
            role: 'user',
            content: subcommand,
        }, context);
    };
}

export class StartCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/start';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(true, message, subcommand, context);
    };
}

export class SetEnvCommandHandler implements CommandHandler {
    command = '/setenv';
    needAuth = TELEGRAM_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const kv = subcommand.indexOf('=');
        if (kv === -1) {
            return sender.sendPlainText(ENV.I18N.command.help.setenv);
        }
        const key = subcommand.slice(0, kv);
        const value = subcommand.slice(kv + 1);
        try {
            await context.execChangeAndSave({ [key]: value } as Record<AgentUserConfigKey, any>);
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class SetEnvsCommandHandler implements CommandHandler {
    command = '/setenvs';
    needAuth = TELEGRAM_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        try {
            const values = JSON.parse(subcommand);
            await context.execChangeAndSave(values);
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class DelEnvCommandHandler implements CommandHandler {
    command = '/delenv';
    needAuth = TELEGRAM_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        if (ENV.LOCK_USER_CONFIG_KEYS.includes(subcommand as AgentUserConfigKey)) {
            const msg = `Key ${subcommand} is locked`;
            return sender.sendPlainText(msg);
        }
        try {
            context.USER_CONFIG[subcommand] = null;
            context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(key => key !== subcommand);
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS)),
            );
            return sender.sendPlainText('Delete user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class ClearEnvCommandHandler implements CommandHandler {
    command = '/clearenv';
    needAuth = TELEGRAM_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        try {
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify({}),
            );
            return sender.sendPlainText('Clear user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
        ;
    };
}

export class VersionCommandHandler implements CommandHandler {
    command = '/version';
    scopes = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const current = {
            ts: ENV.BUILD_TIMESTAMP,
            sha: ENV.BUILD_VERSION,
        };
        try {
            const info = `https://raw.githubusercontent.com/TBXark/ChatGPT-Telegram-Workers/${ENV.UPDATE_BRANCH}/dist/buildinfo.json`;
            const online = await fetch(info).then(r => r.json()) as { ts: number; sha: string };
            const timeFormat = (ts: number): string => {
                return new Date(ts * 1000).toLocaleString('en-US', {});
            };
            if (current.ts < online.ts) {
                const text = `New version detected: ${online.sha}(${timeFormat(online.ts)})\nCurrent version: ${current.sha}(${timeFormat(current.ts)})`;
                return sender.sendPlainText(text);
            } else {
                const text = `Current version: ${current.sha}(${timeFormat(current.ts)}) is up to date`;
                return sender.sendPlainText(text);
            }
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class SystemCommandHandler implements CommandHandler {
    command = '/system';
    scopes = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const chatAgent = loadChatLLM(context.USER_CONFIG);
        const imageAgent = loadImageGen(context.USER_CONFIG);
        const agent = {
            AI_PROVIDER: chatAgent?.name,
            [chatAgent?.modelKey || 'AI_PROVIDER_NOT_FOUND']: chatAgent?.model(context.USER_CONFIG),
            AI_IMAGE_PROVIDER: imageAgent?.name,
            [imageAgent?.modelKey || 'AI_IMAGE_PROVIDER_NOT_FOUND']: imageAgent?.model(context.USER_CONFIG),
        };
        let msg = `<strong>AGENT</strong><pre>${JSON.stringify(agent, null, 2)}</pre>`;
        if (ENV.DEV_MODE) {
            const config = ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS);
            msg += `\n\n<strong>USER_CONFIG</strong><pre>${JSON.stringify(config, null, 2)}</pre>`;

            const secretsSuffix = ['_API_KEY', '_TOKEN', '_ACCOUNT_ID'];
            for (const key of Object.keys(context.USER_CONFIG)) {
                if (secretsSuffix.some(suffix => key.endsWith(suffix))) {
                    context.USER_CONFIG[key] = '******';
                }
            }
            msg += `\n\n<strong>CHAT_CONTEXT</strong><pre>${JSON.stringify(sender.context || {}, null, 2)}</pre>`;

            const shareCtx = { ...context.SHARE_CONTEXT, botToken: '******' };
            msg += `\n\n<strong>SHARE_CONTEXT</strong><pre>${JSON.stringify(shareCtx, null, 2)}</pre>`;
        }
        return sender.sendRichText(msg, 'HTML');
    };
}

export class RedoCommandHandler implements CommandHandler {
    command = '/redo';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const mf = (history: HistoryItem[], message: UserMessageItem | null): HistoryModifierResult => {
            let nextMessage = message;
            if (!(history && Array.isArray(history) && history.length > 0)) {
                throw new Error('History not found');
            }
            const historyCopy = structuredClone(history);
            while (true) {
                const data = historyCopy.pop();
                if (data === undefined || data === null) {
                    break;
                } else if (data.role === 'user') {
                    nextMessage = data;
                    break;
                }
            }
            if (subcommand) {
                nextMessage = {
                    role: 'user',
                    content: subcommand,
                };
            }
            if (nextMessage === null) {
                throw new Error('Redo message not found');
            }
            return { history: historyCopy, message: nextMessage };
        };
        return chatWithMessage(message, null, context, mf);
    };
}

export class ModelsCommandHandler implements CommandHandler {
    command = '/models';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const chatAgent = loadChatLLM(context.USER_CONFIG);
        const text = `${chatAgent?.name || 'Nan'} | ${chatAgent?.model(context.USER_CONFIG) || 'Nan'}`;
        const params: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            text,
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: ENV.I18N.callback_query.open_model_list,
                        callback_data: 'al:',
                    },
                ]],
            },
        };
        return sender.sendRawMessage(params);
    };
}

export class ModelCommandHandler implements CommandHandler {
    command = '/model';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const model = subcommand.trim();
        if (!model) {
            return sender.sendPlainText(
                `当前模型：${context.USER_CONFIG.OPENAI_CHAT_MODEL}\n\n`
                + '用法：\n'
                + '/model <关键词>：搜索 OpenRouter 可用模型\n'
                + '/model <精确模型 ID>：切换模型\n\n'
                + '示例：/model gemini\n'
                + '示例：/model google/gemini-2.5-flash',
            );
        }

        const chatAgent = loadChatLLM(context.USER_CONFIG);
        if (!chatAgent) {
            return sender.sendPlainText('无法读取模型目录：未找到当前 AI Provider。');
        }

        try {
            const remoteModels = await chatAgent.modelList(context.USER_CONFIG);
            const models = [...new Set(remoteModels.filter(item => typeof item === 'string' && item.length > 0))]
                .sort((a, b) => a.localeCompare(b));

            // MODEL_ALLOW_LIST 只用于保留 OpenRouter latest 等别名的兼容性；
            // 常规模型完全以 Provider 返回的动态目录为准。
            if (models.includes(model) || ENV.MODEL_ALLOW_LIST.includes(model)) {
                await context.execChangeAndSave({
                    OPENAI_CHAT_MODEL: model,
                    // 不同模型支持的 reasoning 参数不同，切换模型后恢复为模型默认值。
                    OPENAI_REASONING_EFFORT: '',
                    OPENAI_REASONING_MODE: '',
                } as Record<AgentUserConfigKey, any>);
                return sender.sendPlainText(`当前模型已切换为：${model}\n思考设置已恢复为：自动（模型默认）`);
            }

            const keyword = model.toLocaleLowerCase();
            const matched = models.filter(item => item.toLocaleLowerCase().includes(keyword));
            if (matched.length === 0) {
                return sender.sendPlainText(
                    `未找到模型：${model}\n\n`
                    + '请用更短的关键词搜索，或从搜索结果中复制精确模型 ID 后再执行 /model。',
                );
            }

            const visible = matched.slice(0, 12);
            const suffix = matched.length > visible.length ? `\n\n还有 ${matched.length - visible.length} 个结果，请使用更具体的关键词。` : '';
            return sender.sendPlainText(
                `找到 ${matched.length} 个 OpenRouter 模型（展示前 ${visible.length} 个）：\n\n`
                + visible.join('\n')
                + `${suffix}\n\n复制精确模型 ID 后发送：\n/model <模型 ID>`,
            );
        } catch (e) {
            console.error(e);
            return sender.sendPlainText(
                `读取 OpenRouter 模型目录失败：${(e as Error).message}\n\n`
                + '请检查 OPENAI_API_BASE 和 OPENAI_API_KEY 是否仍为有效的 OpenRouter 配置。',
            );
        }
    };
}

function formatReasoningSetting(context: WorkerContext): string {
    const effort = context.USER_CONFIG.OPENAI_REASONING_EFFORT || '自动（模型默认）';
    const mode = context.USER_CONFIG.OPENAI_REASONING_MODE || 'standard';
    return `当前模型：${context.USER_CONFIG.OPENAI_CHAT_MODEL}\n思考程度：${effort}\n推理模式：${mode}`;
}

export class ThinkCommandHandler implements CommandHandler {
    command = '/think';
    scopes = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];

    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        const sender = MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message);
        const setting = subcommand.trim().toLowerCase();
        if (!setting) {
            return sender.sendPlainText(
                `${formatReasoningSetting(context)}\n\n`
                + '用法：\n'
                + '/think auto：恢复模型默认值\n'
                + `/think <程度>：${REASONING_EFFORTS.join('、')}\n`
                + '/think pro：启用 GPT-5.6+ 的 Pro 推理模式\n'
                + '/think standard：关闭 Pro 模式，保留当前思考程度\n\n'
                + '切换 /model 后会自动恢复为模型默认值。',
            );
        }

        if (!isOpenRouterBase(context.USER_CONFIG.OPENAI_API_BASE)) {
            return sender.sendPlainText('当前 /think 仅适用于 OpenRouter 的 OpenAI 兼容接口。');
        }

        if (setting === 'auto') {
            await context.execChangeAndSave({
                OPENAI_REASONING_EFFORT: '',
                OPENAI_REASONING_MODE: '',
            } as Record<AgentUserConfigKey, any>);
            return sender.sendPlainText(`${formatReasoningSetting(context)}\n\n已恢复为模型默认思考设置。`);
        }

        if (setting === 'standard') {
            await context.execChangeAndSave({ OPENAI_REASONING_MODE: '' } as Record<AgentUserConfigKey, any>);
            return sender.sendPlainText(`${formatReasoningSetting(context)}\n\n已关闭 Pro 推理模式。`);
        }

        if (setting === 'pro') {
            if (!supportsOpenRouterProMode(context.USER_CONFIG.OPENAI_CHAT_MODEL)) {
                return sender.sendPlainText('Pro 推理模式仅适用于 OpenRouter 上支持它的 OpenAI GPT-5.6 及更新模型。');
            }
            await context.execChangeAndSave({
                OPENAI_REASONING_EFFORT: context.USER_CONFIG.OPENAI_REASONING_EFFORT === 'none' ? '' : context.USER_CONFIG.OPENAI_REASONING_EFFORT,
                OPENAI_REASONING_MODE: 'pro',
            } as Record<AgentUserConfigKey, any>);
            return sender.sendPlainText(`${formatReasoningSetting(context)}\n\n已启用 Pro 推理模式。`);
        }

        if (!isReasoningEffort(setting)) {
            return sender.sendPlainText(`不支持的思考程度：${subcommand}\n\n可选：auto、standard、pro、${REASONING_EFFORTS.join('、')}`);
        }

        try {
            const capability = await loadOpenRouterModelReasoning(context.USER_CONFIG);
            if (!capability) {
                return sender.sendPlainText(`当前模型 ${context.USER_CONFIG.OPENAI_CHAT_MODEL} 未公开支持可调思考程度。`);
            }
            if (setting === 'none' && capability.mandatory) {
                return sender.sendPlainText(`当前模型 ${context.USER_CONFIG.OPENAI_CHAT_MODEL} 必须使用推理，不能设置为 none。`);
            }
            if (capability.supportedEfforts && !capability.supportedEfforts.includes(setting)) {
                return sender.sendPlainText(
                    `当前模型不支持 ${setting}。\n可选程度：${capability.supportedEfforts.join('、') || '无'}。`,
                );
            }
            await context.execChangeAndSave({
                OPENAI_REASONING_EFFORT: setting,
                OPENAI_REASONING_MODE: setting === 'none' ? '' : context.USER_CONFIG.OPENAI_REASONING_MODE,
            } as Record<AgentUserConfigKey, any>);
            return sender.sendPlainText(`${formatReasoningSetting(context)}\n\n已保存为当前群的思考设置。`);
        } catch (e) {
            console.error(e);
            return sender.sendPlainText(`无法读取 OpenRouter 模型能力：${(e as Error).message}`);
        }
    };
}

export class EchoCommandHandler implements CommandHandler {
    command = '/echo';
    handle = (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        let msg = '<pre>';
        msg += JSON.stringify({ message }, null, 2);
        msg += '</pre>';
        return MessageSender.fromMessage(context.SHARE_CONTEXT.botToken, message).sendRichText(msg, 'HTML');
    };
}
