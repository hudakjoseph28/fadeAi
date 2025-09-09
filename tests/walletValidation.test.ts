import { describe, it, expect } from "vitest";
import { WalletAddressSchema } from "@/lib/validation/wallet";

// Sample keys (use any valid-looking examples in your codebase/test fixtures)
const VALID_STD = "BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL"; // user example
const VALID_TRIMMED = `  ${VALID_STD}  `;
const INVALID_EMPTY = "";
const INVALID_JUNK = "not-a-solana-key!!!";
const INVALID_SHORT = "abcd1234";

describe("WalletAddressSchema", () => {
  it("accepts a valid public key", () => {
    expect(WalletAddressSchema.parse(VALID_STD)).toBe(VALID_STD);
  });

  it("trims whitespace and still accepts", () => {
    expect(WalletAddressSchema.parse(VALID_TRIMMED)).toBe(VALID_STD);
  });

  it("rejects empty", () => {
    expect(() => WalletAddressSchema.parse(INVALID_EMPTY)).toThrow();
  });

  it("rejects junk", () => {
    expect(() => WalletAddressSchema.parse(INVALID_JUNK)).toThrow();
  });

  it("rejects too short", () => {
    expect(() => WalletAddressSchema.parse(INVALID_SHORT)).toThrow();
  });
});
