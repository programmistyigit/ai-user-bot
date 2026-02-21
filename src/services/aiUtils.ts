import { Api, helpers, TelegramClient } from 'telegram';
import { NewMessageEvent } from 'telegram/events';
import { aiHandler } from '../ai/ollama';
import { logger } from '../utils/logger';

// Har bir user uchun pending AI requestni track qilish
export const pendingRequests = new Map<string, AbortController>();

export const getMessageText = (message: Api.Message): string => {
    if (message.text && message.text.trim().length > 0) {
        return message.text;
    }

    if (message.contact) {
        const phoneNumber = message.contact.phoneNumber;
        return `[Kontakt raqami: +${phoneNumber}]`;
    }

    return '[media]';
};

/**
 * AI ga matn yuborish va javob olish (umumiy funksiya)
 * Document, location, greeting, text, va vision tavsifi uchun ishlatiladi
 */
export async function sendTextToAI(
    userId: string,
    textToSend: string,
    message: Api.Message,
    event: NewMessageEvent | { client: TelegramClient }
): Promise<void> {
    // Oldingi pending request abort
    if (pendingRequests.has(userId)) {
        pendingRequests.get(userId)!.abort();
        logger.info(`⏹️ Oldingi AI request bekor qilindi, user: ${userId}`);
    }

    const abortController = new AbortController();
    pendingRequests.set(userId, abortController);

    const peer = await message.getInputChat();

    // Client olish (har ikkala type da ham mavjud)
    const client = 'client' in event ? event.client : undefined;

    // Telegram history olish
    const historyMessages = await client?.getMessages(peer, { limit: 10 }) || [];
    const history = (historyMessages as Api.Message[])
        .reverse()
        .map((msg: Api.Message) => ({
            role: (msg.out ? 'assistant' : 'user') as 'user' | 'assistant',
            content: getMessageText(msg) || 'Salom'
        }))
        .filter((msg: { content: string }) => msg.content.trim().length > 0);

    // Oxirgi xabarni textToSend bilan almashtirish (agar rasm bolsa context qo'shilgan bo'ladi)
    if (history.length > 0 && !message.out) {
        history[history.length - 1].content = textToSend;
    } else {
        history.push({ role: 'user', content: textToSend });
    }

    // Typing status interval (har 5 soniyada yangilab turish)
    const sendTyping = () => client?.invoke(new Api.messages.SetTyping({
        peer: peer,
        action: new Api.SendMessageTypingAction()
    })).catch(err => logger.error('Typing status error:', err));

    await sendTyping();
    const typingInterval = setInterval(sendTyping, 5000);

    try {
        const aiResponse = await aiHandler.generateResponse(history, abortController.signal);

        if (!abortController.signal.aborted) {
            // Koordinata tekshirish (faqat O'zbekiston diapazoni: lat 30-45, long 55-75)
            const geoMatch = aiResponse.match(/(3[0-9]|4[0-5])\.(\d{3,6}),\s*(5[5-9]|6[0-9]|7[0-5])\.(\d{3,6})/);
            if (geoMatch) {
                const lat = parseFloat(geoMatch[1] + '.' + geoMatch[2]);
                const long = parseFloat(geoMatch[3] + '.' + geoMatch[4]);
                try {
                    if (peer && client) {
                        await client.invoke(
                            new Api.messages.SendMedia({
                                peer: peer,
                                media: new Api.InputMediaGeoPoint({
                                    geoPoint: new Api.InputGeoPoint({ lat, long })
                                }),
                                message: '',
                                randomId: helpers.generateRandomBigInt()
                            })
                        );
                        logger.info(`📍 Location sent to ${userId}: ${lat}, ${long}`);
                    }
                } catch (geoError) {
                    logger.error('Error sending location:', geoError);
                }
            }

            if (aiResponse && aiResponse.trim().length > 0) {
                await message.respond({ message: aiResponse, parseMode: "html" });
            } else {
                logger.warn(`⚠️ AI model (${aiHandler.textModel}) returned empty response, user: ${userId}`);
            }
        }
    } catch (error) {
        clearInterval(typingInterval);
        pendingRequests.delete(userId);
        logger.error('Error in sendTextToAI:', error);
    } finally {
        clearInterval(typingInterval);
        pendingRequests.delete(userId);
    }
}
