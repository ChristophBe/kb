// Package server implements kb.document.v1.DocumentService.
package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pgvector/pgvector-go"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
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
	Delete(ctx context.Context, key string) error
}

type Server struct {
	documentv1.UnimplementedDocumentServiceServer
	repo    Repository
	objects ObjectStore
	log     *slog.Logger
}

func New(repo Repository, objects ObjectStore, log *slog.Logger) *Server {
	return &Server{repo: repo, objects: objects, log: log}
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
		params.Title = pgtype.Text{String: req.GetTitle(), Valid: true}
	}
	if req.GetSetMetadata() {
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
	doc, err := s.repo.SetDocumentStatus(ctx, store.SetDocumentStatusParams{
		ID: id, Status: int16(req.GetStatus()), StatusDetail: req.GetStatusDetail(),
	})
	if err != nil {
		return nil, s.notFoundOr("set status", err)
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

func (s *Server) SearchChunks(ctx context.Context, req *documentv1.SearchChunksRequest) (*documentv1.SearchChunksResponse, error) {
	if len(req.GetEmbedding()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "embedding is required")
	}
	limit := req.GetLimit()
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)
	ids := make([]uuid.UUID, 0, len(req.GetDocumentIds()))
	for _, raw := range req.GetDocumentIds() {
		id, err := parseID(raw)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	rows, err := s.repo.SearchChunks(ctx, store.SearchChunksParams{
		Embedding: pgvector.NewVector(req.GetEmbedding()), DocumentIds: ids, MaxResults: limit,
	})
	if err != nil {
		return nil, s.internal("search chunks", err)
	}
	resp := &documentv1.SearchChunksResponse{}
	for _, r := range rows {
		resp.Results = append(resp.Results, &documentv1.ScoredChunk{
			Chunk: &documentv1.Chunk{
				DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
			},
			DocumentTitle: r.DocumentTitle,
			Score:         r.Score,
		})
	}
	return resp, nil
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

func pageParams(p *commonv1.PageRequest) (limit, offset int32, err error) {
	limit = p.GetPageSize()
	if limit <= 0 {
		limit = defaultPageSize
	}
	limit = min(limit, maxPageSize)
	if tok := p.GetPageToken(); tok != "" {
		o, perr := strconv.Atoi(tok)
		if perr != nil || o < 0 {
			return 0, 0, status.Error(codes.InvalidArgument, "invalid page token")
		}
		offset = int32(o)
	}
	return limit, offset, nil
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
