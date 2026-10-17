import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { parse } from 'dotenv';
import type { Hex } from 'viem';

const developmentAddresses = new Set(Array.from({length:20},(_,addressIndex) =>
  mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex}).address.toLowerCase()
));
export function testnetSigningKey(value: string | undefined, name: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Missing disposable testnet key: ' + name);
  if (developmentAddresses.has(privateKeyToAccount(value as Hex).address.toLowerCase())) {
    throw new Error('Public development wallet cannot sign on BSC testnet. Configure a disposable private wallet for ' + name + '.');
  }
  return value as Hex;
}
export function assertLocalEnvironmentSafe(existing: string) {
  if (parse(existing).CHAIN_ID === '97') throw new Error('Existing .env.local selects BSC testnet. Preserve that configuration before running local setup.');
}

export function assertDistinctRoles(roles: Record<string,string>) {
  const seen = new Map<string,string>();
  for (const [role,address] of Object.entries(roles)) {
    const previous = seen.get(address.toLowerCase());
    if (previous) throw new Error('Deployment roles must use distinct wallets: ' + previous + ' and ' + role + '.');
    seen.set(address.toLowerCase(),role);
  }
}
