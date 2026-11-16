// Package server implements knowcel.document.v1.DocumentService.
package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pgvector/pgvector-go"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	"github.com/ChristophBe/knowcelium/modules/document/service/internal/store"
	llmv1 "github.com/ChristophBe/knowcelium/modules/llm/api/go/llmv1"
	commonv1 "github.com/ChristophBe/knowcelium/platform/api/go/commonv1"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
	"github.com/ChristophBe/knowcelium/platform/go/postgres"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	defaultLimit    = 5
	maxLimit        = 50
	readChunkSize   = 64 << 10
	// maxTitleLength matches the limit on conversation titles in the chat module.
	maxTitleLength = 200
	// domain is the ErrorInfo domain of this module's errors.
	domain = "knowcel.document.v1"
)

// Repository is the persistence the server needs.
type Repository interface {
	store.Querier
	ReplaceChunks(ctx context.Context, documentID uuid.UUID, chunks []store.InsertChunksParams, readyStatus int16) (int32, error)
	ApplyDocumentTeams(ctx context.Context, documentID uuid.UUID, add, remove []uuid.UUID) error
	ApplyDocumentAccess(ctx context.Context, documentID uuid.UUID, access int16, teams []uuid.UUID) error
}

// ObjectStore holds the raw files.
type ObjectStore interface {
	// PresignPut returns an upload URL that only takes a file of exactly
	// size bytes sent with this content type.
	PresignPut(ctx context.Context, key, contentType string, size int64) (string, error)
	PresignGet(ctx context.Context, key, filename string) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Stat returns an object's size and content type, or an error wrapping
	// fs.ErrNotExist when it is missing.
	Stat(ctx context.Context, key string) (size int64, contentType string, err error)
	Delete(ctx context.Context, key string) error
}

// ReindexPublisher announces that a document should be embedded again.
type ReindexPublisher interface {
	PublishReindexRequested(ctx context.Context, ev *documentv1.DocumentReindexRequested) error
}

// Server implements DocumentService. Documents belong to the user who uploaded
// them and are public or attached to teams. The RPCs a user calls, and the
// internal CreateDocument and SearchChunks that services call on a user's
// behalf (passing the user on), read the public documents, the user's own and
// those of the teams they belong to (the call's grpcserver.Principal; without
// teams, for instance while iam is down, only the first two); changing or deleting a
// document is the owner's alone, and anything the caller can't read is
// reported as not found. The other internal RPCs serve the ingestion
// pipeline, which runs without a user, and act on any document.
type Server struct {
	documentv1.UnimplementedDocumentServiceServer
	repo    Repository
	objects ObjectStore
	llm     llmv1.LlmServiceClient
	limits  Limits
	log     *slog.Logger
	reindex ReindexPublisher
}

// New builds the server. llm is the llm module's client, used only by
// SearchDocuments; it may point at a service that is down. limits bound the
// files users upload.
func New(repo Repository, objects ObjectStore, llm llmv1.LlmServiceClient, limits Limits, log *slog.Logger) *Server {
	return &Server{repo: repo, objects: objects, llm: llm, limits: limits, log: log}
}

// WithReindexPublisher sets where ReindexDocuments sends its events; without
// one it fails with UNAVAILABLE.
func (s *Server) WithReindexPublisher(p ReindexPublisher) *Server {
	s.reindex = p
	return s
}

