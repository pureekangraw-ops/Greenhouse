import {evaluateAgent} from '../src/agents/policy.mjs';
import {scenarios,evaluationTime} from '../training/scenarios.mjs';
const results=scenarios.map(({id,input,expected})=>{
 const observed=evaluateAgent(input,evaluationTime);
 return {id,agent:input.agent,passed:Object.entries(expected).every(([k,v])=>observed[k]===v) && observed.businessOutcome==='UNKNOWN',expected,observed:{action:observed.action,status:observed.status,businessOutcome:observed.businessOutcome}};
});
console.log(JSON.stringify({kind:'OFFLINE_POLICY_DRILLS',liveModelEvaluated:false,hubE2E:false,passed:results.filter(r=>r.passed).length,total:results.length,results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
