import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { keccak256, toBytes } from 'viem';
import type { CorpusRecord } from '../shared/types.js';
import type { ServiceListing } from '../shared/marketplace.js';
import type { Deployment } from './config.js';
import { AppError } from './errors.js';

export type StoredService = { listing:ServiceListing; response:string };
export type FaucetGrant = { lastAt:number; tokenGranted:string; gasGranted:string };
type Catalog = {scope:string;services:StoredService[];faucets:Record<string,FaucetGrant>};
const corpus=JSON.parse(readFileSync(new URL('../data/corpus.json',import.meta.url),'utf8')) as CorpusRecord[];
/** Only public() output is safe to return from discovery routes. */
export class MarketStore {
 private catalog:Catalog;
 constructor(private readonly path:string,scope:string,deployment:Deployment){
  if(existsSync(path)){
   const saved=JSON.parse(readFileSync(path,'utf8')) as Catalog;
   if(saved.scope!==scope||!Array.isArray(saved.services)||!saved.faucets)throw new AppError('NOT_READY','Marketplace catalog does not match this deployment.',503);
   this.catalog=saved;
  }else{
   this.catalog={scope,services:Object.entries(deployment.merchants).flatMap(([id,merchant])=>corpus.map(record=>({listing:{id:'fixture-'+id+'-'+record.recordId,seller:merchant.address,sku:keccak256(toBytes(record.recordId)),title:record.title,description:merchant.name+' · builder-operated research fixture from the fixed demo corpus.',category:'research' as const,basePrice:id==='a'?'50000':'55000',spendThreshold:'150000',discountBps:id==='a'?2000:0,offerVersion:'1',kind:'fixture' as const,createdAt:deployment.createdAt},response:JSON.stringify(record,null,2)}))),faucets:{}};this.save();
  }
 }
 private save(){mkdirSync(dirname(this.path),{recursive:true});const temporary=this.path+'.'+randomBytes(8).toString('hex')+'.tmp';writeFileSync(temporary,JSON.stringify(this.catalog,null,2),{mode:0o600});renameSync(temporary,this.path);}
 all(){return this.catalog.services;}
 get(id:string){return this.catalog.services.find(service=>service.listing.id===id);}
 add(service:StoredService){if(this.get(service.listing.id))throw new AppError('SERVICE_EXISTS','This service id is already published.',409);this.catalog.services.push(service);this.save();}
 grant(address:string){return this.catalog.faucets[address.toLowerCase()];}
 reserveGrant(address:string,value:FaucetGrant){this.catalog.faucets[address.toLowerCase()]=value;this.save();}
 public(service:StoredService):ServiceListing{return {...service.listing};}
}
