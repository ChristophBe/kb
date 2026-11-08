# Architecture overview

How the modules, the infrastructure and the browser fit together. The diagrams follow `compose.yaml` (and the fragments it includes) and the module manifests in `modules/*/module.yaml`; update them when either changes. The reasons behind the structure are recorded as [ADRs](../adr/README.md); the inside of a module is described in [module.md](module.md).

## System context

```mermaid
flowchart LR
    user([User])
    kb["kb<br/>knowledge management"]
    llmvendor[("LLM provider<br/>Ollama (default), Anthropic")]

    user -- "browser: upload, browse, chat" --> kb
    kb -- "generate, embed" --> llmvendor
```

A user works with kb only through the browser. kb's only external dependency is an LLM provider, reached exclusively through the `llm` module ([ADR 0005](../adr/0005-llm-module-is-the-only-vendor-gateway.md)).

## Containers

```mermaid
flowchart TB
    browser([Browser])

    subgraph edge["Edge (deploy/edge.compose.yaml)"]
        web["web :3000<br/>nginx + React shell"]
        envoy["envoy :8080<br/>gRPC-Web → gRPC"]
    end

    subgraph modules["Modules (modules/*/compose.yaml)"]
        subgraph document["document"]
            docsvc["document-service :9001<br/>Go"]
        end
        subgraph ingestion["ingestion"]
            ingsvc["ingestion-service :9002<br/>Go"]
            ingworker["ingestion-worker<br/>Python"]
        end
        subgraph chat["chat"]
            chatsvc["chat-service :9003<br/>Python"]
        end
        subgraph llm["llm"]
            llmsvc["llm-service :9004<br/>Python"]
        end
    end

    subgraph infra["Infrastructure (deploy/infra.compose.yaml)"]
        pg[("postgres :5432<br/>pgvector")]
        s3[("s3 :8333<br/>SeaweedFS")]
        nats[["nats :4222<br/>JetStream"]]
        dex["dex :5556<br/>dev OIDC provider"]
    end

    ollama["ollama :11434<br/>profile: ollama"]

    browser -- "HTTP: app + config.json" --> web
    browser -- "gRPC-Web" --> envoy
    browser -- "presigned PUT / GET" --> s3
    browser -. "login, tokens" .-> dex
    envoy -- "JWKS (verify tokens)" --> dex

    envoy -- "DocumentService" --> docsvc
    envoy -- "IngestionService" --> ingsvc
    envoy -- "ChatService" --> chatsvc
    envoy -- "LlmService" --> llmsvc

    ingsvc -- "CreateDocument, SetDocumentStatus" --> docsvc
    ingworker -- "ReadContent, AddChunks, SetDocumentStatus" --> docsvc
    ingworker -- "Embed" --> llmsvc
    chatsvc -- "SearchChunks" --> docsvc
    chatsvc -- "Generate, Embed" --> llmsvc
    docsvc -- "Embed (SearchDocuments)" --> llmsvc
    llmsvc -- "HTTP" --> ollama

    ingsvc -- "pub kb.ingestion.uploaded<br/>sub started / processed / failed" --> nats
    ingworker -- "sub kb.ingestion.uploaded<br/>pub started / processed / failed" --> nats

    docsvc -- "schema document" --> pg
    ingsvc -- "schema ingestion" --> pg
    chatsvc -- "schema chat" --> pg
    docsvc -- "bucket: raw files, presigning" --> s3
```

| Container | Module | Owns | Calls (gRPC) | Events (stream `INGESTION`) |
|---|---|---|---|---|
| `document-service` | document | schema `document` (documents, chunks + `vector(768)`), S3 bucket | llm (only `SearchDocuments`) | — |
| `ingestion-service` | ingestion | schema `ingestion` (jobs), stream `INGESTION` | document | publishes `uploaded`; consumes `started`, `processed`, `failed` |
| `ingestion-worker` | ingestion | — | document, llm | consumes `uploaded`; publishes `started`, `processed`, `failed` |
| `chat-service` | chat | schema `chat` (conversations, messages) | document, llm | — |
| `llm-service` | llm | provider registry | Ollama over HTTP, Anthropic API | — |
| `envoy` | — | per-method routes for the public RPCs of each manifest's `grpc_services` (not `internal`); token check, sets `x-kb-user` ([ADR 0009](../adr/0009-oidc-authentication-at-the-gateway.md)) | all four services | — |
| `web` | — | UI shell; module UIs from `apps/web/src/modules.gen.ts` | via envoy | — |

Modules never share a schema, bucket or stream: each is owned by one module, and other modules go through its gRPC API or its events ([ADR 0002](../adr/0002-module-per-folder-monorepo.md), [ADR 0004](../adr/0004-nats-jetstream-events-between-modules.md)).

## Upload → process → chat

```mermaid
sequenceDiagram
    autonumber
    actor U as Browser
    participant E as envoy
    participant I as ingestion-service
    participant D as document-service
    participant S3 as s3
    participant N as nats (INGESTION)
    participant W as ingestion-worker
    participant L as llm-service
    participant C as chat-service

    U->>E: IngestionService.CreateUpload
    E->>I: CreateUpload
    I->>D: CreateDocument
    D-->>I: document + presigned PUT URL
    I-->>U: job + upload URL
    U->>S3: PUT file (presigned)
    U->>I: CompleteUpload (via envoy)
    I->>D: SetDocumentStatus(UPLOADED)
    I->>N: kb.ingestion.uploaded
    U->>I: WatchJob (server stream, via envoy)

    N->>W: DocumentUploaded
    W->>N: kb.ingestion.started
    W->>D: SetDocumentStatus(PROCESSING)
    W->>D: ReadContent (stream)
    W->>W: extract + chunk
    W->>L: Embed(chunks)
    W->>D: AddChunks(text, embeddings), marks READY
    W->>N: kb.ingestion.processed
    N->>I: started / processed (or failed)
    I-->>U: job updates on WatchJob

    U->>C: ChatService.StreamChat (via envoy)
    C->>L: Embed(question)
    C->>D: SearchChunks(embedding)
    C->>L: Generate(prompt + chunks) (stream)
    C-->>U: answer tokens + citations (stream)
```

On a processing error the worker sets the document to `FAILED` and publishes `kb.ingestion.failed` instead; the ingestion service marks the job failed. JetStream redelivers an unacknowledged `uploaded` event up to three times.
