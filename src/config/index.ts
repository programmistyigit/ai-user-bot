import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

interface Config {
    API_ID: number;
    API_HASH: string;
    MONGO_URI: string;
    OLLAMA_HOST: string;
    ADMIN_PHONE: string;
    SESSION_STRING: string;
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
    MONGO_URI: getEnv('MONGO_URI'),
    OLLAMA_HOST: getEnv('OLLAMA_HOST'),
    ADMIN_PHONE: getEnv('ADMIN_PHONE'),
    SESSION_STRING: getEnv('SESSION_STRING', false), // Optional initially
};