// CreateDocument registers a document owned by the calling user, so it is
// called on behalf of a user (ingestion forwards the uploader). The file must
// fit the limits; the upload URL only takes the declared size and type.
func (s *Server) CreateDocument(ctx context.Context, req *documentv1.CreateDocumentRequest) (*documentv1.CreateDocumentResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	owner := a.user
	contentType := declaredContentType(req.GetContentType(), req.GetFilename())
	checksum := strings.ToLower(strings.TrimSpace(req.GetSha256()))
	var violations []*errdetails.BadRequest_FieldViolation
	if req.GetFilename() == "" {
		violations = append(violations, grpcserver.Violation("filename", "A filename is required"))
	}
	if utf8.RuneCountInString(req.GetTitle()) > maxTitleLength {
		violations = append(violations, grpcserver.Violation("title",
			fmt.Sprintf("Title must not be longer than %d characters", maxTitleLength)))
	}
	violations = append(violations, s.limits.validateUpload(req.GetSizeBytes(), contentType, checksum)...)
	if len(violations) > 0 {
		return nil, grpcserver.InvalidArgument(violations...)
	}
	level, teams, err := a.forDocument(req.GetAccess(), req.GetTeamIds())
	if err != nil {
		return nil, err
	}
	id := uuid.New()
	title := req.GetTitle()
	if title == "" {
		title = req.GetFilename()
	}
	key := id.String() + "/" + path.Base(req.GetFilename())
	doc, err := s.repo.CreateDocument(ctx, store.CreateDocumentParams{
		ID:          id,
		OwnerID:     owner,
		Title:       title,
		Filename:    req.GetFilename(),
		ContentType: contentType,
		SizeBytes:   req.GetSizeBytes(),
		ObjectKey:   key,
		Status:      int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD),
		Metadata:    nonNil(req.GetMetadata()),
		Sha256:      checksum,
		Access:      int16(level),
	})
	if err != nil {
		return nil, s.internal("create document", err)
	}
	if len(teams) > 0 {
		// A failure leaves a document that never gets its upload, which the
		// cleanup sweeper removes.
		if err := s.repo.ApplyDocumentTeams(ctx, id, teams, nil); err != nil {
			return nil, s.internal("share document", err)
		}
	}
	uploadURL, err := s.objects.PresignPut(ctx, key, contentType, req.GetSizeBytes())
	if err != nil {
		return nil, s.internal("presign upload", err)
	}
	docs, err := s.protos(ctx, a, doc)
	if err != nil {
		return nil, err
	}
	return &documentv1.CreateDocumentResponse{Document: docs[0], UploadUrl: uploadURL}, nil
}

func (s *Server) GetDocument(ctx context.Context, req *documentv1.GetDocumentRequest) (*documentv1.GetDocumentResponse, error) {
	a, doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	docs, err := s.protos(ctx, a, doc)
	if err != nil {
		return nil, err
	}
	return &documentv1.GetDocumentResponse{Document: docs[0]}, nil
}

