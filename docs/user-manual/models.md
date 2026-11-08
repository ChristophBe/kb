# Models

Models shows the language models kb uses for search, chat and processing documents, and whether they are available.

## Check that the language models are available

Open **Models**. The top box names two providers, each with a status badge. They can be the same:

- **Chat provider** writes chat answers with the **Chat model**.
- **Embedding provider** compares the meaning of passages for search, chat sources and processing, with the **Embedding model**.

The badges mean:

- **healthy**: the provider can be used.
- **unavailable**: it can't. **Detail** says what is wrong. If the chat provider is unavailable, chat answers fail; if the embedding provider is, searches, chat answers and processing fail. Try again later or ask whoever runs your kb.

## See the installed models

Below the status box, the list shows the chat models of the chat provider and the embedding models of the embedding provider, each with its provider's name and marked **chat** or **embedding**. "No models installed." means the providers have none; search and chat need at least one of each.
