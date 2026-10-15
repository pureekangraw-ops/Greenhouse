"""Actual GO argument contract snapshot; model proposals never grant approval."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator

TASK_ID = {'type':'string','pattern':'^task_[a-f0-9]{32}$'}
SCHEMAS = {
 'pantheon_health': {'type':'object','properties':{},'additionalProperties':False},
 'pantheon_tasks': {'type':'object','properties':{'task_id':TASK_ID},'additionalProperties':False},
 'pantheon_factory': {'type':'object','properties':{'task_id':TASK_ID},'additionalProperties':False},
 'github_file': {'type':'object','properties':{'repo':{'type':'string','minLength':1},
       'path':{'type':'string','minLength':1},'ref':{'type':'string','minLength':1}},
       'required':['repo','path'],'additionalProperties':False},
 'pantheon_command': {'type':'object','properties':{'request':{'type':'string','minLength':1},
       'operation':{'enum':['create_task','queue_factory','dispatch_factory','reconcile_factory']},
       'task_id':TASK_ID,'approved':{'type':'boolean'}},'additionalProperties':False},
}

def validate_proposal(call, authorization):
    if not isinstance(call,dict) or set(call)!={'name','arguments'}:
        raise ValueError('Expected name and arguments')
    name,args=call['name'],call['arguments']
    if name not in SCHEMAS:
        raise ValueError('Unknown tool (no capability inferred from model output)')
    try:Draft202012Validator(SCHEMAS[name]).validate(args)
    except Exception as exc:raise ValueError('Invalid tool arguments') from exc
    if name not in authorization.get('tools',[]):
        raise ValueError('Tool absent from runtime authorization')
    if name=='pantheon_command':
        operation=args.get('operation','create_task')
        if operation in {'dispatch_factory','reconcile_factory'}:
            # trusted runtime authorization is independent of the model-controlled approved field
            if not (args.get('task_id') and args.get('approved') is True and
                    authorization.get('owner_approved') is True and
                    args['task_id']==authorization.get('task_id')):
                raise ValueError('Existing task and explicit owner authorization required')
        elif not isinstance(args.get('request'),str) or not args['request'].strip():
            raise ValueError('Nonempty request required')
    return {'status':'VALID_PROPOSAL_ONLY','executed':False}

def record_runtime_readback(path, tool, response, observed_at, environment):
    """Persist an actual authorized caller response. Does not manufacture a live call."""
    if tool not in SCHEMAS or environment not in {'sandbox','production_readonly'}:
        raise ValueError('Unsupported runtime evidence')
    if not isinstance(response,dict) or not observed_at:
        raise ValueError('Missing caller response/timestamp')
    path=Path(path)
    if path.exists():raise ValueError('Runtime evidence must not be overwritten')
    evidence={'evidence_type':'AUTHORIZED_TOOL_READBACK','tool':tool,'response':response,
              'observed_at':observed_at,'environment':environment,
              'model_generated':False,'end_to_end_model_execution_verified':False}
    path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    if json.loads(path.read_text())!=evidence:raise ValueError('Readback mismatch')
    return evidence
