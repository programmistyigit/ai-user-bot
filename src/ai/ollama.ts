import { Ollama } from 'ollama';
import { config } from '../config';
import { SYSTEM_PROMPT } from './prompts';
import { logger } from '../utils/logger';


export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[]; // base64 encoded images
}

export class AIHandler {
    public textModel: string = 'deepseek-v3.2:cloud';
    public visionModel: string = 'qwen3-vl:235b-cloud';

    /**
     * Text-only AI javob generatsiyasi (mavjud logika)
     */
    public async generateResponse(history: ChatMessage[], signal?: AbortSignal): Promise<string> {
        try {
            if (signal?.aborted) {
                throw new DOMException('Request aborted', 'AbortError');
            }

            logger.info('🔄 Starting AI response generation...');

            const messages: ChatMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history
            ];

            logger.info(`📝 Sending ${messages.length} messages to model (${this.textModel})...`);

            const ollamaClient = new Ollama({
                host: config.OLLAMA_HOST,
                fetch: (url: any, init?: any) => {
                    return fetch(url, { ...init, signal });
                }
            });

            const response = await ollamaClient.chat({
                model: this.textModel,
                messages: messages,
            });
            const output = response.message.content;

            return output;

        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            logger.error('AI Generation Error:', error);
            return "Uzr, hozirda tizimda texnik nosozlik yuz berdi. Iltimos, keyinroq urinib ko'ring.";
        }
    }

    /**
     * Multimodal vision AI javob generatsiyasi
     * Rasmlar + description bilan modelga yuborish
     *
     * @param userContent — formatlangan user matn (Image 1: Description: ...)
     * @param images — base64 encoded rasmlar massivi
     * @param signal — AbortSignal (abort qilish uchun)
     */
    public async generateVisionResponse(
        userContent: string,
        images: string[],
        signal?: AbortSignal
    ): Promise<string> {
        try {
            if (signal?.aborted) {
                throw new DOMException('Request aborted', 'AbortError');
            }

            logger.info(`🖼️ Starting vision response generation (${images.length} images) using ${this.visionModel}...`);

            const messages: ChatMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: userContent,
                    images: images, // base64 encoded rasmlar
                }
            ];

            logger.info(`📝 Sending vision request to model with ${images.length} images...`);

            const ollamaClient = new Ollama({
                host: config.OLLAMA_HOST,
                fetch: (url: any, init?: any) => {
                    return fetch(url, { ...init, signal });
                }
            });

            const response = await ollamaClient.chat({
                model: this.visionModel,
                messages: messages,
            });
            const output = response.message.content;

            logger.info('✅ Vision response generated successfully');
            return output;

        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            logger.error('Vision AI Generation Error:', error);
            return "Uzr, rasmni tahlil qilishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.";
        }
    }
}

export const aiHandler = new AIHandler();