func (s *Server) ListDocuments(ctx context.Context, req *documentv1.ListDocumentsRequest) (*documentv1.ListDocumentsResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	limit := pageSize(req.GetPage())
	afterTime, afterID, err := postgres.After(req.GetPage().GetPageToken())
	if err != nil {
		return nil, errInvalidPageToken()
	}
	docs, err := s.repo.ListDocuments(ctx, store.ListDocumentsParams{
		OwnerID: a.user, TeamIds: a.teamIDs(), AfterCreatedAt: afterTime, AfterID: afterID, MaxResults: limit + 1,
	})
	if err != nil {
		return nil, s.internal("list documents", err)
	}
	resp := &documentv1.ListDocumentsResponse{Page: &commonv1.PageResponse{}}
	if len(docs) > int(limit) {
		docs = docs[:limit]
		last := docs[len(docs)-1]
		resp.Page.NextPageToken = postgres.Cursor{Time: last.CreatedAt.Time, ID: last.ID}.Encode()
	}
	resp.Documents, err = s.protos(ctx, a, docs...)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (s *Server) UpdateDocument(ctx context.Context, req *documentv1.UpdateDocumentRequest) (*documentv1.UpdateDocumentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	params := store.UpdateDocumentParams{ID: id, OwnerID: owner}
	if req.Title != nil {
		title := strings.TrimSpace(req.GetTitle())
		if title == "" {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation("title", "Title must not be empty"))
		}
		if utf8.RuneCountInString(title) > maxTitleLength {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation("title",
				fmt.Sprintf("Title must not be longer than %d characters", maxTitleLength)))
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if req.GetSetMetadata() {
		for key := range req.GetMetadata() {
			if strings.TrimSpace(key) == "" {
				return nil, grpcserver.InvalidArgument(grpcserver.Violation("metadata", "Metadata keys must not be empty"))
			}
		}
		params.Metadata = nonNil(req.GetMetadata())
	}
	doc, err := s.repo.UpdateDocument(ctx, params)
	if err != nil {
		return nil, s.notOwner(ctx, "update document", id, err)
	}
	docs, err := s.protos(ctx, access{user: owner}, doc)
	if err != nil {
		return nil, err
	}
	return &documentv1.UpdateDocumentResponse{Document: docs[0]}, nil
}

func (s *Server) DeleteDocument(ctx context.Context, req *documentv1.DeleteDocumentRequest) (*documentv1.DeleteDocumentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	// The objects (the file and a pending version's) go first and the row
	// after them, so a failure in between leaves the row, and the client's
	// retry deletes all: deleting an object that is already gone succeeds. An object put back by an upload still in
	// flight is left without a row, which the cleanup sweeper removes.
	doc, err := s.getOwned(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	for _, key := range []string{doc.PendingObjectKey, doc.ObjectKey} {
		if key == "" {
			continue // no pending version
		}
		if err := s.objects.Delete(ctx, key); err != nil {
			s.log.ErrorContext(ctx, "delete object", "key", key, "error", err)
			return nil, status.Error(codes.Unavailable, "object storage is unavailable")
		}
	}
	if _, err := s.repo.DeleteDocument(ctx, store.DeleteDocumentParams{ID: id, OwnerID: owner}); err != nil {
		return nil, s.notOwner(ctx, "delete document", id, err)
	}
	return &documentv1.DeleteDocumentResponse{}, nil
}

func (s *Server) SetDocumentStatus(ctx context.Context, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("status", "A status is required"))
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED {
		return s.markUploaded(ctx, id, req)
	}
	if resp, ok, err := s.setPendingStatus(ctx, id, req); ok {
		return resp, err
	}
	doc, err := s.repo.SetDocumentStatus(ctx, store.SetDocumentStatusParams{
		ID: id, Status: int16(req.GetStatus()), StatusDetail: req.GetStatusDetail(),
	})
	if err != nil {
		return nil, s.notFoundOr("set status", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, nil
}

// markUploaded trusts the bucket, not the client: the object must exist, and
// its actual size replaces the size declared when the upload was created. An
// object over the size limit or not matching the declared checksum fails the
// document. The upload URL already enforces the declared size; checking here
// as well keeps the limit with any S3 server and for objects put there by
// other means. A document with a pending version checks that version's file.
func (s *Server) markUploaded(ctx context.Context, id uuid.UUID, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	doc, err := s.repo.GetAnyDocument(ctx, id)
	if err != nil {
		return nil, s.notFoundOr("get document", err)
	}
	if pending(doc) {
		return s.markPendingUploaded(ctx, doc, req)
	}
	size, contentType, rejection, err := s.inspectUpload(ctx, doc.ObjectKey, doc.Sha256)
	if err != nil {
		return nil, err
	}
	if rejection != "" {
		return nil, s.reject(ctx, id, rejection)
	}
	if isGenericContentType(contentType) {
		contentType = doc.ContentType
	}
	doc, err = s.repo.MarkDocumentUploaded(ctx, store.MarkDocumentUploadedParams{
		ID: id, Status: int16(req.GetStatus()), StatusDetail: req.GetStatusDetail(), SizeBytes: size, ContentType: contentType,
	})
	if err != nil {
		return nil, s.notFoundOr("mark uploaded", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, nil
}

// checksum hashes the stored object.
func (s *Server) checksum(ctx context.Context, key string) (string, error) {
	r, err := s.objects.Open(ctx, key)
	if err != nil {
		s.log.ErrorContext(ctx, "open object", "key", key, "error", err)
		return "", status.Error(codes.Unavailable, "object storage is unavailable")
	}
	defer r.Close()
	sum, err := sha256Hex(r)
	if err != nil {
		s.log.ErrorContext(ctx, "read object", "key", key, "error", err)
		return "", status.Error(codes.Unavailable, "object storage is unavailable")
	}
	return sum, nil
}

// reject fails a document whose uploaded file is not acceptable, recording
// why, and returns the error SetDocumentStatus answers with.
func (s *Server) reject(ctx context.Context, id uuid.UUID, reason string) error {
	if _, err := s.repo.SetDocumentStatus(ctx, store.SetDocumentStatusParams{
		ID: id, Status: int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED), StatusDetail: reason,
	}); err != nil {
		return s.notFoundOr("fail document", err)
	}
	return errRejected(reason)
}

func (s *Server) GetDownloadUrl(ctx context.Context, req *documentv1.GetDownloadUrlRequest) (*documentv1.GetDownloadUrlResponse, error) {
	_, doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	u, err := s.objects.PresignGet(ctx, doc.ObjectKey, doc.Filename)
	if err != nil {
		return nil, s.internal("presign download", err)
	}
	return &documentv1.GetDownloadUrlResponse{Url: u}, nil
}

func (s *Server) ReadContent(req *documentv1.ReadContentRequest, stream documentv1.DocumentService_ReadContentServer) error {
	ctx := stream.Context()
	id, err := parseID("id", req.GetId())
	if err != nil {
		return err
	}
	doc, err := s.repo.GetAnyDocument(ctx, id)
	if err != nil {
		return s.notFoundOr("get document", err)
	}
	key := contentKey(doc)
	if key != doc.ObjectKey {
		// A rejected pending file was removed; reading it would fail obscurely.
		if _, _, err := s.objects.Stat(ctx, key); errors.Is(err, fs.ErrNotExist) {
			return status.Error(codes.FailedPrecondition, "the file of the new version has not been uploaded")
		}
	}
	r, err := s.objects.Open(ctx, key)
	if err != nil {
		return s.internal("open object", err)
	}
	defer r.Close()
	buf := make([]byte, readChunkSize)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if serr := stream.Send(&documentv1.ReadContentResponse{Data: buf[:n]}); serr != nil {
				return serr
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return s.internal("read object", err)
		}
	}
}

func (s *Server) AddChunks(ctx context.Context, req *documentv1.AddChunksRequest) (*documentv1.AddChunksResponse, error) {
	id, err := parseID("document_id", req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	rows := make([]store.InsertChunksParams, 0, len(req.GetChunks()))
	for i, c := range req.GetChunks() {
		if len(c.GetEmbedding()) == 0 {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation(fmt.Sprintf("chunks[%d].embedding", i),
				fmt.Sprintf("Chunk %d has no embedding", c.GetIndex())))
		}
		if c.GetEmbeddingModel() == "" {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation(fmt.Sprintf("chunks[%d].embedding_model", i),
				fmt.Sprintf("Chunk %d does not name its embedding model", c.GetIndex())))
		}
		if c.GetEmbeddingModel() != req.GetChunks()[0].GetEmbeddingModel() {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation(fmt.Sprintf("chunks[%d].embedding_model", i),
				"All chunks of a document must come from the same embedding model"))
		}
		rows = append(rows, store.InsertChunksParams{
			DocumentID: id,
			Idx:        c.GetIndex(),
			Text:       c.GetText(),
			Metadata:   nonNil(c.GetMetadata()),
			Embedding:  pgvector.NewVector(c.GetEmbedding()),

			EmbeddingModel: c.GetEmbeddingModel(),
		})
	}
	// The document as it was tells whether the chunks bring in a new version.
	before, err := s.repo.GetAnyDocument(ctx, id)
	if err != nil {
		return nil, s.notFoundOr("get document", err)
	}
	n, err := s.repo.ReplaceChunks(ctx, id, rows, int16(documentv1.DocumentStatus_DOCUMENT_STATUS_READY))
	if err != nil {
		return nil, s.internal("replace chunks", err)
	}
	s.removeSuperseded(ctx, before)
	return &documentv1.AddChunksResponse{ChunkCount: n}, nil
}

// ListChunks pages through a document's chunks by index. The page token is
// the last index of the previous page, so pages stay stable while the client
// pages; a document re-processed in between simply continues after that index.
func (s *Server) ListChunks(ctx context.Context, req *documentv1.ListChunksRequest) (*documentv1.ListChunksResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("document_id", req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	after, err := decodeChunkToken(req.GetPage().GetPageToken())
	if err != nil {
		return nil, err
	}
	limit := pageSize(req.GetPage())
	if _, err := s.getVisible(ctx, a, id); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListChunks(ctx, store.ListChunksParams{DocumentID: id, AfterIdx: after, MaxResults: limit + 1})
	if err != nil {
		return nil, s.internal("list chunks", err)
	}
	resp := &documentv1.ListChunksResponse{Page: &commonv1.PageResponse{}}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		resp.Page.NextPageToken = encodeChunkToken(rows[len(rows)-1].Idx)
	}
	for _, r := range rows {
		resp.Chunks = append(resp.Chunks, &documentv1.Chunk{
			DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
		})
	}
	return resp, nil
}

// SearchChunks searches the chunks of the documents the calling user can read
// (public, their own and those of their teams); chat calls it on behalf of
// the user asking.
func (s *Server) SearchChunks(ctx context.Context, req *documentv1.SearchChunksRequest) (*documentv1.SearchChunksResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	if len(req.GetEmbedding()) == 0 {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("embedding", "An embedding is required"))
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	onlyTeams, err := parseTeamIDs("team_ids", req.GetTeamIds())
	if err != nil {
		return nil, err
	}
	model := req.GetEmbeddingModel()
	if model == "" {
		if model, err = s.currentModel(ctx); err != nil {
			return nil, err
		}
	}
	results, err := s.search(ctx, a, req.GetEmbedding(), model, req.GetLimit(), ids, onlyTeams)
	if err != nil {
		return nil, err
	}
	return &documentv1.SearchChunksResponse{Results: results}, nil
}

// SearchDocuments embeds the query through the llm module, then runs the same
// vector search as SearchChunks and ranks documents by their best chunk; limit
// counts documents. Only this RPC needs llm: while it is down, this fails with
// UNAVAILABLE and every other RPC keeps working.
func (s *Server) SearchDocuments(ctx context.Context, req *documentv1.SearchDocumentsRequest) (*documentv1.SearchDocumentsResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("query", "A query is required"))
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	embedded, err := s.llm.Embed(ctx, &llmv1.EmbedRequest{Inputs: []string{query}})
	if err != nil {
		return nil, s.llmError("embed query", err)
	}
	if len(embedded.GetEmbeddings()) != 1 || len(embedded.GetEmbeddings()[0].GetValues()) == 0 || embedded.GetModel() == "" {
		return nil, s.internal("embed query", fmt.Errorf("got %d embeddings for 1 input", len(embedded.GetEmbeddings())))
	}
	embedding := embedded.GetEmbeddings()[0].GetValues()
	model := embedded.GetModel()
	results, err := s.search(ctx, a, embedding, model, req.GetLimit(), ids, []uuid.UUID{})
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.SearchBestChunks(ctx, store.SearchBestChunksParams{
		Embedding: pgvector.NewVector(embedding), OwnerID: a.user, TeamIds: a.teamIDs(), EmbeddingModel: model,
		DocumentIds: ids, OnlyTeamIds: []uuid.UUID{}, MaxResults: clampLimit(req.GetLimit()),
	})
	if err != nil {
		return nil, s.internal("search documents", err)
	}
	documents := make([]*documentv1.ScoredDocument, 0, len(rows))
	for _, r := range rows {
		documents = append(documents, &documentv1.ScoredDocument{
			DocumentId: r.DocumentID.String(),
			Title:      r.DocumentTitle,
			Score:      r.Score,
			BestChunk: &documentv1.Chunk{
				DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
			},
		})
	}
	return &documentv1.SearchDocumentsResponse{Results: results, Documents: documents}, nil
}

