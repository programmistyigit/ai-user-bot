import { Ollama } from 'ollama';
import { config } from '../config';
import { SYSTEM_PROMPT } from './prompts';
import { logger } from '../utils/logger';


export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class AIHandler {
    private model: string = 'deepseek-v3.1:671b:cloud';

    public async generateResponse(history: ChatMessage[], signal?: AbortSignal): Promise<string> {
        try {
            // Agar signal allaqachon abort bo'lgan bo'lsa — darhol chiqish
            if (signal?.aborted) {
                throw new DOMException('Request aborted', 'AbortError');
            }

            logger.info('🔄 Starting AI response generation...');

            const messages: ChatMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history
            ];

            logger.info(`📝 Sending ${messages.length} messages to Llama3...`);

            // Har bir request uchun yangi Ollama client yaratish
            // Custom fetch bilan AbortSignal ni qo'llab-quvvatlash
            const ollamaClient = new Ollama({
                host: config.OLLAMA_HOST,
                fetch: (url: any, init?: any) => {
                    return fetch(url, { ...init, signal });
                }
            });

            const response = await ollamaClient.chat({
                model: this.model,
                messages: messages,
            });
            const output = response.message.content;

            return output;

        } catch (error: any) {
            // AbortError ni qayta throw qilish — messageHandler tomonida ushlanadi
            if (error?.name === 'AbortError') {
                throw error;
            }
            logger.error('AI Generation Error:', error);
            return "Uzr, hozirda tizimda texnik nosozlik yuz berdi. Iltimos, keyinroq urinib ko'ring.";
        }
    }
}

export const aiHandler = new AIHandler();

