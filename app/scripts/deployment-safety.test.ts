import { describe, it, expect } from 'vitest';
import { mnemonicToAccount, generatePrivateKey } from 'viem/accounts';
import { testnetSigningKey, assertLocalEnvironmentSafe, assertDistinctRoles } from './deployment-safety.js';
describe('deployment configuration safety', () => {
  it('rejects publicly known Anvil accounts instead of sending their keys to a public chain', () => {
    for (const index of [0,1,4,9,19]) {
      const account=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:index});
      const key=('0x'+Buffer.from(account.getHdKey().privateKey!).toString('hex'));
      expect(()=>testnetSigningKey(key,'BUYER_PRIVATE_KEY')).toThrow('Public development wallet');
    }
  });
  it('accepts a well-formed disposable non-fixture key', () => {
    const key=generatePrivateKey();
    expect(testnetSigningKey(key,'BUYER_PRIVATE_KEY')).toBe(key);
  });
  it('refuses to overwrite an existing BSC environment with local development keys', () => {
    expect(()=>assertLocalEnvironmentSafe('CHAIN_ID=97\nRPC_URL=https://example.invalid')).toThrow('Preserve');
    expect(()=>assertLocalEnvironmentSafe('CHAIN_ID=31337')).not.toThrow();
  });
});

describe('distinct deployment roles', () => {
  it('rejects shared rehearsal/judge or merchant identities', () => {
    expect(()=>assertDistinctRoles({rehearsal:'0xABC',judge:'0xabc'})).toThrow('distinct');
    expect(()=>assertDistinctRoles({merchantA:'0xDEF',merchantB:'0xdef'})).toThrow('distinct');
  });
  it('accepts separate role addresses', () => {
    expect(()=>assertDistinctRoles({rehearsal:'0x1',judge:'0x2',merchantA:'0x3',merchantB:'0x4'})).not.toThrow();
  });
});
