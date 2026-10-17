import { appendFileSync,closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Run } from '../shared/types.js';
import type { OrderIntent } from './runner.js';
export type JournalEntry={kind:string;at?:string;runId?:string;run?:Run;intent?:OrderIntent;hash?:string;orderId?:string;requestId?:string;buyer?:string};
export interface JournalStore { append(entry:JournalEntry):unknown; read():JournalEntry[]; }
export class Journal implements JournalStore {
 constructor(public path:string){mkdirSync(dirname(path),{recursive:true});}
 append(entry:JournalEntry){const fd=openSync(this.path,'a',0o600);try{appendFileSync(fd,JSON.stringify({...entry,at:entry.at??new Date().toISOString()})+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
 read():JournalEntry[]{if(!existsSync(this.path))return [];return readFileSync(this.path,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as JournalEntry);}
}
