import { NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import { UserModel } from '../database/models';
import { aiHandler } from '../ai/ollama';
import { config } from '../config';
import { logger } from '../utils/logger';

// Admin keywords regex (case insensitive)
const ADMIN_KEYWORDS = /admin|manager|odam|inson|bog['`']lanish|gaplashish/i;

// Har bir user uchun pending AI requestni track qilish
// Yangi xabar kelganda oldingi request bekor qilinadi
const pendingRequests = new Map<string, AbortController>();

// Session middleware: /abortSession bilan to'xtatilgan chatlar
// Bu chatlardan kelgan xabarlarga AI javob bermaydi
const abortedSessions = new Set<string>();

const getMessageText = (message: Api.Message): string => {
    if (message.text && message.text.trim().length > 0) {
        return message.text;
    }

    if (message.contact) {
        const phoneNumber = message.contact.phoneNumber;
        return `[Kontakt raqami: +${phoneNumber}]`;
    }

    // Agar matn bo'lmasa (stiker, gif, rasm, video) -> Modelga shunchaki "Salom" deb yuboramiz.
    // Bu modelni chalkashtirmaslik va "Stiker kerakmi?" deb so'ramasligi uchun.
    return 'Salom';
};

export const handleIncomingMessage = async (event: NewMessageEvent) => {
    try {
        const message = event.message;
        const sender = await message.getSender();

        // Check if sender is a User (not channel/group) and chat is private
        if (!sender || !(sender instanceof Api.User) || !event.isPrivate) {
            return;
        }

        // Ignore bots and self
        if (sender.bot || sender.self) {
            return;
        }

        const userId = sender.id.toString();
        const text = getMessageText(message);

        // Guard: bo'sh yoki undefined xabarlarni e'tiborsiz qoldirish
        if (!text || text.trim().length === 0) {
            return;
        }

        // ===== SESSION MIDDLEWARE =====
        // /abortSession — bu chatdan AI javob berishni to'xtatish
        if (text.trim().toLowerCase() === '/abortSession'.toLowerCase()) {
            abortedSessions.add(userId);
            // Agar pending request bo'lsa — uni ham bekor qilish
            if (pendingRequests.has(userId)) {
                pendingRequests.get(userId)!.abort();
                pendingRequests.delete(userId);
            }
            logger.info(`🚫 Session to'xtatildi, user: ${userId}`);
            return;
        }

        // /reConnectSession — bu chatda AI javob berishni qayta boshlash
        if (text.trim().toLowerCase() === '/reConnectSession'.toLowerCase()) {
            abortedSessions.delete(userId);
            logger.info(`✅ Session qayta ulandi, user: ${userId}`);
            return;
        }

        // Agar bu chat aborted bo'lsa — hech narsa qilmaslik
        if (abortedSessions.has(userId)) {
            logger.info(`⏸️ Xabar e'tiborsiz qoldirildi (session to'xtatilgan), user: ${userId}`);
            return;
        }
        // ===== END SESSION MIDDLEWARE =====

        // 1. Check if Blocked
        const user = await UserModel.findOne({ telegramId: userId });
        if (user && user.blockedUntil && user.blockedUntil > new Date()) {
            logger.info(`Ignored message from blocked user: ${userId}`);
            return;
        }

        // 2. Check for Admin Request


        // 3. AI Processing

        // Agar bu user uchun oldingi pending request bo'lsa — bekor qilish
        if (pendingRequests.has(userId)) {
            pendingRequests.get(userId)!.abort();
            logger.info(`⏹️ Oldingi AI request bekor qilindi, user: ${userId}`);
        }

        // Yangi AbortController yaratish
        const abortController = new AbortController();
        pendingRequests.set(userId, abortController);

        // Fetch recent history from Telegram
        const peer = await message.getInputChat();
        const historyMessages = await event.client?.getMessages(peer, { limit: 10 }) || [];

        // Convert Telegram messages to AI history format
        // historyMessages is newest first, so we reverse it
        const history = historyMessages
            .reverse()
            .map(msg => ({
                role: msg.out ? 'assistant' : 'user' as 'user' | 'assistant',
                content: getMessageText(msg)
            }))
            .filter(msg => msg.content.trim().length > 0);

        // Generate AI Response
        // Show typing status
        await message.client?.invoke(new Api.messages.SetTyping({
            peer: peer,
            action: new Api.SendMessageTypingAction()
        }));

        const aiResponse = await aiHandler.generateResponse(history, abortController.signal);

        // Agar request abort bo'lmagan bo'lsa — javobni yuborish
        if (!abortController.signal.aborted) {
            await message.respond({ message: aiResponse, parseMode: "html" });
        }

        // Cleanup: pending request'ni o'chirish
        pendingRequests.delete(userId);

    } catch (error: any) {
        // AbortError — bu normal holat, user yangi xabar yuborgan
        if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            logger.info('🔄 AI request bekor qilindi (yangi xabar keldi)');
            return;
        }
        logger.error('Error handling message:', error);
    }
};
