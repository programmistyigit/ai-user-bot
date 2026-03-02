import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

interface Config {
    API_ID: number;
    API_HASH: string;
    OLLAMA_HOST: string;
    ADMIN_PHONE: string;
    SESSION_STRING: string;
    WS_PORT: number;
    BOT_TOKEN: string;
}

const getEnv = (key: string, required: boolean = true): string => {
    const value = process.env[key];
    if (required && !value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value || '';
};

export const config: Config = {
    API_ID: parseInt(getEnv('API_ID'), 10),
    API_HASH: getEnv('API_HASH'),
    OLLAMA_HOST: getEnv('OLLAMA_HOST'),
    ADMIN_PHONE: getEnv('ADMIN_PHONE'),
    SESSION_STRING: getEnv('SESSION_STRING', false),
    WS_PORT: parseInt(getEnv('WS_PORT', false) || '8080', 10),
    BOT_TOKEN: getEnv('BOT_TOKEN', false),
};
