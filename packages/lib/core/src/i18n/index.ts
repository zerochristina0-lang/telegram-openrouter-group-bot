import en from './en';
import pt from './pt';
import zhHans from './zh-hans';
import zhHant from './zh-hant';

interface HelpI18n {
    summary: string;
    help: string;
    new: string;
    start: string;
    img: string;
    version: string;
    setenv: string;
    setenvs: string;
    delenv: string;
    system: string;
    redo: string;
    models: string;
    echo: string;
}

export interface I18n {
    env: {
        system_init_message: string;
    };
    command: {
        help: HelpI18n & Record<string, string>;
        new: {
            new_chat_start: string;
        };
    };
    callback_query: {
        open_model_list: string;
        select_provider: string;
        select_model: string;
        change_model: string;
    };
}

function withProjectCommands(i18n: I18n, descriptions: Record<string, string>): I18n {
    Object.assign(i18n.command.help, descriptions);
    return i18n;
}

export function loadI18n(lang?: string): I18n {
    switch (lang?.toLowerCase()) {
        case 'cn':
        case 'zh-cn':
        case 'zh-hans':
            return withProjectCommands(zhHans, {
                ask: '向 AI 提问；单独发送 /ask 后继续输入问题',
                askclean: '对照提问；不附加提示词或会话上下文',
                model: '查看、搜索或切换 OpenRouter 模型',
                think: '查看或设置思考程度',
                reset: '清空当前群会话',
                cancel: '取消等待输入',
            });
        case 'zh-tw':
        case 'zh-hk':
        case 'zh-mo':
        case 'zh-hant':
            return withProjectCommands(zhHant, {
                ask: '向 AI 提問；單獨發送 /ask 後繼續輸入問題',
                askclean: '對照提問；不附加提示詞或會話上下文',
                model: '檢視、搜尋或切換 OpenRouter 模型',
                think: '檢視或設定思考程度',
                reset: '清空目前群組會話',
                cancel: '取消等待輸入',
            });
        case 'pt':
        case 'pt-br':
            return withProjectCommands(pt, {
                ask: 'Pergunte à IA; envie /ask sozinho e escreva a pergunta em seguida',
                askclean: 'Comparação sem prompt ou contexto da conversa',
                model: 'Ver, pesquisar ou trocar o modelo OpenRouter',
                think: 'Ver ou definir o nível de raciocínio',
                reset: 'Limpar a conversa atual',
                cancel: 'Cancelar a espera por entrada',
            });
        case 'en':
        case 'en-us':
            return withProjectCommands(en, {
                ask: 'Ask AI; send /ask alone, then send your question',
                askclean: 'Comparison without prompt or conversation context',
                model: 'View, search, or switch the OpenRouter model',
                think: 'View or set reasoning effort',
                reset: 'Clear the current conversation',
                cancel: 'Cancel waiting for input',
            });
        default:
            return withProjectCommands(en, {
                ask: 'Ask AI; send /ask alone, then send your question',
                askclean: 'Comparison without prompt or conversation context',
                model: 'View, search, or switch the OpenRouter model',
                think: 'View or set reasoning effort',
                reset: 'Clear the current conversation',
                cancel: 'Cancel waiting for input',
            });
    }
}
