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

function withThinkCommand(i18n: I18n, description: string): I18n {
    i18n.command.help.think = description;
    return i18n;
}

export function loadI18n(lang?: string): I18n {
    switch (lang?.toLowerCase()) {
        case 'cn':
        case 'zh-cn':
        case 'zh-hans':
            return withThinkCommand(zhHans, '查看或设置思考程度');
        case 'zh-tw':
        case 'zh-hk':
        case 'zh-mo':
        case 'zh-hant':
            return withThinkCommand(zhHant, '檢視或設定思考程度');
        case 'pt':
        case 'pt-br':
            return withThinkCommand(pt, 'Ver ou definir o nível de raciocínio');
        case 'en':
        case 'en-us':
            return withThinkCommand(en, 'View or set reasoning effort');
        default:
            return withThinkCommand(en, 'View or set reasoning effort');
    }
}
