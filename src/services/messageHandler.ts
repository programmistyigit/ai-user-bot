import { NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import { UserModel } from '../database/models';
import { logger } from '../utils/logger';
import {
    addImageToSession,
    abortImageSession,
    isPhotoMessage,
    isDocumentFile,
    isLocationMessage,
    isGreetingMedia
} from './imageSessionManager';
import {
    sendTextToAI,
    getMessageText,
    pendingRequests
} from './aiUtils';


// Session middleware: /abortSession bilan to'xtatilgan chatlar
// Bu chatlardan kelgan xabarlarga AI javob bermaydi
const abortedSessions = new Set<string>();

export const handleIncomingMessage = async (event: NewMessageEvent) => {
    try {
        const message = event.message;
        const sender = await message.getSender();

        if (!sender || !(sender instanceof Api.User) || !event.isPrivate) {
            return;
        }

        if (sender.bot || sender.self) {
            return;
        }

        const userId = sender.id.toString();

        // ===== SESSION MIDDLEWARE =====
        const text = getMessageText(message);

        if (text.trim().toLowerCase() === '/abortsession') {
            abortedSessions.add(userId);
            if (pendingRequests.has(userId)) {
                pendingRequests.get(userId)!.abort();
                pendingRequests.delete(userId);
            }
            abortImageSession(userId);
            logger.info(`🚫 Session to'xtatildi, user: ${userId}`);
            return;
        }

        if (text.trim().toLowerCase() === '/reconnectsession') {
            abortedSessions.delete(userId);
            logger.info(`✅ Session qayta ulandi, user: ${userId}`);
            return;
        }

        if (abortedSessions.has(userId)) {
            logger.info(`⏸️ Xabar e'tiborsiz qoldirildi (session to'xtatilgan), user: ${userId}`);
            return;
        }
        // ===== END SESSION MIDDLEWARE =====

        // Check if Blocked
        const user = await UserModel.findOne({ telegramId: userId });
        if (user && user.blockedUntil && user.blockedUntil > new Date()) {
            logger.info(`Ignored message from blocked user: ${userId}`);
            return;
        }

        // ===== MEDIA HANDLING =====

        // 1. Photo → imageSessionManager ga
        if (isPhotoMessage(message)) {
            logger.info(`🖼️ Rasm aniqlandi, user: ${userId}`);
            if (pendingRequests.has(userId)) {
                pendingRequests.get(userId)!.abort();
                pendingRequests.delete(userId);
            }
            await addImageToSession(userId, message, event.client!);
            return;
        }

        // 2. Document (pdf, zip, docx) → kod javob beradi
        if (isDocumentFile(message)) {
            logger.info(`📎 Document fayl qabul qilindi, user: ${userId}`);
            await message.respond({
                message: "📎 Faylingizni qabul qildik! Adminlarimiz tez orada ko'rib chiqishadi.",
                parseMode: "html"
            });
            return;
        }

        // 3. Lokatsiya → modelga context bilan yuborish
        if (isLocationMessage(message)) {
            logger.info(`📍 Lokatsiya qabul qilindi, user: ${userId}`);
            await sendTextToAI(
                userId,
                "[Client o'z joylashuvini (lokatsiyasini) yubordi]",
                message,
                event
            );
            return;
        }

        // 4. GIF, Video, Sticker, Voice, Video note → modelga "Salom"
        if (isGreetingMedia(message)) {
            logger.info(`🎬 Media (video/gif/sticker/voice) aniqlandi, user: ${userId}`);
            await sendTextToAI(userId, 'Salom', message, event);
            return;
        }

        // ===== TEXT-ONLY PROCESSING =====

        if (!text || text.trim().length === 0) {
            return;
        }

        // 2. Check for Admin Request


        // 3. Text AI Processing
        await sendTextToAI(userId, text, message, event);

    } catch (error: any) {
        if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            logger.info('🔄 AI request bekor qilindi (yangi xabar keldi)');
            return;
        }
        logger.error('Error handling message:', error);
    }
};
