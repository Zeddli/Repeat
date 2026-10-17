import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { TaskPlan, PlannerMode } from '../shared/types.js';
import { AppError } from './errors.js';
export const recordIds=['bnb-agents','bnb-identity','bnb-commerce','bnb-budget'] as const;
const schema=z.object({mission:z.string().min(1).max(2000),recordIds:z.array(z.enum(recordIds)).min(1).max(4)}).strict().refine(p=>new Set(p.recordIds).size===p.recordIds.length);
export function validatePlan(value: unknown): TaskPlan {
 const parsed=schema.safeParse(value);
 if(!parsed.success) throw new AppError('INVALID_PLAN','INVALID_PLAN: planner must request 1–4 unique allowed records.');
 return parsed.data;
}
export function deterministicPlan(mission: string): TaskPlan {
 const explicit=recordIds.filter(id=>mission.toLowerCase().includes(id));
 if(!explicit.length&&!/BNB research record/i.test(mission))throw new AppError('INVALID_PLAN','INVALID_PLAN: deterministic mode supports the BNB research preset or explicit corpus record IDs only.');
 return validatePlan({mission,recordIds:explicit.length?explicit:['bnb-budget']});
}
export function plannerMode():PlannerMode { return process.env.ANTHROPIC_API_KEY?'anthropic':'deterministic'; }
export async function planMission(mission:string):Promise<TaskPlan> {
 if(plannerMode()==='deterministic') return deterministicPlan(mission);
 if(!process.env.LLM_MODEL)throw new AppError('NOT_READY','Set LLM_MODEL when ANTHROPIC_API_KEY is configured.',503);
 const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,timeout:30000,maxRetries:0});
 const response=await client.messages.create({
  model:process.env.LLM_MODEL,max_tokens:500,
  system:'Map the owner mission to only the records explicitly needed. Never add work for loyalty or discounts. Get this BNB research record means bnb-budget. Catalog: bnb-agents (Studio), bnb-identity (ERC-8004), bnb-commerce (ERC-8183), bnb-budget (commerce budgets). Return a plan via submit_plan. No keys, budgets, or transactions are available to you.',
  messages:[{role:'user',content:mission}],
  tools:[{name:'submit_plan',description:'Propose only requested allowlisted research tasks.',input_schema:{type:'object',properties:{mission:{type:'string'},recordIds:{type:'array',items:{type:'string',enum:[...recordIds]},minItems:1,maxItems:4,uniqueItems:true}},required:['mission','recordIds'],additionalProperties:false}}],
  tool_choice:{type:'tool',name:'submit_plan'}
 });
 const block=response.content.find(b=>b.type==='tool_use'&&b.name==='submit_plan');
 if(!block||block.type!=='tool_use') throw new AppError('INVALID_PLAN','INVALID_PLAN: no structured plan returned.');
 return validatePlan(block.input);
}
