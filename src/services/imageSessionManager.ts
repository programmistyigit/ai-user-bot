import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import { logger } from '../utils/logger';
import { aiHandler } from '../ai/ollama';
import { helpers } from 'telegram';
import {
    sendTextToAI,
    getMessageText,
    pendingRequests
} from './aiUtils';

// =============================================
// IMAGE SESSION MANAGER
// Har bir user uchun rasm buferlash, debounce,
// va abort logikasini boshqaradi
// =============================================

interface BufferedImage {
    data: Buffer;
    description: string;
}

interface ImageSession {
    images: BufferedImage[];
    debounceTimer: NodeJS.Timeout | null;
    abortController: AbortController | null;
    peer: any;
    eventClient: TelegramClient | null;
    firstMessage: Api.Message | null;
}

// User sessiyalari
const userSessions = new Map<string, ImageSession>();

// Debounce kutish vaqti (ms) — oxirgi rasmdan keyin shu vaqt kutib yuboriladi
const DEBOUNCE_DELAY_MS = 3000;

/**
 * User sessiyasini olish yoki yangi yaratish
 */
function getOrCreateSession(userId: string): ImageSession {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, {
            images: [],
            debounceTimer: null,
            abortController: null,
            peer: null,
            eventClient: null,
            firstMessage: null,
        });
    }
    return userSessions.get(userId)!;
}

/**
 * Sessiyani tozalash
 */
function clearSession(userId: string): void {
    const session = userSessions.get(userId);
    if (session) {
        if (session.debounceTimer) {
            clearTimeout(session.debounceTimer);
        }
        session.images = [];
        session.debounceTimer = null;
        session.abortController = null;
        session.peer = null;
        session.eventClient = null;
        session.firstMessage = null;
    }
    userSessions.delete(userId);
}

// Statik rasmlar (GIF kirmaydi - vision model GIF ni tahlil qila olmaydi)
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

// Haqiqiy document fayllar (model emas, kod javob beradi)
const DOCUMENT_MIME_TYPES = [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/html',
    'text/plain',
    'text/csv'
];

/**
 * Document ichidagi MIME type ni olish
 */
function getDocumentMimeType(message: Api.Message): string | null {
    if (
        message.media &&
        message.media instanceof Api.MessageMediaDocument &&
        message.media.document &&
        message.media.document instanceof Api.Document
    ) {
        return message.media.document.mimeType || null;
    }
    return null;
}

/**
 * Document ichida sticker attribute bormi tekshirish
 */
function hasSticker(message: Api.Message): boolean {
    if (
        message.media &&
        message.media instanceof Api.MessageMediaDocument &&
        message.media.document &&
        message.media.document instanceof Api.Document
    ) {
        return message.media.document.attributes.some(
            (attr: any) => attr instanceof Api.DocumentAttributeSticker
        );
    }
    return false;
}

/**
 * Photo yoki "Send as file" rasm (sticker emas)
 */
export function isPhotoMessage(message: Api.Message): boolean {
    if (message.photo) {
        return true;
    }
    if (message.media && message.media instanceof Api.MessageMediaPhoto) {
        return true;
    }
    // "Send as file" rasm — lekin sticker bo'lmasligi kerak
    const mimeType = getDocumentMimeType(message);
    if (mimeType && IMAGE_MIME_TYPES.includes(mimeType) && !hasSticker(message)) {
        return true;
    }
    return false;
}

/**
 * Document fayl (pdf, zip, docx, xlsl, etc.) — model emas, kod javob beradi
 */
export function isDocumentFile(message: Api.Message): boolean {
    if (!message.media || !(message.media instanceof Api.MessageMediaDocument)) return false;
    const mimeType = getDocumentMimeType(message);
    if (!mimeType) return false;

    // Sticker yoki Video/Audio bo'lmasa va ro'yxatda bo'lsa
    if (hasSticker(message)) return false;

    // Check if it's in our document list or starts with common doc prefixes but isn't media
    return DOCUMENT_MIME_TYPES.includes(mimeType) ||
        (mimeType.startsWith('application/') && !mimeType.startsWith('application/x-tgsticker') && !mimeType.startsWith('application/vnd.android.package-archive'));
}

/**
 * Lokatsiya xabari
 */
export function isLocationMessage(message: Api.Message): boolean {
    if (!message.media) return false;
    return (
        message.media instanceof Api.MessageMediaGeo ||
        message.media instanceof Api.MessageMediaGeoLive ||
        message.media instanceof Api.MessageMediaVenue
    );
}

/**
 * GIF, Video, Sticker, Voice, Video note — modelga "salom" yuboriladi
 */
export function isGreetingMedia(message: Api.Message): boolean {
    if (!message.media) return false;

    // 1. Sticker (static yoki animated)
    if (hasSticker(message)) return true;

    // 2. Video, GIF, Voice, Video note — MessageMediaDocument ichida bo'lishi mumkin
    if (message.media instanceof Api.MessageMediaDocument) {
        // Agar bu photo bo'lmasa va real document bo'lmasa -> demak greeting media
        if (!isPhotoMessage(message) && !isDocumentFile(message)) {
            return true;
        }
    }

    return false;
}

/**
 * Telegramdan rasmni yuklab, Buffer sifatida qaytarish
 */
async function downloadPhoto(message: Api.Message, client: TelegramClient): Promise<Buffer | null> {
    try {
        const result = await client.downloadMedia(message, {});
        if (result && Buffer.isBuffer(result)) {
            return result;
        }
        // Agar string (file path) qaytsa — Buffer ga aylantirish
        if (result && typeof result === 'string') {
            const fs = await import('fs');
            return fs.readFileSync(result);
        }
        return null;
    } catch (error) {
        logger.error('❌ Rasmni yuklab olishda xatolik:', error);
        return null;
    }
}

