import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import { blockManager } from '../services/blockManager';
import { client } from '../telegram/client';
import { Api } from 'telegram';

let bot: TelegramBot | null = null;

/**
 * Admin ID ni aniqlash uchun — faqat birinchi /start yuborganiga ruxsat beriladi
 * Yoki .env dan ADMIN_CHAT_ID orqali belgilash mumkin
 */
let adminChatId: number | null = null;

/**
 * Control panel inline keyboard yaratish
 */
function getMainKeyboard(): TelegramBot.InlineKeyboardMarkup {
    const globalStatus = blockManager.isGloballyBlocked();

    return {
        inline_keyboard: [
            [
                {
                    text: globalStatus ? '🔴 Umuman yozmaslik: O\'chirish' : '🟢 Umuman yozmaslik: Yoqish',
                    callback_data: 'toggle_global'
                }
            ],
            [
                {
                    text: '👤 Userni bloklash (tanlash)',
                    callback_data: 'select_user_block'
                }
            ],
            [
                {
                    text: '📋 Bloklangan userlar',
                    callback_data: 'list_blocked'
                }
            ]
        ]
    };
}

/**
 * Faqat admin ekanligini tekshirish
 */
function isAdmin(chatId: number): boolean {
    if (!adminChatId) return false;
    return chatId === adminChatId;
}

/**
 * Control botni ishga tushirish
 */
