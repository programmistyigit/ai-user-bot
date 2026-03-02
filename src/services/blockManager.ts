import { logger } from '../utils/logger';

/**
 * Markazlashtirilgan bloklash boshqaruvchisi.
 * Per-user bloklash va global bloklash (umuman hechkimga yozmaslik).
 */
class BlockManager {
    // Bloklangan userlar ID lari
    private blockedUsers: Set<string> = new Set();

    // Global block holati — true bo'lsa hechkimga javob berilmaydi
    private globalBlock: boolean = false;

    // === Per-user blocking ===

    blockUser(userId: string): void {
        this.blockedUsers.add(userId);
        logger.info(`🚫 User bloklandi: ${userId}`);
    }

    unblockUser(userId: string): void {
        this.blockedUsers.delete(userId);
        logger.info(`✅ User blokdan chiqarildi: ${userId}`);
    }

    isUserBlocked(userId: string): boolean {
        return this.blockedUsers.has(userId);
    }

    getBlockedUsers(): string[] {
        return Array.from(this.blockedUsers);
    }

    // === Global blocking ===

    setGlobalBlock(enabled: boolean): void {
        this.globalBlock = enabled;
        logger.info(`🌐 Global block: ${enabled ? 'YOQILDI' : 'O\'CHIRILDI'}`);
    }

    isGloballyBlocked(): boolean {
        return this.globalBlock;
    }

    // === Combined check ===

    /**
     * Userga javob berish kerakmi tekshiradi.
     * true qaytarsa — user bloklangan (javob bermaslik kerak).
     */
    isBlocked(userId: string): boolean {
        if (this.globalBlock) return true;
        return this.blockedUsers.has(userId);
    }
}

export const blockManager = new BlockManager();
