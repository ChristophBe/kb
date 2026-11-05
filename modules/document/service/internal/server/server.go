// Package server implements kb.document.v1.DocumentService.
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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pgvector/pgvector-go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	defaultLimit    = 5
	maxLimit        = 50
	readChunkSize   = 64 << 10
)

// Repository is the persistence the server needs.
type Repository interface {
	store.Querier
	ReplaceChunks(ctx context.Context, documentID uuid.UUID, chunks []store.InsertChunksParams, readyStatus int16) (int32, error)
}

// ObjectStore holds the raw files.
type ObjectStore interface {
	PresignPut(ctx context.Context, key string) (string, error)
	PresignGet(ctx context.Context, key, filename string) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Stat returns an object's size and content type, or an error wrapping
	// fs.ErrNotExist when it is missing.
	Stat(ctx context.Context, key string) (size int64, contentType string, err error)
	Delete(ctx context.Context, key string) error
}

type Server struct {
	documentv1.UnimplementedDocumentServiceServer
	repo    Repository
	objects ObjectStore
	llm     llmv1.LlmServiceClient
	log     *slog.Logger
}

// New builds the server. llm is the llm module's client, used only by
// SearchDocuments; it may point at a service that is down.
func New(repo Repository, objects ObjectStore, llm llmv1.LlmServiceClient, log *slog.Logger) *Server {
	return &Server{repo: repo, objects: objects, llm: llm, log: log}
}

func (s *Server) CreateDocument(ctx context.Context, req *documentv1.CreateDocumentRequest) (*documentv1.CreateDocumentResponse, error) {
	if req.GetFilename() == "" {
		return nil, status.Error(codes.InvalidArgument, "filename is required")
	}
	id := uuid.New()
	title := req.GetTitle()
	if title == "" {
		title = req.GetFilename()
	}
	contentType := req.GetContentType()
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	key := id.String() + "/" + path.Base(req.GetFilename())
	doc, err := s.repo.CreateDocument(ctx, store.CreateDocumentParams{
		ID:          id,
		Title:       title,
		Filename:    req.GetFilename(),
		ContentType: contentType,
		SizeBytes:   req.GetSizeBytes(),
		ObjectKey:   key,
		Status:      int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD),
		Metadata:    nonNil(req.GetMetadata()),
	})
	if err != nil {
		return nil, s.internal("create document", err)
	}
	uploadURL, err := s.objects.PresignPut(ctx, key)
	if err != nil {
		return nil, s.internal("presign upload", err)
	}
	return &documentv1.CreateDocumentResponse{Document: toProto(doc), UploadUrl: uploadURL}, nil
}

func (s *Server) GetDocument(ctx context.Context, req *documentv1.GetDocumentRequest) (*documentv1.GetDocumentResponse, error) {
	doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	return &documentv1.GetDocumentResponse{Document: toProto(doc)}, nil
}

func (s *Server) ListDocuments(ctx context.Context, req *documentv1.ListDocumentsRequest) (*documentv1.ListDocumentsResponse, error) {
	limit, offset, err := pageParams(req.GetPage())
	if err != nil {
		return nil, err
	}
	docs, err := s.repo.ListDocuments(ctx, store.ListDocumentsParams{Limit: limit + 1, Offset: offset})
	if err != nil {
		return nil, s.internal("list documents", err)
	}
	resp := &documentv1.ListDocumentsResponse{Page: &commonv1.PageResponse{}}
	if len(docs) > int(limit) {
		docs = docs[:limit]
		resp.Page.NextPageToken = strconv.Itoa(int(offset + limit))
	}
	for _, d := range docs {
		resp.Documents = append(resp.Documents, toProto(d))
	}
	return resp, nil
}

