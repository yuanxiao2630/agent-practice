# deepseek.sh output

```JSON
{"id":"141713e0-54dd-40ca-b9e1-f2cbf5f47a49","object":"chat.completion","created":1794315899,"model":"deepseek-flash","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can\n can I help you today?","reasoning_content":""},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":38,"completion_tokens":12,"total_tokens":50,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":38},"system_fingerprint":"bc19ba97cbe016479903222bb1578db6"}
```

# openai 调用 output

{"id":"fb7f1a39-ca3d-4040-b3d5-2ce8c009ccb1","object":"chat.completion","created":1794316046,"model":"deepseek-flash","choices":[{"index":0,"message":{"role":"assistant","content":"How can I help you today?","reasoning_content":"We need answer to user. Need infer request? User just \"You are a helpful assistant.\" maybe no actual task. Need respond appropriately. Could say how can I help? Since system says AI assistant via API. We should not mention system. Simple."},"logprobs":null,"finish_reason":"stop"}],"usage":{"prompt_tokens":35,"completion_tokens":59,"total_tokens":94,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":51},"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":35},"system_fingerprint":"bc19ba97cbe016479903222bb1578db6"}
