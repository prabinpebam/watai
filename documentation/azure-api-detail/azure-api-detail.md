


```curl
curl -X POST "https://ai-project-deployments-resource.services.ai.azure.com/openai/v1/chat/completions" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $AZURE_API_KEY" \
-d '{
    "messages": [
        {
            "role": "user",
            "content": "I am going to Paris, what should I see?"
        },
        {
            "role": "assistant",
            "content": "Paris, the capital of France, is known for its stunning architecture, art museums, historical landmarks, and romantic atmosphere. Here are some of the top attractions to see in Paris:\n\n1. The Eiffel Tower: The iconic Eiffel Tower is one of the most recognizable landmarks in the world and offers breathtaking views of the city.\n2. The Louvre Museum: The Louvre is one of the largest and most famous museums, housing an impressive collection of art and artifacts, including the Mona Lisa.\n3. Notre-Dame Cathedral: This beautiful cathedral is one of the most famous landmarks in Paris and is known for its Gothic architecture and stunning stained glass windows.\n\nThese are just a few of the many attractions that Paris has to offer. With so much to see and do, it is no wonder that Paris is one of the most popular tourist destinations in the world."
        },
        {
            "role": "user",
            "content": "What is so great about #1?"
        }
    ],
    "model": "gpt-5.4",
    "max_completion_tokens": 4096,
    "reasoning_effort": "medium"
}'

```


```curl
curl -X POST "<your-endpoint-here>" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $AZURE_API_KEY" \
-d '{
    "temperature" : 1,
     "response_format" : "json",
     "model" : "gpt-4o-transcribe",
    
}'
```


```curl
curl -X POST "https://ai-project-deployments-resource.services.ai.azure.com/openai/v1/images/generations" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $AZURE_API_KEY" \
-d '{
    "prompt": "A photograph of a red fox in an autumn forest",
    "model": "gpt-image-2",
    "size": "1024x1024",
    "n": 1,
    "output_format": "png",
    "output_compression": 100
}' | jq -r '.data[0].b64_json' | base64 --decode > generated_image.png
```


```python
import base64
from openai import OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

endpoint = "https://ai-project-deployments-resource.services.ai.azure.com/openai/v1"
deployment_name = "gpt-image-2"
token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://ai.azure.com/.default")

client = OpenAI(
    base_url=endpoint,
    api_key=token_provider
)

img = client.images.generate(
    model=deployment_name,
    prompt="A cute baby polar bear",
    n=1,
    size="1024x1024",
)

image_bytes = base64.b64decode(img.data[0].b64_json)
with open("output.png", "wb") as f:
    f.write(image_bytes)
```


```python
from openai import OpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

endpoint = "https://ai-project-deployments-resource.services.ai.azure.com/openai/v1"
deployment_name = "gpt-5.4-2"
token_provider = get_bearer_token_provider(DefaultAzureCredential(), "https://ai.azure.com/.default")

client = OpenAI(
    base_url=endpoint,
    api_key=token_provider
)

response = client.responses.create(
    model=deployment_name,
    input="What is the capital of France?",
)

print(f"answer: {response.output[0]}")
```

```curl
curl -X POST "https://ai-project-deployments-resource.cognitiveservices.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview" \
  -H "Content-Type: multipart/form-data" \
  -H "Authorization: Bearer $AZURE_API_KEY" \
  -d '{
     "model": "gpt-4o-transcribe",
     "file": "@path/to/file/audio.mp3"
    }'
```