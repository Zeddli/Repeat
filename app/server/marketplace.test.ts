import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toBytes, zeroAddress } from 'viem';
import { z } from 'zod';
import { MarketAuth } from './market-auth.js';
import { createMarketplaceRouter } from './marketplace.js';
import { createApi } from './index.js';
import { MarketStore } from './market-store.js';
import { AppError } from './errors.js';
import type { AuthChallenge,WalletSession } from '../shared/marketplace.js';
import type { ChainGateway } from './chain.js';
const seller = privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`);
const buyer = privateKeyToAccount(('0x'+'22'.repeat(32)) as `0x${string}`);
const stranger = privateKeyToAccount(('0x'+'33'.repeat(32)) as `0x${string}`);
const origin = 'http://localhost:5173';
const orderId = ('0x'+'44'.repeat(32)) as `0x${string}`;
const secret = 'PRIVATE paid response with unreleased research';
const body = { id:'my-research',title:'My research',description:'A useful private research answer.',category:'research',basePrice:'50000',spendThreshold:'150000',discountBps:2000,response:secret };
const servers:Server[]=[];const directories:string[]=[];
afterEach(async()=>{ await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>s.close(()=>r()))));directories.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})); });
async function fixture(chainId:97|31337=31337){
 const dir=mkdtempSync(join(tmpdir(),'repeat-market-'));directories.push(dir);
 let price=50000n; let paidBuyer=buyer.address;let paidSku=keccak256(toBytes('my-research'));let paidAmount=50000n;
 const gateway={config:{chainId,rpcUrl:'http://127.0.0.1:8545',chain:{name:'Local Anvil',nativeCurrency:{symbol:'ETH'}},checkoutAddress:'0x0000000000000000000000000000000000000001',tokenAddress:'0x0000000000000000000000000000000000000002',deployment:{createdAt:'2026-10-17T00:00:00Z',merchants:{a:{address:seller.address,name:'Atlas Research'},b:{address:stranger.address,name:'Beacon Data'}},buyers:{judge:{address:'0x0000000000000000000000000000000000000009'}}}},assertReady:async()=>{},publicClient:{getBlockNumber:async()=>12n,readContract:async(p:{functionName:string,args:unknown[]})=>{if(p.functionName==='offer')return {basePrice:price,spendThreshold:150000n,discountBps:2000,version:1n,enabled:true};if(p.functionName==='preview')return [40000n,2000,150000n,3n,1n];return 0n;},getBalance:async()=>0n},paidOrder:async(address:string)=>({merchant:address===paidBuyer?seller.address:zeroAddress,sku:paidSku,amount:address===paidBuyer?paidAmount:0n,offerVersion:1n})} as unknown as ChainGateway;
 const app=express();app.use(express.json());app.use(createMarketplaceRouter(()=>gateway,{storePath:join(dir,'catalog.json')}));app.use((e:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>{if(e instanceof AppError)r.status(e.status).json({error:e.code,message:e.message});else if(e instanceof z.ZodError)r.status(400).json({error:'INVALID_REQUEST',message:'Invalid schema'});else r.status(500).json({error:'SERVER_ERROR',message:String(e)});});
 const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as {port:number}).port;
 async function request(path:string,method='GET',data?:unknown,token?:string){return fetch('http://127.0.0.1:'+port+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});}
 async function login(account=seller){const c=await (await request('/api/auth/challenge','POST',{address:account.address,chainId})).json() as AuthChallenge;const response=await request('/api/auth/verify','POST',{challengeId:c.challengeId,signature:await account.signMessage({message:c.message})});expect(response.status).toBe(200);return (await response.json() as WalletSession).token as string;}
 return {request,login,gateway,storePath:join(dir,'catalog.json'),setPrice:(p:bigint)=>{price=p;},setPaid:(who:typeof buyer.address,sku=paidSku,amount=50000n)=>{paidBuyer=who;paidSku=sku;paidAmount=amount;}};
}
describe('SIWE sessions',()=>{
 it('uses a single server-issued challenge and invalidates replay',async()=>{const a=new MarketAuth(31337);const c=a.challenge({address:seller.address,chainId:31337},origin);expect(c.message).toContain('localhost:5173 wants you to sign in');expect(c.message).toContain('Chain ID: 31337');const signature=await seller.signMessage({message:c.message});const session=await a.verify({challengeId:c.challengeId,signature},origin);expect(session.address).toBe(seller.address);expect(a.session('Bearer '+session.token).address).toBe(seller.address);await expect(a.verify({challengeId:c.challengeId,signature},origin)).rejects.toMatchObject({status:401});a.logout('Bearer '+session.token);expect(()=>a.session('Bearer '+session.token)).toThrow();});
 it('rejects wrong wallets, wrong origin, and wrong chain',async()=>{const a=new MarketAuth(31337);let c=a.challenge({address:seller.address,chainId:31337},origin);await expect(a.verify({challengeId:c.challengeId,signature:await buyer.signMessage({message:c.message})},origin)).rejects.toMatchObject({status:401});c=a.challenge({address:seller.address,chainId:31337},origin);await expect(a.verify({challengeId:c.challengeId,signature:await seller.signMessage({message:c.message})},'http://localhost:3001')).rejects.toMatchObject({status:401});expect(()=>a.challenge({address:seller.address,chainId:97},origin)).toThrow();});
 it('rejects challenges that expire during signature recovery',async()=>{let now=1792195200000;const a=new MarketAuth(31337,()=>now);const c=a.challenge({address:seller.address,chainId:31337},origin);const signature=await seller.signMessage({message:c.message});const pending=a.verify({challengeId:c.challengeId,signature},origin);now+=300000;await expect(pending).rejects.toMatchObject({status:401});});
 it('expires challenges at five minutes and sessions at one hour',async()=>{let now=1792195200000;const a=new MarketAuth(31337,()=>now);let c=a.challenge({address:seller.address,chainId:31337},origin);const signature=await seller.signMessage({message:c.message});now+=300000;await expect(a.verify({challengeId:c.challengeId,signature},origin)).rejects.toMatchObject({status:401});c=a.challenge({address:seller.address,chainId:31337},origin);const session=await a.verify({challengeId:c.challengeId,signature:await seller.signMessage({message:c.message})},origin);now+=3600000;expect(()=>a.session('Bearer '+session.token)).toThrow();});
});
describe('marketplace API boundaries',()=>{
 it('hides paid content and seeds eight builder fixture listings',async()=>{const {request,login}=await fixture();const initial=await request('/api/market/services');expect((await initial.json() as {services:unknown[]}).services).toHaveLength(8);const token=await login();const published=await request('/api/market/services','POST',body,token);expect(published.status).toBe(201);expect(JSON.stringify(await published.json())).not.toContain(secret);const search=await request('/api/market/services?q=my%20research');const text=await search.text();expect(text).toContain('My research');expect(text).not.toContain(secret);const detail=await request('/api/market/services/my-research');expect(await detail.text()).not.toContain(secret);});
 it('requires the session owner and confirmed matching offer policy to publish',async()=>{const {request,login,setPrice}=await fixture();expect((await request('/api/market/services','POST',body)).status).toBe(401);const token=await login();setPrice(60000n);expect((await request('/api/market/services','POST',body,token)).status).toBe(409);setPrice(50000n);expect((await request('/api/market/services','POST',{...body,seller:buyer.address},token)).status).toBe(400);expect((await request('/api/market/services','POST',body,token)).status).toBe(201);const other=await login(buyer);expect((await request('/api/market/services','POST',body,other)).status).toBe(403);});
 it('returns real preview pricing for the requested buyer',async()=>{const {request,login}=await fixture();await request('/api/market/services','POST',body,await login());const q=await request('/api/market/services/my-research/quote?buyer='+buyer.address);expect(q.status).toBe(200);expect(await q.json()).toMatchObject({buyer:buyer.address,amount:'40000',appliedBps:2000,priorPaid:'150000',offerVersion:'1',blockNumber:'12'});});
 it('denies unpaid wallets and wrong service SKUs but permits delivery retry',async()=>{const {request,login,setPaid}=await fixture();await request('/api/market/services','POST',body,await login());const token=await login(buyer);const other=await login(stranger);expect((await request('/api/market/services/my-research/deliver','POST',{orderId},other)).status).toBe(403);setPaid(buyer.address,keccak256(toBytes('other-service')));expect((await request('/api/market/services/my-research/deliver','POST',{orderId},token)).status).toBe(403);setPaid(buyer.address,keccak256(toBytes('my-research')),0n);expect((await request('/api/market/services/my-research/deliver','POST',{orderId},token)).status).toBe(403);setPaid(buyer.address,keccak256(toBytes('my-research')));for(let i=0;i<2;i++){const d=await request('/api/market/services/my-research/deliver','POST',{orderId},token);expect(d.status).toBe(200);expect(d.headers.get('cache-control')).toBe('no-store');expect(await d.json()).toMatchObject({response:secret,buyer:buyer.address,amount:'50000'});}});
});



describe('HTTP body limits and errors',()=>{
 async function apiRequest(raw:string){const server=createApi().listen(0,'127.0.0.1');servers.push(server);await new Promise<void>(r=>server.once('listening',r));return fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/market/services',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:raw});}
 it('returns a structured input error for malformed JSON',async()=>{const response=await apiRequest('{broken');expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'INVALID_REQUEST'});});
 it('accepts the full supported Unicode response size before checking auth',async()=>{const response=await apiRequest(JSON.stringify({...body,response:'界'.repeat(50000)}));expect([401,503]).toContain(response.status);});
 it('returns a structured input error for oversized JSON',async()=>{const response=await apiRequest(JSON.stringify({response:'x'.repeat(300000)}));expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'INVALID_REQUEST'});});
});

describe('catalog persistence',()=>{
 it('retains private response and immutable metadata across re-open, denying mutation and ownership changes',async()=>{const f=await fixture(),token=await f.login();expect((await f.request('/api/market/services','POST',body,token)).status).toBe(201);expect((await f.request('/api/market/services','POST',{...body,response:'replacement'},token)).status).toBe(409);expect((await f.request('/api/market/services','POST',body,token)).status).toBe(201);const c=f.gateway.config,scope=[c.chainId,c.checkoutAddress.toLowerCase(),c.tokenAddress.toLowerCase(),c.deployment.deploymentBlock,c.deployment.createdAt].join(':');const reopened=new MarketStore(f.storePath,scope,c.deployment);expect(reopened.get(body.id)?.response).toBe(secret);expect(JSON.stringify(reopened.public(reopened.get(body.id)!))).not.toContain(secret);expect(()=>new MarketStore(f.storePath,'different-deployment',c.deployment)).toThrow();});
});

describe('local faucet restrictions',()=>{
 it('requires auth, rejects arbitrary parameters, and never funds BSC testnet',async()=>{const local=await fixture();expect((await local.request('/api/market/faucet','POST',{})).status).toBe(401);const token=await local.login();expect((await local.request('/api/market/faucet','POST',{address:buyer.address,amount:'1000000000'},token)).status).toBe(400);const testnet=await fixture(97);const session=await testnet.login();expect((await testnet.request('/api/market/faucet','POST',{},session)).status).toBe(403);});
 it('persists consumed caps before a funding transaction could be broadcast',async()=>{const f=await fixture();await f.login();const c=f.gateway.config,scope=[c.chainId,c.checkoutAddress.toLowerCase(),c.tokenAddress.toLowerCase(),c.deployment.deploymentBlock,c.deployment.createdAt].join(':');const store=new MarketStore(f.storePath,scope,c.deployment);store.reserveGrant(buyer.address,{lastAt:1792195200000,tokenGranted:'1000000',gasGranted:'50000000000000000'});const reopened=new MarketStore(f.storePath,scope,c.deployment);expect(reopened.grant(buyer.address)).toEqual({lastAt:1792195200000,tokenGranted:'1000000',gasGranted:'50000000000000000'});});
});

describe('downloadable agent client',()=>{
 it('serves a standalone JavaScript client without wallet authentication or a repository checkout',async()=>{
  const {request}=await fixture();
  const response=await request('/api/market/client');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('javascript');
  expect(response.headers.get('content-disposition')).toContain('repeat-agent.mjs');
  const source=await response.text();
  expect(source).toContain('Repeat wallet marketplace agent');
  expect(source).not.toContain('npx tsx scripts/market-agent.ts');
 });
});
