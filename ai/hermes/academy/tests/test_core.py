import copy
import json
import tempfile
import unittest
from pathlib import Path
from ai.hermes.academy import CAPABILITIES
from ai.hermes.academy.data import validate_dataset, verify_manifest, canonical
from ai.hermes.academy.artifacts import seal, verify
from ai.hermes.academy.masking import encode
from ai.hermes.academy.evaluate import summarize, score
from ai.hermes.academy.integration import validate_proposal

# Synthetic fixtures are exclusively unit-test inputs; never training data.
class TinyTokenizer:
    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=False):
        text=''.join('<'+m['role']+'>'+m['content']+'</end>' for m in messages)
        if add_generation_prompt:text+='<assistant>'
        return list(text.encode()) if tokenize else text
    def __call__(self,text,**kwargs):
        return {'input_ids':list(text.encode()),'offset_mapping':[(i,i+1) for i in range(len(text))]}

class ProvenanceTests(unittest.TestCase):
    def test_relabeling_arbitrary_raw_file_as_pinned_source_fails(self):
        from ai.hermes.academy.prepare_commitpack import prepare
        with tempfile.TemporaryDirectory() as d:
            raw=Path(d)/'raw.jsonl';raw.write_text('{}\n')
            with self.assertRaisesRegex(ValueError,'pinned downloaded'):
                prepare(raw,Path(d)/'curated')
            self.assertFalse((Path(d)/'curated').exists())

class MaskTests(unittest.TestCase):
    def test_multiturn_masks_tool_and_user(self):
        messages=[{'role':'user','content':'question'},{'role':'assistant','content':'call'},
                  {'role':'tool','content':'observed'},{'role':'assistant','content':'answer'}]
        tok=TinyTokenizer(); r=encode(tok,messages)
        exposed=bytes(x for x in r['labels'] if x!=-100).decode()
        self.assertEqual(exposed,'call</end>answer</end>')
    def test_token_crossing_header_boundary_is_masked(self):
        class MergeTokenizer(TinyTokenizer):
            def __call__(self,text,**kwargs):
                boundary=text.index('<assistant>')+len('<assistant>')-1
                ids=list(text.encode()); offsets=[(i,i+1) for i in range(len(text))]
                ids[boundary:boundary+2]=[1000];offsets[boundary:boundary+2]=[(boundary,boundary+2)]
                return {'input_ids':ids,'offset_mapping':offsets}
            def apply_chat_template(self,messages,tokenize=True,**kwargs):
                text=super().apply_chat_template(messages,tokenize=False,**kwargs)
                return self(text)['input_ids'] if tokenize else text
        r=encode(MergeTokenizer(),[{'role':'user','content':'q'},{'role':'assistant','content':'call'}])
        self.assertEqual(r['labels'][r['input_ids'].index(1000)],-100)
        self.assertEqual(bytes(x for x in r['labels'] if x!=-100).decode(),'all</end>')
    def test_no_truncation(self):
        with self.assertRaisesRegex(ValueError,'Truncation'):
            encode(TinyTokenizer(),[{'role':'assistant','content':'long answer'}],2)
    def test_no_assistant(self):
        with self.assertRaisesRegex(ValueError,'No supervised'):
            encode(TinyTokenizer(),[{'role':'user','content':'q'}])
    def test_unstable_template_rejected(self):
        class Unstable(TinyTokenizer):
            def apply_chat_template(self,messages,**kwargs):
                result=super().apply_chat_template(messages,**kwargs)
                return [len(messages)]+result if isinstance(result,list) else str(len(messages))+result
        with self.assertRaises(ValueError):
            encode(Unstable(),[{'role':'user','content':'q'},{'role':'assistant','content':'a'}])

class ArtifactTests(unittest.TestCase):
    def test_hash_readback_and_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'weights';p.write_bytes(b'fixture');self.assertEqual(seal(d)['files_verified'],1)
            p.write_bytes(b'changed')
            with self.assertRaises(ValueError):verify(d)
    def test_nested_manifest_is_itself_sealed(self):
        with tempfile.TemporaryDirectory() as d:
            child=Path(d)/'adapter';child.mkdir();(child/'weights').write_bytes(b'fixture')
            seal(child);seal(d);(child/'artifacts.json').write_text('{}')
            with self.assertRaises(ValueError):verify(d)
    def test_unexpected_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a';p.write_text('x');seal(d);(Path(d)/'b').write_text('x')
            with self.assertRaises(ValueError):verify(d)
    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'a').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):seal(d)