func (s *Server) UpdateDocument(ctx context.Context, req *documentv1.UpdateDocumentRequest) (*documentv1.UpdateDocumentResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	params := store.UpdateDocumentParams{ID: id}
	if req.Title != nil {
		title := strings.TrimSpace(req.GetTitle())
		if title == "" {
			return nil, status.Error(codes.InvalidArgument, "title must not be empty")
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if req.GetSetMetadata() {
		for key := range req.GetMetadata() {
			if strings.TrimSpace(key) == "" {
				return nil, status.Error(codes.InvalidArgument, "metadata keys must not be empty")
			}
		}
		params.Metadata = nonNil(req.GetMetadata())
	}
	doc, err := s.repo.UpdateDocument(ctx, params)
	if err != nil {
		return nil, s.notFoundOr("update document", err)
	}
	return &documentv1.UpdateDocumentResponse{Document: toProto(doc)}, nil
}

func (s *Server) DeleteDocument(ctx context.Context, req *documentv1.DeleteDocumentRequest) (*documentv1.DeleteDocumentResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	key, err := s.repo.DeleteDocument(ctx, id)
	if err != nil {
		return nil, s.notFoundOr("delete document", err)
	}
	if err := s.objects.Delete(ctx, key); err != nil {
		// The row is gone; an orphaned object is harmless, so only log it.
		s.log.WarnContext(ctx, "delete object", "key", key, "error", err)
	}
	return &documentv1.DeleteDocumentResponse{}, nil
}

func (s *Server) SetDocumentStatus(ctx context.Context, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED {
		return nil, status.Error(codes.InvalidArgument, "status is required")
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED {
		return s.markUploaded(ctx, id, req)
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
// its actual size replaces the size declared when the upload was created.
func (s *Server) markUploaded(ctx context.Context, id uuid.UUID, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	doc, err := s.repo.GetDocument(ctx, id)
	if err != nil {
		return nil, s.notFoundOr("get document", err)
	}
	size, contentType, err := s.objects.Stat(ctx, doc.ObjectKey)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, status.Error(codes.FailedPrecondition, "the file has not been uploaded")
	}
	if err != nil {
		s.log.ErrorContext(ctx, "stat object", "key", doc.ObjectKey, "error", err)
		return nil, status.Error(codes.Unavailable, "object storage is unavailable")
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

func (s *Server) GetDownloadUrl(ctx context.Context, req *documentv1.GetDownloadUrlRequest) (*documentv1.GetDownloadUrlResponse, error) {
	doc, err := s.get(ctx, req.GetId())
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
	doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return err
	}
	r, err := s.objects.Open(ctx, doc.ObjectKey)
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
	id, err := parseID(req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	rows := make([]store.InsertChunksParams, 0, len(req.GetChunks()))
	for _, c := range req.GetChunks() {
		if len(c.GetEmbedding()) == 0 {
			return nil, status.Errorf(codes.InvalidArgument, "chunk %d has no embedding", c.GetIndex())
		}
		rows = append(rows, store.InsertChunksParams{
			DocumentID: id,
			Idx:        c.GetIndex(),
			Text:       c.GetText(),
			Metadata:   nonNil(c.GetMetadata()),
			Embedding:  pgvector.NewVector(c.GetEmbedding()),
		})
	}
	n, err := s.repo.ReplaceChunks(ctx, id, rows, int16(documentv1.DocumentStatus_DOCUMENT_STATUS_READY))
	if err != nil {
		return nil, s.internal("replace chunks", err)
	}
	return &documentv1.AddChunksResponse{ChunkCount: n}, nil
}

// ListChunks pages through a document's chunks by index. The page token is
// the last index of the previous page, so pages stay stable while the client
// pages; a document re-processed in between simply continues after that index.
func (s *Server) ListChunks(ctx context.Context, req *documentv1.ListChunksRequest) (*documentv1.ListChunksResponse, error) {
	id, err := parseID(req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	after, err := decodeChunkToken(req.GetPage().GetPageToken())
	if err != nil {
		return nil, err
	}
	limit := pageSize(req.GetPage())
	if _, err := s.repo.GetDocument(ctx, id); err != nil {
		return nil, s.notFoundOr("get document", err)
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

func (s *Server) SearchChunks(ctx context.Context, req *documentv1.SearchChunksRequest) (*documentv1.SearchChunksResponse, error) {
	if len(req.GetEmbedding()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "embedding is required")
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	results, err := s.search(ctx, req.GetEmbedding(), req.GetLimit(), ids)
	if err != nil {
		return nil, err
	}
	return &documentv1.SearchChunksResponse{Results: results}, nil
}

// SearchDocuments embeds the query through the llm module, then runs the same
// vector search as SearchChunks. Only this RPC needs llm: while it is down,
// this fails with UNAVAILABLE and every other RPC keeps working.
func (s *Server) SearchDocuments(ctx context.Context, req *documentv1.SearchDocumentsRequest) (*documentv1.SearchDocumentsResponse, error) {
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, status.Error(codes.InvalidArgument, "query is required")
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	embedded, err := s.llm.Embed(ctx, &llmv1.EmbedRequest{Inputs: []string{query}})
	if err != nil {
		// llm's own statuses mean something else here; only its availability
		// is passed on.
		if code := status.Code(err); code == codes.Unavailable || code == codes.DeadlineExceeded {
			s.log.WarnContext(ctx, "embed query", "error", err)
			return nil, status.Error(codes.Unavailable, "the llm service is unavailable")
		}
		return nil, s.internal("embed query", err)
	}
	if len(embedded.GetEmbeddings()) != 1 || len(embedded.GetEmbeddings()[0].GetValues()) == 0 {
		return nil, s.internal("embed query", fmt.Errorf("got %d embeddings for 1 input", len(embedded.GetEmbeddings())))
	}
	results, err := s.search(ctx, embedded.GetEmbeddings()[0].GetValues(), req.GetLimit(), ids)
	if err != nil {
		return nil, err
	}
	return &documentv1.SearchDocumentsResponse{Results: results}, nil
}

func (s *Server) search(ctx context.Context, embedding []float32, limit int32, ids []uuid.UUID) ([]*documentv1.ScoredChunk, error) {
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)
	rows, err := s.repo.SearchChunks(ctx, store.SearchChunksParams{
		Embedding: pgvector.NewVector(embedding), DocumentIds: ids, MaxResults: limit,
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

func (s *Server) get(ctx context.Context, rawID string) (store.DocumentDocument, error) {
	id, err := parseID(rawID)
	if err != nil {
		return store.DocumentDocument{}, err
	}
	doc, err := s.repo.GetDocument(ctx, id)
	if err != nil {
		return store.DocumentDocument{}, s.notFoundOr("get document", err)
	}
	return doc, nil
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

func parseID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, status.Errorf(codes.InvalidArgument, "invalid id %q", raw)
	}
	return id, nil
}

func parseIDs(raw []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		id, err := parseID(r)
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

func pageParams(p *commonv1.PageRequest) (limit, offset int32, err error) {
	limit = pageSize(p)
	if tok := p.GetPageToken(); tok != "" {
		o, perr := strconv.Atoi(tok)
		if perr != nil || o < 0 {
			return 0, 0, status.Error(codes.InvalidArgument, "invalid page token")
		}
		offset = int32(o)
	}
	return limit, offset, nil
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
		return 0, status.Error(codes.InvalidArgument, "invalid page token")
	}
	idx, err := strconv.ParseInt(string(raw), 10, 32)
	if err != nil || idx < 0 {
		return 0, status.Error(codes.InvalidArgument, "invalid page token")
	}
	return int32(idx), nil
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
		Id:           d.ID.String(),
		Title:        d.Title,
		Filename:     d.Filename,
		ContentType:  d.ContentType,
		SizeBytes:    d.SizeBytes,
		Status:       documentv1.DocumentStatus(d.Status),
		StatusDetail: d.StatusDetail,
		ChunkCount:   d.ChunkCount,
		Metadata:     d.Metadata,
		CreateTime:   timestamppb.New(d.CreatedAt.Time),
		UpdateTime:   timestamppb.New(d.UpdatedAt.Time),
	}
}
