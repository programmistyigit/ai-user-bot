import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    telegramId: string; // Changed from number to string to support big integers safely if needed, though GramJS uses BigInt usually. Using string for safety.
    blockedUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUser extends Document {
    telegramId: string; // Changed from number to string to support big integers safely if needed, though GramJS uses BigInt usually. Using string for safety.
    blockedUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema: Schema = new Schema({
    telegramId: { type: String, required: true, unique: true },
    blockedUntil: { type: Date, default: null },
}, { timestamps: true });

export const UserModel = mongoose.model<IUser>('User', UserSchema);