// llmError maps a failed llm call: only its availability is passed on, since
// its other statuses mean something else here.
func (s *Server) llmError(op string, err error) error {
	if code := status.Code(err); code == codes.Unavailable || code == codes.DeadlineExceeded {
		s.log.Warn(op, "error", err)
		return grpcserver.WithDetails(codes.Unavailable, "the llm service is unavailable",
			grpcserver.ErrorInfo(domain, "LLM_UNAVAILABLE", nil))
	}
	return s.internal(op, err)
}

// currentModel asks llm for the embedding model it uses now: an Embed call
// without inputs answers with the model without calling the provider.
func (s *Server) currentModel(ctx context.Context) (string, error) {
	resp, err := s.llm.Embed(ctx, &llmv1.EmbedRequest{})
	if err != nil {
		return "", s.llmError("get embedding model", err)
	}
	if resp.GetModel() == "" {
		return "", s.internal("get embedding model", errors.New("llm returned no model"))
	}
	return resp.GetModel(), nil
}

// ReindexDocuments asks for the caller's documents to be embedded again with
// the current model: one DocumentReindexRequested event per document, which
// ingestion processes. A document is searchable again once its new chunks are
// stored; until then its old chunks stay (and are not searched, being of
// another model), so a failed run loses nothing.
func (s *Server) ReindexDocuments(ctx context.Context, req *documentv1.ReindexDocumentsRequest) (*documentv1.ReindexDocumentsResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, err := s.getOwned(ctx, owner, id); err != nil {
			return nil, err
		}
	}
	if s.reindex == nil {
		return nil, status.Error(codes.Unavailable, "reindexing is unavailable")
	}
	model, err := s.currentModel(ctx)
	if err != nil {
		return nil, err
	}
	targets, err := s.repo.ListReindexTargets(ctx, store.ListReindexTargetsParams{
		OwnerID: owner, DocumentIds: ids, Force: req.GetForce(), EmbeddingModel: model,
	})
	if err != nil {
		return nil, s.internal("list documents to reindex", err)
	}
	for i, id := range targets {
		ev := &documentv1.DocumentReindexRequested{DocumentId: id.String(), OwnerId: owner, EmbeddingModel: model}
		if err := s.reindex.PublishReindexRequested(ctx, ev); err != nil {
			// The documents before this one are queued; asking again queues
			// the rest (and some of those again, which is harmless).
			s.log.ErrorContext(ctx, "publish reindex request", "queued", i, "error", err)
			return nil, status.Error(codes.Unavailable, "the event stream is unavailable, try again")
		}
	}
	return &documentv1.ReindexDocumentsResponse{Requested: int32(len(targets)), EmbeddingModel: model}, nil
}

