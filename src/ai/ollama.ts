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

    private maxRetries: number = 3;
    private baseDelay: number = 2000; // 2 sekund

    /**
     * Retry bilan Ollama chat so'rovi
     * 503 (Service Unavailable) xatolarda qayta urinadi
     */
    private async chatWithRetry(
        ollamaClient: Ollama,
        model: string,
        messages: ChatMessage[],
        signal?: AbortSignal
    ): Promise<string> {
        let lastError: any;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new DOMException('Request aborted', 'AbortError');
                }

                const response = await ollamaClient.chat({
                    model: model,
                    messages: messages,
                });
                return response.message.content;

            } catch (error: any) {
                lastError = error;

                // AbortError — qayta urinmaslik
                if (error?.name === 'AbortError') {
                    throw error;
                }

                // 503 yoki network xato — retry
                const isRetryable = error?.status_code === 503
                    || error?.message?.includes('Service Temporarily Unavailable')
                    || error?.message?.includes('503');

                if (isRetryable && attempt < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(2, attempt - 1); // 2s, 4s, 8s
                    logger.warn(`⚠️ Attempt ${attempt}/${this.maxRetries} failed (503). Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // Boshqa xato yoki oxirgi attempt — throw
                throw error;
            }
        }

        throw lastError;
    }

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

            const output = await this.chatWithRetry(ollamaClient, this.textModel, messages, signal);

            return output;

        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            logger.error('AI Generation Error:', error);
            return '';
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

            const output = await this.chatWithRetry(ollamaClient, this.visionModel, messages, signal);

            logger.info('✅ Vision response generated successfully');
            return output;

        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            logger.error('Vision AI Generation Error:', error);
            return '';
        }
    }
}

export const aiHandler = new AIHandler();
