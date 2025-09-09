export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9 as const;

export const AMM_PROGRAMS = new Set<string>([
  // Jupiter routers
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", // Jupiter v4 router
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6 router
  "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo", // Jupiter v2 router
  
  // Raydium
  "RVKd61ztZW9GUwhR6KJh7zhG9T67pZqSWLJtFK5G9wB",   // Raydium AMM v4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "5quBtoiQqxF9Jv6KYKctB59NT3gtJDz6TzZAA7m3g6Zt", // Raydium AMM v4
  
  // Orca
  "9W959DqZ7W2bQYtRrN2rS2G6bGdGk2sQz6AqZ5E9uoBD", // Orca Whirlpool
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  
  // Serum (legacy)
  "9xQeWvG816bUbEUVXhEpuGqDJoDNLuoB9tGk1K7arAJ7", // Serum DEX v3
  
  // Aldrin
  "AMM55ShdkoGRB5jVYPjWJkYyQj6B4V3bqZgxf3JiH6Sz", // Aldrin AMM
  
  // Saber
  "SSwpkEEcfU9dbzpxvTQa3pWG8v3p1m6n5V8XK3g9NX7", // Saber
  
  // Mercurial
  "MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky", // Mercurial
  
  // Cropper
  "CTMAxxk34HjKWxQ3QLZ1B3FzBXVuD7pDtvSxUpL8GDF", // Cropper
  
  // Lifinity
  "EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S", // Lifinity
  
  // Meteora
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora
  
  // Add more as needed
]);