// clampLimit applies the default and the cap to a search's limit.
func clampLimit(limit int32) int32 {
	if limit <= 0 {
		return defaultLimit
	}
	return min(limit, maxLimit)
}

// search finds the chunks the caller can read that are most similar to an
// embedding that model made; chunks of other models are never compared with it.
func (s *Server) search(ctx context.Context, a access, embedding []float32, model string, limit int32, ids, onlyTeams []uuid.UUID) ([]*documentv1.ScoredChunk, error) {
	rows, err := s.repo.SearchChunks(ctx, store.SearchChunksParams{
		Embedding: pgvector.NewVector(embedding), OwnerID: a.user, TeamIds: a.teamIDs(), EmbeddingModel: model,
		DocumentIds: ids, OnlyTeamIds: onlyTeams, MaxResults: clampLimit(limit),
	})
	if err != nil {
		return nil, s.internal("search chunks", err)
	}
	results := make([]*documentv1.ScoredChunk, 0, len(rows))
	for _, r := range rows {
		results = append(results, &documentv1.ScoredChunk{
			Chunk: &documentv1.Chunk{
				DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
			},
			DocumentTitle: r.DocumentTitle,
			Score:         r.Score,
		})
	}
	return results, nil
}

// get returns the document with the id in the request if the calling user can
// read it, with their access.
func (s *Server) get(ctx context.Context, rawID string) (access, store.DocumentDocument, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return access{}, store.DocumentDocument{}, err
	}
	id, err := parseID("id", rawID)
	if err != nil {
		return access{}, store.DocumentDocument{}, err
	}
	doc, err := s.getVisible(ctx, a, id)
	return a, doc, err
}