class PolicyTests(unittest.TestCase):
    def call(self,args):return {'name':'pantheon_command','arguments':args}
    def test_model_approval_cannot_grant_authority(self):
        call=self.call({'operation':'dispatch_factory','task_id':'task_'+'a'*32,'approved':True})
        with self.assertRaises(ValueError):validate_proposal(call,{'tools':['pantheon_command']})
    def test_existing_owner_task_required(self):
        c=self.call({'operation':'dispatch_factory','task_id':'task_'+'a'*32,'approved':True})
        auth={'tools':['pantheon_command'],'owner_approved':True,'task_id':'task_'+'b'*32}
        with self.assertRaises(ValueError):validate_proposal(c,auth)
        auth['task_id']='task_'+'a'*32
        self.assertFalse(validate_proposal(c,auth)['executed'])
    def test_unknown_argument_rejected(self):
        with self.assertRaises(ValueError):
            validate_proposal({'name':'pantheon_health','arguments':{'url':'https://example.org'}},{'tools':['pantheon_health']})
    def test_readonly_does_not_need_mutation_approval(self):
        self.assertEqual(validate_proposal({'name':'pantheon_health','arguments':{}},
                {'tools':['pantheon_health']})['status'],'VALID_PROPOSAL_ONLY')
    def test_unknown_tool_rejected(self):
        with self.assertRaises(ValueError):validate_proposal({'name':'repo_read','arguments':{}},{'tools':['repo_read']})

class EvalTests(unittest.TestCase):
    def row(self):return {'id':'test','capabilities':['decision'],'messages':[{'role':'user','content':'q'},
        {'role':'assistant','content':'{"decision":"PROCEED"}'}],
        'response_schema':{'type':'object','required':['decision'],'properties':{'decision':{'enum':['PROCEED','ASK']}},'additionalProperties':False}}
    def test_missing_predictions_fail(self):
        with self.assertRaises(ValueError):summarize([self.row()],{})
    def test_missing_required_field_fails(self):
        self.assertFalse(score(self.row(),'{}')['schema_valid'])
    def test_unnecessary_ask_counted(self):
        self.assertTrue(score(self.row(),'{"decision":"ASK"}')['unnecessary_ask'])
    def test_answer_not_in_generation_prompt(self):
        row=self.row();self.assertNotIn('PROCEED',canonical(row['messages'][:-1]))
    def test_invalid_json_counts_failure(self):
        r=summarize([self.row()],{'test':'not json'})
        self.assertEqual(r['by_capability']['decision'],{'correct':0,'total':1})

class DataTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        source={'url':'https://example.test/source','revision':'immutable','license':'MIT',
          'license_evidence':'https://example.test/license','raw_sha256':'a'*64,
          'benchmark':False,'license_approved':True,'allow_upstream_synthetic':False}
        (self.root/'sources.json').write_text(canonical({'source':source}))
        self.rows={s:[{'id':s,'lineage':s,'source':'source','source_record':s,'origin':'human',
           'capabilities':['code'],'quality':{'label_verified':True,'method':'fixture only','evidence':'unit test'},
           'messages':[{'role':'user','content':s},{'role':'assistant','content':'answer'}]}]
           for s in ('train','validation','heldout')}
    def tearDown(self):self.tmp.cleanup()
    def write(self):
        for s,rows in self.rows.items():(self.root/f'{s}.jsonl').write_text(''.join(canonical(r)+'\n' for r in rows))
    def validate(self):self.write();return validate_dataset(self.root,{'code'})
    def test_full_academy_rejects_component_only_corpus(self):
        self.write()
        with self.assertRaisesRegex(ValueError,'missing capabilities'):validate_dataset(self.root)
    def test_lineage_leak_rejected(self):
        self.rows['heldout'][0]['lineage']='train'
        with self.assertRaisesRegex(ValueError,'Lineage'):self.validate()
    def test_duplicate_prompt_rejected(self):
        self.rows['heldout'][0]['messages'][0]['content']='train'
        with self.assertRaisesRegex(ValueError,'Duplicate prompt'):self.validate()
    def test_upstream_synthetic_not_silently_allowed(self):
        self.rows['train'][0]['origin']='upstream_synthetic'
        with self.assertRaisesRegex(ValueError,'not allowed'):self.validate()
    def test_manifest_tamper_rejected(self):
        report=self.validate();(self.root/'manifest.json').write_text(canonical(report));verify_manifest(self.root)
        self.rows['train'][0]['messages'][-1]['content']='changed';self.write()
        with self.assertRaisesRegex(ValueError,'manifest differs'):verify_manifest(self.root)
    def test_string_false_quality_is_not_a_boolean_approval(self):
        self.rows['train'][0]['quality']['label_verified']='false'
        with self.assertRaisesRegex(ValueError,'Unverified'):self.validate()
    def test_false_quality_rejected(self):
        self.rows['train'][0]['quality']['label_verified']=False
        with self.assertRaisesRegex(ValueError,'Unverified'):self.validate()

if __name__=='__main__':unittest.main()
