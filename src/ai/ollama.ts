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

    private retryDelayStep: number = 200; // 0.2 sekund har bir xato uchun

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

        for (let attempt = 1; ; attempt++) {
            try {
                if (signal?.aborted) {
                    throw new DOMException('Request aborted', 'AbortError');
                }

                const response = await ollamaClient.chat({
                    model: model,
                    messages: messages,
                });

                const content = response.message.content;
                if (!content || content.trim().length === 0) {
                    throw new Error('Empty response from model');
                }

                return content;

            } catch (error: any) {
                lastError = error;

                // AbortError — qayta urinmaslik
                if (error?.name === 'AbortError') {
                    throw error;
                }

                // 503, network xato yoki empty response — retry
                const isRetryable = error?.status_code === 503
                    || error?.message?.includes('Service Temporarily Unavailable')
                    || error?.message?.includes('503')
                    || error?.message === 'Empty response from model';

                if (isRetryable) {
                    const delay = attempt * this.retryDelayStep; // 1-urinish: 0.2s, 2-urinish: 0.4s, 10-urinish: 2s
                    const reason = error?.message === 'Empty response from model' ? 'Empty response' : 'Network/503';
                    logger.warn(`⚠️ Attempt ${attempt} failed (${reason}). Retrying in ${delay / 1000}s...`);

                    // Delay vaqtida ham abortni kuzatish
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(resolve, delay);
                        signal?.addEventListener('abort', () => {
                            clearTimeout(timeout);
                            reject(new DOMException('Request aborted during retry delay', 'AbortError'));
                        }, { once: true });
                    });
                    continue;
                }

                // Boshqa xato — throw
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