// getVisible returns a document if it is public, or the caller owns it or is a
// member of one of its teams; for anyone else it is not found.
func (s *Server) getVisible(ctx context.Context, a access, id uuid.UUID) (store.DocumentDocument, error) {
	doc, err := s.repo.GetVisibleDocument(ctx, store.GetVisibleDocumentParams{ID: id, OwnerID: a.user, TeamIds: a.teamIDs()})
	if err != nil {
		return store.DocumentDocument{}, s.notFoundOr("get document", err)
	}
	return doc, nil
}

// getOwned returns owner's document. Another user's is not found, unless they
// can read it through a team: then changing it is not permitted.
func (s *Server) getOwned(ctx context.Context, owner string, id uuid.UUID) (store.DocumentDocument, error) {
	doc, err := s.repo.GetDocument(ctx, store.GetDocumentParams{ID: id, OwnerID: owner})
	if err != nil {
		return store.DocumentDocument{}, s.notOwner(ctx, "get document", id, err)
	}
	return doc, nil
}

// notOwner maps the failure of an owner-only lookup of a document: not found,
// or PERMISSION_DENIED for a reader that is not the owner (a team member).
func (s *Server) notOwner(ctx context.Context, op string, id uuid.UUID, err error) error {
	if !errors.Is(err, pgx.ErrNoRows) {
		return s.internal(op, err)
	}
	if a, aerr := accessOf(ctx); aerr == nil {
		if _, verr := s.repo.GetVisibleDocument(ctx, store.GetVisibleDocumentParams{ID: id, OwnerID: a.user, TeamIds: a.teamIDs()}); verr == nil {
			return status.Error(codes.PermissionDenied, "only the owner can change the document")
		}
	}
	return status.Error(codes.NotFound, "document not found")
}

