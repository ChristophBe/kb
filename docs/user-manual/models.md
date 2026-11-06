# Models

Models shows the language model kb uses for search, chat and processing documents, and whether it is available.

## Check that the language model is available

Open **Models**. The top box shows the **Provider** with a status badge:

- **healthy**: search, chat and processing can use it.
- **unavailable**: they can't. **Detail** says what is wrong. Searches, chat answers and processing fail until it is back; try again later or ask whoever runs your kb.

The box also names the **Chat model**, which writes chat answers, and the **Embedding model**, which compares the meaning of passages for search and chat.

## See the installed models

Below the status box, the list shows every model the provider offers, marked **chat** or **embedding**. "No models installed." means the provider has none; search and chat need at least one of each.
