"""HERMES Academy: evidence-gated recovery, never production authority."""
MODEL_ID = 'Qwen/Qwen2.5-1.5B-Instruct'
BASE_REVISION = '989aa7980e4cf806f80c7fef2b1adb7bc71aa306'
CAPABILITIES = {'intent', 'rca', 'decision', 'planning', 'code', 'tool_calling',
                'recovery', 'verification', 'collaboration'}