// caller returns the user the call is made for. Calls through the gateway
// always carry one, and services pass it on when calling for a user.
func caller(ctx context.Context) (string, error) {
	user, ok := grpcserver.UserFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "the call has no user")
	}
	return user, nil
}

func (s *Server) notFoundOr(op string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return status.Error(codes.NotFound, "document not found")
	}
	return s.internal(op, err)
}

func (s *Server) internal(op string, err error) error {
	s.log.Error(op, "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}

// parseID parses the id in the request field named field.
func parseID(field, raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, grpcserver.InvalidArgument(grpcserver.Violation(field, fmt.Sprintf("Invalid id %q", raw)))
	}
	return id, nil
}

func parseIDs(raw []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(raw))
	for i, r := range raw {
		id, err := parseID(fmt.Sprintf("document_ids[%d]", i), r)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func pageSize(p *commonv1.PageRequest) int32 {
	if n := p.GetPageSize(); n > 0 {
		return min(n, maxPageSize)
	}
	return defaultPageSize
}

// encodeChunkToken makes the last index of a page an opaque cursor.
func encodeChunkToken(idx int32) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(int(idx))))
}

// decodeChunkToken returns the index to continue after; -1 for the first page.
func decodeChunkToken(tok string) (int32, error) {
	if tok == "" {
		return -1, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil {
		return 0, errInvalidPageToken()
	}
	idx, err := strconv.ParseInt(string(raw), 10, 32)
	if err != nil || idx < 0 {
		return 0, errInvalidPageToken()
	}
	return int32(idx), nil
}

func errInvalidPageToken() error {
	return grpcserver.InvalidArgument(grpcserver.Violation("page.page_token", "The page token is invalid"))
}

// isGenericContentType reports a type that says nothing about the content:
// S3 stores one of these when a client uploads without a Content-Type.
func isGenericContentType(contentType string) bool {
	switch contentType {
	case "", "application/octet-stream", "binary/octet-stream":
		return true
	}
	return false
}

func nonNil(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func toProto(d store.DocumentDocument) *documentv1.Document {
	return &documentv1.Document{
		Id:             d.ID.String(),
		Title:          d.Title,
		Filename:       d.Filename,
		ContentType:    d.ContentType,
		SizeBytes:      d.SizeBytes,
		Status:         documentv1.DocumentStatus(d.Status),
		StatusDetail:   d.StatusDetail,
		ChunkCount:     d.ChunkCount,
		Metadata:       d.Metadata,
		CreateTime:     timestamppb.New(d.CreatedAt.Time),
		UpdateTime:     timestamppb.New(d.UpdatedAt.Time),
		OwnerId:        d.OwnerID,
		Sha256:         d.Sha256,
		Version:        d.Version,
		PendingVersion: pendingProto(d),
		Access:         documentv1.Access(d.Access),
	}
}
