import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

// Fast base58 check + optional strict validation
export function isValidSolanaAddress(addr: string): boolean {
  const trimmed = addr.trim();
  if (!trimmed) return false;
  
  // Fast base58 check first
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) return false;
  
  // Optional strict validation with PublicKey
  try {
    const pk = new PublicKey(trimmed);
    return pk.toBase58() === trimmed;
  } catch {
    return false;
  }
}

// Server-side schema (don't overfit length; verify by constructibility)
export const WalletAddressSchema = z
  .string()
  .transform((s) => s.trim())
  .refine(isValidSolanaAddress, { message: "Invalid Solana wallet address" });
