import { describe,expect,it } from 'vitest';
import { validatePlan, deterministicPlan } from '../server/planner.js';
describe('allowlisted task planning',()=>{
 it.each([[['unknown']],[['bnb-budget','bnb-budget']],[['bnb-agents','bnb-identity','bnb-commerce','bnb-budget','bnb-budget']]])('rejects invalid plan %j',(recordIds)=>expect(()=>validatePlan({mission:'Read',recordIds})).toThrow('INVALID_PLAN'));
 it('accepts one judge task without loyalty-farming warmups',()=>expect(deterministicPlan('Get this BNB research record').recordIds).toEqual(['bnb-budget']));
 it('refuses unsupported missions instead of purchasing an unrelated preset record',()=>expect(()=>deterministicPlan('Buy an unrelated weather forecast')).toThrow('INVALID_PLAN'));
 it('maps explicit requested record ids only',()=>expect(deterministicPlan('Read bnb-identity and bnb-budget').recordIds).toEqual(['bnb-identity','bnb-budget']));
});
