"""Assistant-only loss by verified character offsets; never train boundary-spanning tokens."""
def encode(tokenizer, messages, max_length=2048):
    text=tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=False)
    if not isinstance(text,str):raise ValueError('Chat template must render text')
    encoded=tokenizer(text,add_special_tokens=False,return_offsets_mapping=True)
    full,offsets=encoded['input_ids'],encoded['offset_mapping']
    template_ids=tokenizer.apply_chat_template(messages,tokenize=True,add_generation_prompt=False)
    if full!=template_ids:raise ValueError('Template/tokenizer serialization mismatch')
    if len(full)>max_length:raise ValueError(f'Truncation forbidden: {len(full)} > {max_length}')
    if len(offsets)!=len(full):raise ValueError('Invalid tokenizer offset mapping')
    spans=[]
    for i,message in enumerate(messages):
        if message['role']!='assistant':continue
        prefix=tokenizer.apply_chat_template(messages[:i],tokenize=False,add_generation_prompt=True)
        through=tokenizer.apply_chat_template(messages[:i+1],tokenize=False,add_generation_prompt=False)
        if not text.startswith(prefix) or not text.startswith(through) or len(through)<=len(prefix):
            raise ValueError('Chat template is not prefix stable; cannot prove assistant mask')
        spans.append((len(prefix),len(through)))
    # Tokens can straddle assistant-header newline/content. Mask those tokens completely.
    labels=[token if end>start and any(start>=a and end<=b for a,b in spans) else -100
            for token,(start,end) in zip(full,offsets)]
    if not any(x!=-100 for x in labels):raise ValueError('No supervised assistant tokens')
    return {'input_ids':full,'attention_mask':[1]*len(full),'labels':labels}

def collate(tokenizer, rows):
    import torch
    width=max(len(r['input_ids']) for r in rows)
    return {k:torch.tensor([r[k]+[pad]*(width-len(r[k])) for r in rows],dtype=torch.long)
            for k,pad in [('input_ids',tokenizer.pad_token_id),('attention_mask',0),('labels',-100)]}