export function startControlBot(): void {
    const token = config.BOT_TOKEN;

    if (!token) {
        logger.warn('⚠️ BOT_TOKEN topilmadi, Control Bot ishga tushmaydi');
        return;
    }

    bot = new TelegramBot(token, { polling: true });

    logger.info('🤖 Control Bot ishga tushdi');

    // /start — admin panel
    bot.onText(/\/start|\/panel/, (msg) => {
        const chatId = msg.chat.id;

        // Birinchi marta /start bosilganda admin sifatida belgilash
        if (!adminChatId) {
            adminChatId = chatId;
            logger.info(`👑 Admin belgilandi: ${chatId}`);
        }

        if (!isAdmin(chatId)) {
            bot?.sendMessage(chatId, '⛔ Sizda ruxsat yo\'q.');
            return;
        }

        bot?.sendMessage(chatId, '🎛 <b>Control Panel</b>\n\nUserbot boshqaruvi:', {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    });

    // Forward qilingan xabarlarni qayta ishlash — user bloklash
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        if (!isAdmin(chatId)) return;

        // Forward qilingan xabar
        if (msg.forward_from) {
            const forwardedUserId = msg.forward_from.id.toString();
            const firstName = msg.forward_from.first_name || '';
            const lastName = msg.forward_from.last_name || '';
            const username = msg.forward_from.username || '';

            if (blockManager.isUserBlocked(forwardedUserId)) {
                bot?.sendMessage(chatId,
                    `⚠️ Bu user allaqachon bloklangan:\n👤 ${firstName} ${lastName} ${username ? '@' + username : ''}\n🆔 ${forwardedUserId}`,
                    { parse_mode: 'HTML' }
                );
                return;
            }

            blockManager.blockUser(forwardedUserId);
            bot?.sendMessage(chatId,
                `🚫 <b>User bloklandi!</b>\n\n👤 ${firstName} ${lastName}\n${username ? '🔗 @' + username + '\n' : ''}🆔 <code>${forwardedUserId}</code>\n\nEndi userbot bu userga javob bermaydi.`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '↩️ Blokdan chiqarish', callback_data: `unblock_${forwardedUserId}` }],
                            [{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            return;
        }

        // forward_sender_name bor lekin forward_from yo'q (privacy yoqilgan user)
        if (msg.forward_sender_name && !msg.forward_from) {
            bot?.sendMessage(chatId,
                `⚠️ Bu userning privacy sozlamalari yoqilgan, ID aniqlab bo'lmadi.\n\n💡 "👤 Userni bloklash" tugmasidan foydalaning.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        // === users_shared — Telegramning native user picker dan tanlangan user ===
        const usersShared = (msg as any).users_shared;
        if (usersShared && usersShared.users && usersShared.users.length > 0) {
            const selectedUser = usersShared.users[0];
            const selectedUserId = selectedUser.user_id.toString();

            // Reply keyboard ni olib tashlash
            bot?.sendMessage(chatId, '⏳', {
                reply_markup: { remove_keyboard: true }
            }).then((sentMsg) => {
                // O'chirish (vaqtinchalik xabar)
                bot?.deleteMessage(chatId, sentMsg.message_id).catch(() => { });
            });

            if (blockManager.isUserBlocked(selectedUserId)) {
                bot?.sendMessage(chatId,
                    `⚠️ Bu user allaqachon bloklangan!\n🆔 <code>${selectedUserId}</code>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '↩️ Blokdan chiqarish', callback_data: `unblock_${selectedUserId}` }],
                                [{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
                return;
            }

            blockManager.blockUser(selectedUserId);

            // User haqida info olishga harakat
            let displayInfo = `🆔 <code>${selectedUserId}</code>`;
            if (selectedUser.first_name) {
                displayInfo = `👤 ${selectedUser.first_name}${selectedUser.last_name ? ' ' + selectedUser.last_name : ''}\n${selectedUser.username ? '🔗 @' + selectedUser.username + '\n' : ''}` + displayInfo;
            }

            bot?.sendMessage(chatId,
                `🚫 <b>User bloklandi!</b>\n\n${displayInfo}\n\nEndi userbot bu userga javob bermaydi.`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '↩️ Blokdan chiqarish', callback_data: `unblock_${selectedUserId}` }],
                            [{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            return;
        }
    });

    // Callback query handler
    bot.on('callback_query', async (query) => {
        if (!query.message || !isAdmin(query.message.chat.id)) {
            bot?.answerCallbackQuery(query.id, { text: '⛔ Ruxsat yo\'q' });
            return;
        }

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data || '';

        // === Global toggle ===
        if (data === 'toggle_global') {
            const currentState = blockManager.isGloballyBlocked();
            blockManager.setGlobalBlock(!currentState);

            bot?.editMessageText(
                `🎛 <b>Control Panel</b>\n\n${!currentState ? '🔴 Umuman yozmaslik <b>YOQILDI</b> — userbot hechkimga javob bermaydi' : '🟢 Umuman yozmaslik <b>O\'CHIRILDI</b> — userbot oddiy ishlaydi'}`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: getMainKeyboard()
                }
            );
            bot?.answerCallbackQuery(query.id);
            return;
        }

        // === User tanlash (Telegramning o'z ro'yxati) ===
        if (data === 'select_user_block') {
            bot?.answerCallbackQuery(query.id);

            // request_users keyboard button — Telegramning o'z user picker dialogini ochadi
            bot?.sendMessage(chatId,
                '👤 Quyidagi tugmani bosing va bloklash kerak bo\'lgan userni tanlang:',
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        keyboard: [[{
                            text: '👤 Userni tanlang',
                            request_users: {
                                request_id: 1,
                                user_is_bot: false,
                                max_quantity: 1
                            }
                        } as any]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return;
        }

        // === Unblock from list ===
        if (data.startsWith('unblock_')) {
            const userId = data.replace('unblock_', '');
            blockManager.unblockUser(userId);

            bot?.answerCallbackQuery(query.id, { text: `✅ User blokdan chiqarildi` });

            // Bloklangan userlar ro'yxatini yangilash
            const blockedList = blockManager.getBlockedUsers();
            if (blockedList.length === 0) {
                bot?.editMessageText(
                    '📭 Bloklangan userlar yo\'q.',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
            } else {
                const buttons: TelegramBot.InlineKeyboardButton[][] = blockedList.map(uid => ([
                    { text: `🔴 ${uid}`, callback_data: `noop_${uid}` },
                    { text: '❌ Blokdan chiqarish', callback_data: `unblock_${uid}` }
                ]));
                buttons.push([{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]);

                bot?.editMessageText(
                    '📋 <b>Bloklangan userlar:</b>',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: buttons }
                    }
                );
            }
            return;
        }

        // === Bloklangan userlar ro'yxati ===
        if (data === 'list_blocked') {
            const blockedList = blockManager.getBlockedUsers();

            if (blockedList.length === 0) {
                bot?.editMessageText(
                    '📭 Bloklangan userlar yo\'q.',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
            } else {
                // Har bir bloklangan user uchun info olishga harakat qilamiz
                const buttons: TelegramBot.InlineKeyboardButton[][] = [];

                for (const uid of blockedList) {
                    let displayName = uid;
                    try {
                        const entity = await client.getEntity(uid);
                        if (entity instanceof Api.User) {
                            displayName = [entity.firstName, entity.lastName].filter(Boolean).join(' ');
                            if (entity.username) displayName += ` @${entity.username}`;
                        }
                    } catch {
                        // ID bilan ko'rsatamiz
                    }

                    buttons.push([
                        { text: `🔴 ${displayName}`, callback_data: `noop_${uid}` },
                        { text: '❌ Chiqarish', callback_data: `unblock_${uid}` }
                    ]);
                }

                buttons.push([{ text: '🔙 Bosh menyu', callback_data: 'main_menu' }]);

                bot?.editMessageText(
                    '📋 <b>Bloklangan userlar:</b>',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: buttons }
                    }
                );
            }

            bot?.answerCallbackQuery(query.id);
            return;
        }

        // === Bosh menyu ===
        if (data === 'main_menu') {
            bot?.editMessageText('🎛 <b>Control Panel</b>\n\nUserbot boshqaruvi:', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: getMainKeyboard()
            });
            bot?.answerCallbackQuery(query.id);
            return;
        }

        // noop — hech narsa qilmaslik (info button)
        if (data.startsWith('noop_')) {
            bot?.answerCallbackQuery(query.id);
            return;
        }

        bot?.answerCallbackQuery(query.id);
    });

    // Polling errors
    bot.on('polling_error', (error) => {
        logger.error('Control Bot polling error:', error);
    });
}

/**
 * Control botni to'xtatish
 */
export function stopControlBot(): void {
    if (bot) {
        bot.stopPolling();
        logger.info('🛑 Control Bot to\'xtatildi');
    }
}
