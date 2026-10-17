import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, recoverMessageAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import type { AuthChallenge, WalletSession } from '../shared/marketplace.js';
import type { Address, Hex } from '../shared/types.js';
import { AppError } from './errors.js';

const allowedOrigins = new Set(['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173','http://127.0.0.1:3001','http://localhost:3001']);
const challengeSchema = z.object({address:z.string().refine(isAddress),chainId:z.number().int()}).strict();
const verifySchema = z.object({challengeId:z.string().regex(/^[a-f0-9]{48}$/),signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict();
type IssuedChallenge = { address:Address; chainId:number; origin:string; message:string; expiresAt:number };
const unauthorized = () => new AppError('AUTH_REQUIRED','Sign in again with your wallet.',401);
/** Sessions and challenges intentionally vanish on API restart. No signing keys are held here. */
export class MarketAuth {
 private challenges = new Map<string,IssuedChallenge>();
 private sessions = new Map<string,WalletSession>();
 constructor(private readonly chainId:number, private readonly now:()=>number=Date.now) {}
 private origin(value?:string){const origin=value??'http://localhost:3001';if(!allowedOrigins.has(origin))throw new AppError('BAD_ORIGIN','Unexpected browser origin.',403);return origin;}
 private prune(){const now=this.now();for(const [key,c] of this.challenges)if(c.expiresAt<=now)this.challenges.delete(key);for(const [key,s] of this.sessions)if(Date.parse(s.expiresAt)<=now)this.sessions.delete(key);}
 challenge(input:unknown, requestOrigin?:string):AuthChallenge {
  const body=challengeSchema.parse(input);if(body.chainId!==this.chainId)throw new AppError('WRONG_CHAIN','Select the configured marketplace chain.');
  this.prune();if(this.challenges.size>=1000)throw new AppError('AUTH_BUSY','Too many pending sign-in requests. Retry shortly.',429);
  const origin=this.origin(requestOrigin),now=this.now(),expiresAt=now+300000,address=getAddress(body.address),challengeId=randomBytes(24).toString('hex');
  const message=createSiweMessage({address,chainId:this.chainId,domain:new URL(origin).host,scheme:'http',uri:origin,version:'1',nonce:randomBytes(24).toString('hex'),issuedAt:new Date(now),expirationTime:new Date(expiresAt),statement:'Sign in to Repeat marketplace. This does not authorize a payment.'});
  this.challenges.set(challengeId,{address,chainId:this.chainId,origin,message,expiresAt});
  return {challengeId,message,expiresAt:new Date(expiresAt).toISOString()};
 }
 async verify(input:unknown,requestOrigin?:string):Promise<WalletSession> {
  const body=verifySchema.parse(input),challenge=this.challenges.get(body.challengeId);
  // Consume before recovering so simultaneous requests and invalid attempts cannot replay a nonce.
  this.challenges.delete(body.challengeId);
  if(!challenge||challenge.expiresAt<=this.now()||challenge.origin!==this.origin(requestOrigin)||challenge.chainId!==this.chainId)throw unauthorized();
  let address:Address;try{address=await recoverMessageAddress({message:challenge.message,signature:body.signature as Hex});}catch{throw unauthorized();}
  if(challenge.expiresAt<=this.now()||address.toLowerCase()!==challenge.address.toLowerCase())throw unauthorized();
  this.prune();if(this.sessions.size>=10000)throw new AppError('AUTH_BUSY','Too many active sessions. Retry shortly.',429);
  const session:WalletSession={token:randomBytes(32).toString('hex'),address:challenge.address,chainId:this.chainId,expiresAt:new Date(this.now()+3600000).toISOString()};
  this.sessions.set(session.token,session);return {...session};
 }
 session(header?:string):WalletSession {
  const token=/^Bearer ([a-f0-9]{64})$/.exec(header??'')?.[1],session=token?this.sessions.get(token):undefined;
  if(!session||Date.parse(session.expiresAt)<=this.now()||session.chainId!==this.chainId){if(token)this.sessions.delete(token);throw unauthorized();}return {...session};
 }
 logout(header?:string){const session=this.session(header);this.sessions.delete(session.token);}
}