// (import ko'chirildi fayl boshiga)


/**
 * Debounce tugagach — barcha to'plangan rasmlarni modelga yuborish
 */
async function sendToModel(userId: string): Promise<void> {
    const session = userSessions.get(userId);
    if (!session || session.images.length === 0) {
        clearSession(userId);
        return;
    }

    // Oldingi AI request bormi — abort qilish
    if (session.abortController) {
        session.abortController.abort();
        logger.info(`⏹️ Oldingi vision request bekor qilindi, user: ${userId}`);
    }

    // Yangi AbortController
    const abortController = new AbortController();
    session.abortController = abortController;

    const images = [...session.images]; // nusxa olish
    const peer = session.peer;
    const client = session.eventClient;
    // Birinchi xabarni referens sifatida olamiz (faqat respond qilish uchun)
    const firstImageMessage = session.firstMessage;

    if (!firstImageMessage || !client || !peer) {
        logger.error(`❌ Session malumotlari yetarli emas, user: ${userId}`);
        clearSession(userId);
        return;
    }

    logger.info(`🖼️ ${images.length} ta rasm Qwen orqali tavsiflanmoqda, user: ${userId}`);

    try {
        // Typing status ko'rsatish
        const sendTyping = () => client.invoke(new Api.messages.SetTyping({
            peer: peer,
            action: new Api.SendMessageTypingAction()
        })).catch(err => logger.error('Typing status error:', err));

        await sendTyping();
        const typingInterval = setInterval(sendTyping, 5000);

        // Rasmlarni base64 ga aylantirish
        const base64Images = images.map(img => img.data.toString('base64'));

        // 1-QADAM: Qwen3-VL orqali rasm tahlili (faqat tasvirlash)
        const qwenOutput = await aiHandler.generateVisionResponse(
            "Rasmda nima tasvirlangan? Batafsil tushuntiring, lekin faqat vizual tavsif bering.",
            base64Images,
            abortController.signal
        );

        clearInterval(typingInterval);

        if (abortController.signal.aborted) return;

        // Qwen bo'sh javob qaytarsa pipeline to'xtatiladi
        if (!qwenOutput || qwenOutput.trim().length === 0) {
            logger.warn(`⚠️ Qwen bo'sh javob qaytardi, pipeline to'xtatildi, user: ${userId}`);
            return;
        }

        logger.info(`📝 Qwen tavsifi olindi, endi DeepSeek ga yuboriladi, user: ${userId}`);

        // Description content yaratish (User yozgan captionlar)
        const userCaptions = images
            .map((img, i) => img.description ? `(Rasm ${i + 1} izohi: ${img.description})` : '')
            .filter(d => d.length > 0)
            .join(' ');

        // 2-QADAM: DeepSeek-V3.2 orqali yakuniy sales javobni olish
        // sendTextToAI ichida tarix (history) ham hisobga olinadi
        const finalPromptForDeepSeek = `[Client rasmli murojaat qildi. Rasmlar tavsifi: ${qwenOutput}] ${userCaptions}`;

        await sendTextToAI(
            userId,
            finalPromptForDeepSeek,
            firstImageMessage,
            { client }
        );

        logger.info(`✅ Vision-to-Text pipeline yakunlandi, user: ${userId}`);

    } catch (error: any) {
        if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
            logger.info(`🔄 Vision request bekor qilindi (yangi rasm keldi), user: ${userId}`);
            return;
        }
        logger.error('❌ Vision-to-Text pipeline xatoligi:', error);
    } finally {
        // Session tozalash
        clearSession(userId);
    }
}

/**
 * Yangi rasmni bufferga qo'shish
 * Debounce timer qayta boshlanadi
 * Oldingi AI request abort qilinadi
 */
export async function addImageToSession(
    userId: string,
    message: Api.Message,
    client: TelegramClient
): Promise<void> {
    const session = getOrCreateSession(userId);

    // Peer va client ni saqlash
    session.peer = await message.getInputChat();
    session.eventClient = client;

    // Birinchi xabarni saqlash (respond qilish uchun ishlatiladi)
    if (!session.firstMessage) {
        session.firstMessage = message;
    }

    // Rasmni yuklab olish
    const imageBuffer = await downloadPhoto(message, client);
    if (!imageBuffer) {
        logger.warn(`⚠️ Rasmni yuklab bo'lmadi, user: ${userId}`);
        return;
    }

    // Caption (description) olish
    const description = message.text || message.message || '';

    // Bufferga qo'shish
    session.images.push({
        data: imageBuffer,
        description: description,
    });

    logger.info(`📥 Rasm bufferga qo'shildi (${session.images.length} ta), user: ${userId}`);

    // Oldingi AI request abort qilish
    if (session.abortController) {
        session.abortController.abort();
        logger.info(`⏹️ Oldingi vision request bekor qilindi, user: ${userId}`);
        session.abortController = null;
    }

    // Debounce timer qayta boshlash
    if (session.debounceTimer) {
        clearTimeout(session.debounceTimer);
    }

    session.debounceTimer = setTimeout(() => {
        sendToModel(userId);
    }, DEBOUNCE_DELAY_MS);
}

/**
 * User sessiyasini tashqaridan abort qilish
 * (masalan, /abortSession komandasi uchun)
 */
export function abortImageSession(userId: string): void {
    const session = userSessions.get(userId);
    if (session) {
        if (session.abortController) {
            session.abortController.abort();
        }
        clearSession(userId);
        logger.info(`🚫 Image session abort qilindi, user: ${userId}`);
    }
}
